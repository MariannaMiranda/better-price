-- Group roles and client privilege hardening.
-- Adapted to the deployed public.households / public.household_members / lists / list_items schema.
-- Run in staging first. Existing "member" roles are promoted to "editor" to preserve access.

DO $preflight$
BEGIN
  IF to_regclass('public.households') IS NULL
     OR to_regclass('public.household_members') IS NULL
     OR to_regclass('public.lists') IS NULL
     OR to_regclass('public.list_items') IS NULL
     OR to_regclass('public.applied_ops') IS NULL THEN
    RAISE EXCEPTION 'Expected group/list tables are missing; migration stopped';
  END IF;

  IF to_regprocedure('public.bp_member_cleanup()') IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM pg_trigger
       WHERE tgrelid = 'public.household_members'::regclass
         AND tgname = 'household_members_cleanup'
         AND tgfoid = to_regprocedure('public.bp_member_cleanup()')
         AND tgenabled <> 'D'
         AND NOT tgisinternal
     ) THEN
    RAISE EXCEPTION 'Expected household cleanup/leader-promotion trigger is missing; migration stopped';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.household_members
    WHERE role NOT IN ('owner', 'member', 'editor', 'checker')
  ) THEN
    RAISE EXCEPTION 'Unexpected household member role found; review data before migrating';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.household_members
    GROUP BY household_id
    HAVING count(*) FILTER (WHERE role = 'owner') <> 1
  ) THEN
    RAISE EXCEPTION 'Every non-empty group must have exactly one Leader before migrating';
  END IF;
END
$preflight$;

-- Keep existing members' current ability to edit shared lists.
ALTER TABLE public.household_members
  DROP CONSTRAINT IF EXISTS household_members_role_check;
UPDATE public.household_members SET role = 'editor' WHERE role = 'member';
ALTER TABLE public.household_members
  ADD CONSTRAINT household_members_role_check
  CHECK (role = ANY (ARRAY['owner'::text, 'editor'::text, 'checker'::text]));
ALTER TABLE public.household_members
  ALTER COLUMN role SET DEFAULT 'editor';

-- The verified existing cleanup trigger promotes the oldest remaining member when a Leader leaves or is removed.
CREATE UNIQUE INDEX IF NOT EXISTS household_members_one_leader_per_group
  ON public.household_members (household_id)
  WHERE role = 'owner';

CREATE OR REPLACE FUNCTION public.bp_is_household_leader(p_household uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.household_members m
    WHERE m.household_id = p_household
      AND m.user_id = auth.uid()
      AND m.role = 'owner'
  )
$function$;

CREATE OR REPLACE FUNCTION public.bp_can_edit_household(p_household uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.household_members m
    WHERE m.household_id = p_household
      AND m.user_id = auth.uid()
      AND m.role IN ('owner', 'editor')
  )
$function$;

CREATE OR REPLACE FUNCTION public.bp_can_edit_list(p_list uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.lists l
    WHERE l.id = p_list
      AND (
        (l.household_id IS NULL AND l.owner_id = auth.uid())
        OR (l.household_id IS NOT NULL AND public.bp_can_edit_household(l.household_id))
      )
  )
$function$;

CREATE OR REPLACE FUNCTION public.bp_can_check_list(p_list uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.lists l
    WHERE l.id = p_list
      AND (
        l.owner_id = auth.uid()
        OR (
          l.household_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM public.household_members m
            WHERE m.household_id = l.household_id
              AND m.user_id = auth.uid()
              AND m.role IN ('owner', 'editor', 'checker')
          )
        )
      )
  )
$function$;

CREATE OR REPLACE FUNCTION public.bp_lists_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    RAISE EXCEPTION 'owner_id is immutable' USING ERRCODE = '42501';
  END IF;

  IF NEW.household_id IS DISTINCT FROM OLD.household_id THEN
    IF auth.uid() <> OLD.owner_id
       AND NOT (OLD.household_id IS NOT NULL AND public.bp_can_edit_household(OLD.household_id))
       AND NOT (NEW.household_id IS NOT NULL AND public.bp_can_edit_household(NEW.household_id)) THEN
      RAISE EXCEPTION 'Only the list owner, a group Leader, or a List Editor can change sharing' USING ERRCODE = '42501';
    END IF;
    IF NEW.household_id IS NOT NULL
       AND NOT public.bp_is_member(NEW.household_id) THEN
      RAISE EXCEPTION 'not a member of that group' USING ERRCODE = '42501';
    END IF;
    IF NEW.household_id IS NOT NULL
       AND NOT public.bp_can_edit_household(NEW.household_id) THEN
      RAISE EXCEPTION 'Only a group Leader or List Editor can share a list' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
     AND auth.uid() <> OLD.owner_id
     AND NOT (OLD.household_id IS NOT NULL AND public.bp_is_household_leader(OLD.household_id)) THEN
    RAISE EXCEPTION 'Only the list owner or group leader can delete a list' USING ERRCODE = '42501';
  END IF;

  IF NEW.name IS DISTINCT FROM OLD.name
     AND NOT public.bp_can_edit_list(OLD.id) THEN
    RAISE EXCEPTION 'List editing is not allowed for this role' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.bp_list_items_role_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NOT public.bp_can_edit_list(NEW.list_id) THEN
      RAISE EXCEPTION 'This role cannot add list items' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.list_id IS DISTINCT FROM OLD.list_id THEN
    RAISE EXCEPTION 'An item cannot be moved between lists' USING ERRCODE = '42501';
  END IF;

  IF public.bp_can_edit_list(OLD.list_id) THEN
    RETURN NEW;
  END IF;

  IF NOT public.bp_can_check_list(OLD.list_id) THEN
    RAISE EXCEPTION 'List access is not allowed for this role' USING ERRCODE = '42501';
  END IF;

  IF (to_jsonb(NEW) - ARRAY['done', 'done_by', 'field_v', 'updated_at', 'version', 'seq'])
     IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['done', 'done_by', 'field_v', 'updated_at', 'version', 'seq']) THEN
    RAISE EXCEPTION 'This role can only check or uncheck items' USING ERRCODE = '42501';
  END IF;

  IF (NEW.field_v - 'done') IS DISTINCT FROM (OLD.field_v - 'done') THEN
    RAISE EXCEPTION 'This role cannot change item edit metadata' USING ERRCODE = '42501';
  END IF;

  IF (NEW.field_v->'done') IS DISTINCT FROM (OLD.field_v->'done')
     AND COALESCE((NEW.field_v->>'done')::integer, 0) <> OLD.version + 1 THEN
    RAISE EXCEPTION 'Invalid item check version' USING ERRCODE = '42501';
  END IF;

  IF NEW.done IS DISTINCT FROM OLD.done
     AND COALESCE((NEW.field_v->>'done')::integer, 0) <> OLD.version + 1 THEN
    RAISE EXCEPTION 'Checking an item requires a current edit version' USING ERRCODE = '42501';
  END IF;

  IF NEW.done_by IS DISTINCT FROM CASE WHEN NEW.done THEN auth.uid() ELSE NULL END THEN
    RAISE EXCEPTION 'Invalid item check attribution' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END
$function$;

-- Role changes are only possible through authenticated, owner-checked RPCs.
CREATE OR REPLACE FUNCTION public.rename_household(p_household uuid, p_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;
  IF p_name IS NULL OR char_length(btrim(p_name)) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'Group name must be 1 to 80 characters' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.households WHERE id = p_household FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Group not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.bp_is_household_leader(p_household) THEN
    RAISE EXCEPTION 'Only the group Leader can rename it' USING ERRCODE = '42501';
  END IF;

  UPDATE public.households SET name = btrim(p_name) WHERE id = p_household;
END
$function$;

CREATE OR REPLACE FUNCTION public.set_household_member_role(
  p_household uuid, p_user uuid, p_role text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;
  IF p_role IS NULL OR p_role NOT IN ('editor', 'checker')
     OR p_user IS NULL OR p_user = auth.uid() THEN
    RAISE EXCEPTION 'Choose List Editor or List Checker for another group member' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.households WHERE id = p_household FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Group not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.bp_is_household_leader(p_household) THEN
    RAISE EXCEPTION 'Only the group Leader can change roles' USING ERRCODE = '42501';
  END IF;

  UPDATE public.household_members
  SET role = p_role
  WHERE household_id = p_household AND user_id = p_user AND role IN ('editor', 'checker');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target must be a non-Leader group member' USING ERRCODE = '22023';
  END IF;
END
$function$;

CREATE OR REPLACE FUNCTION public.create_invite(p_household uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  candidate text;
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  bytes bytea;
  i integer;
  attempt integer;
  has_created_by boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;
  PERFORM 1 FROM public.households WHERE id = p_household FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Group not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.bp_is_household_leader(p_household) THEN
    RAISE EXCEPTION 'Only the group Leader can create an invite' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'household_invites' AND column_name = 'created_by'
  ) INTO has_created_by;

  FOR attempt IN 1..8 LOOP
    bytes := extensions.gen_random_bytes(8);
    candidate := '';
    FOR i IN 0..7 LOOP
      candidate := candidate || substr(alphabet, (get_byte(bytes, i) % length(alphabet)) + 1, 1);
    END LOOP;

    BEGIN
      IF has_created_by THEN
        INSERT INTO public.household_invites(household_id, code, created_by, expires_at, uses, max_uses)
        VALUES (p_household, candidate, auth.uid(), now() + interval '7 days', 0, 10);
      ELSE
        INSERT INTO public.household_invites(household_id, code, expires_at, uses, max_uses)
        VALUES (p_household, candidate, now() + interval '7 days', 0, 10);
      END IF;
      RETURN candidate;
    EXCEPTION WHEN unique_violation THEN
      CONTINUE;
    END;
  END LOOP;

  RAISE EXCEPTION 'Could not generate a unique invite code' USING ERRCODE = '23505';
END
$function$;

CREATE OR REPLACE FUNCTION public.join_household(p_code text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  uid uuid := auth.uid();
  inv record;
  n integer;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO inv
  FROM public.household_invites
  WHERE code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'))
    AND expires_at > now()
    AND uses < max_uses
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_or_expired_invite' USING ERRCODE = 'P0002';
  END IF;

  IF (SELECT count(*) FROM public.household_members WHERE household_id = inv.household_id) >= 8 THEN
    RAISE EXCEPTION 'household is full' USING ERRCODE = '54000';
  END IF;
  IF (SELECT count(*) FROM public.household_members WHERE user_id = uid) >= 5 THEN
    RAISE EXCEPTION 'household limit reached' USING ERRCODE = '54000';
  END IF;

  INSERT INTO public.household_members(household_id, user_id, role)
  VALUES (inv.household_id, uid, 'editor')
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN
    UPDATE public.household_invites SET uses = uses + 1 WHERE code = inv.code;
  END IF;

  RETURN inv.household_id;
END
$function$;

CREATE OR REPLACE FUNCTION public.transfer_household_leadership(
  p_household uuid, p_user uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;
  IF p_user IS NULL OR p_user = auth.uid() THEN
    RAISE EXCEPTION 'Choose another group member' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.households WHERE id = p_household FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Group not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.bp_is_household_leader(p_household) THEN
    RAISE EXCEPTION 'Only the group Leader can transfer leadership' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.household_members
    WHERE household_id = p_household AND user_id = p_user AND role IN ('editor', 'checker')
  ) THEN
    RAISE EXCEPTION 'Target must be a non-Leader group member' USING ERRCODE = '22023';
  END IF;

  UPDATE public.household_members
  SET role = 'editor'
  WHERE household_id = p_household AND user_id = auth.uid() AND role = 'owner';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Current user is not the group Leader' USING ERRCODE = '42501';
  END IF;

  UPDATE public.household_members
  SET role = 'owner'
  WHERE household_id = p_household AND user_id = p_user;
END
$function$;

-- Serialize membership removal with role changes and leadership transfers.
CREATE OR REPLACE FUNCTION public.leave_household(p_household uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  PERFORM 1 FROM public.households WHERE id = p_household FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.household_members
    WHERE household_id = p_household AND user_id = uid
  ) THEN
    RETURN;
  END IF;

  UPDATE public.lists
  SET household_id = NULL
  WHERE household_id = p_household AND owner_id = uid;
  DELETE FROM public.household_members
  WHERE household_id = p_household AND user_id = uid;
END
$function$;

CREATE OR REPLACE FUNCTION public.remove_household_member(
  p_household uuid, p_user uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  PERFORM 1 FROM public.households WHERE id = p_household FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Group not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.bp_is_household_leader(p_household) THEN
    RAISE EXCEPTION 'Only the group Leader can remove members' USING ERRCODE = '42501';
  END IF;
  IF p_user IS NULL OR p_user = auth.uid() THEN
    RAISE EXCEPTION 'Use the leave-group action to remove yourself' USING ERRCODE = '22023';
  END IF;

  UPDATE public.lists
  SET household_id = NULL
  WHERE household_id = p_household AND owner_id = p_user;
  DELETE FROM public.household_members
  WHERE household_id = p_household AND user_id = p_user;
END
$function$;

-- RLS controls rows; these grants also remove non-RLS TRUNCATE and schema-changing powers.
REVOKE TRUNCATE, REFERENCES, TRIGGER
  ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;

REVOKE ALL ON TABLE
  public.applied_ops, public.households, public.household_members,
  public.household_invites, public.lists, public.list_items
  FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT ON public.applied_ops TO authenticated;
GRANT SELECT ON public.households, public.household_members TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.lists, public.list_items TO authenticated;

ALTER TABLE public.applied_ops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.households ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.household_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.household_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.list_items ENABLE ROW LEVEL SECURITY;

-- Replace every list/item policy so older permissive ALL/UPDATE policies cannot
-- broaden the new role checks.
DO $policies$
DECLARE
  p record;
BEGIN
  FOR p IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('lists', 'list_items')
  LOOP
    EXECUTE format('DROP POLICY %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
  END LOOP;
END
$policies$;

CREATE POLICY lists_select ON public.lists
  FOR SELECT TO authenticated
  USING (public.bp_can_access_list(id));

CREATE POLICY lists_insert ON public.lists
  FOR INSERT TO authenticated
  WITH CHECK (
    owner_id = auth.uid()
    AND (household_id IS NULL OR public.bp_can_edit_household(household_id))
  );

CREATE POLICY lists_update ON public.lists
  FOR UPDATE TO authenticated
  USING (public.bp_can_edit_list(id))
  WITH CHECK (
    owner_id = auth.uid()
    OR household_id IS NULL
    OR public.bp_can_edit_list(id)
  );

CREATE POLICY items_select ON public.list_items
  FOR SELECT TO authenticated
  USING (public.bp_can_access_list(list_id));

CREATE POLICY items_insert ON public.list_items
  FOR INSERT TO authenticated
  WITH CHECK (public.bp_can_edit_list(list_id));

CREATE POLICY items_update ON public.list_items
  FOR UPDATE TO authenticated
  USING (public.bp_can_access_list(list_id))
  WITH CHECK (public.bp_can_access_list(list_id));

DROP TRIGGER IF EXISTS lists_guard ON public.lists;
CREATE TRIGGER lists_guard
  BEFORE UPDATE ON public.lists
  FOR EACH ROW EXECUTE FUNCTION public.bp_lists_guard();

DROP TRIGGER IF EXISTS list_items_role_guard ON public.list_items;
CREATE TRIGGER list_items_role_guard
  BEFORE INSERT OR UPDATE ON public.list_items
  FOR EACH ROW EXECUTE FUNCTION public.bp_list_items_role_guard();

-- RLS policies and RPCs need only authenticated execution; anonymous execution is unnecessary.
REVOKE ALL ON FUNCTION public.bp_is_member(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bp_can_access_list(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bp_household_members(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.apply_ops(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_household(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_invite(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.join_household(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.leave_household(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.remove_household_member(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bp_is_household_leader(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bp_can_edit_household(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bp_can_edit_list(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bp_can_check_list(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rename_household(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_household_member_role(uuid, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.transfer_household_leadership(uuid, uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.bp_is_member(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bp_can_access_list(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bp_household_members(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.apply_ops(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_household(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_invite(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.join_household(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.leave_household(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.remove_household_member(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bp_is_household_leader(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bp_can_edit_household(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bp_can_edit_list(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bp_can_check_list(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rename_household(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_household_member_role(uuid, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.transfer_household_leadership(uuid, uuid) TO authenticated, service_role;
