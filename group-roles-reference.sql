-- REVIEW-ONLY TEMPLATE — NOT A PRODUCTION MIGRATION.
-- The repository does not include the deployed Supabase schema. The relation names and
-- columns below are assumptions, not verified facts. This guard intentionally aborts
-- execution; all example DDL and function definitions are additionally inside a comment.
--
-- Before adapting: inspect the actual schema, constraints, grants, existing RPC bodies,
-- RLS policies, shared-list/item tables, and all callers. Apply only as a reviewed migration.
DO $template_guard$
BEGIN
  RAISE EXCEPTION 'Reference template only: inspect and adapt to the actual Supabase schema before applying';
END
$template_guard$;

-- Assumed existing relations:
--   public.households(id uuid primary key, name text, ...)
--   public.household_members(household_id uuid, user_id uuid, role text, ...)
--
-- Role mapping used by the client:
--   owner  = sole group Leader
--   editor = can manage group lists and items
--   checker = can only check/uncheck items on shared lists
-- Existing "member" rows should be migrated to "editor" only after confirming that is
-- the intended legacy permission mapping.
--
-- Resolve existing bad/duplicate role data before applying equivalent constraints:
-- UPDATE public.household_members SET role = 'editor' WHERE role = 'member';
-- ALTER TABLE public.household_members ADD CONSTRAINT household_members_role_check
--   CHECK (role IN ('owner', 'editor', 'checker'));
-- CREATE UNIQUE INDEX household_members_one_owner_per_group
--   ON public.household_members (household_id) WHERE role = 'owner';
--
-- The unique partial index enforces one Leader per group, but the transfer RPC must still
-- perform both role updates in one transaction. Lock the parent group to serialize transfers.

/*
CREATE OR REPLACE FUNCTION public.rename_household(p_household uuid, p_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'Group name must be 1 to 80 characters';
  END IF;
  PERFORM 1 FROM public.households WHERE id = p_household FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Group not found';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.household_members
    WHERE household_id = p_household AND user_id = auth.uid() AND role = 'owner'
  ) THEN
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
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_role IS NULL OR p_role NOT IN ('editor', 'checker') OR p_user IS NULL OR p_user = auth.uid() THEN
    RAISE EXCEPTION 'Use leadership transfer to change Leader; only Editor or Checker can be assigned';
  END IF;
  PERFORM 1 FROM public.households WHERE id = p_household FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Group not found';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.household_members
    WHERE household_id = p_household AND user_id = auth.uid() AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'Only the group Leader can change roles' USING ERRCODE = '42501';
  END IF;
  UPDATE public.household_members
  SET role = p_role
  WHERE household_id = p_household AND user_id = p_user AND role IN ('editor', 'checker');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target must be a non-Leader group member';
  END IF;
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
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_user = auth.uid() THEN
    RAISE EXCEPTION 'Choose another group member';
  END IF;
  PERFORM 1 FROM public.households WHERE id = p_household FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Group not found';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.household_members
    WHERE household_id = p_household AND user_id = auth.uid() AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'Only the group Leader can transfer leadership' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.household_members
    WHERE household_id = p_household AND user_id = p_user AND role IN ('editor', 'checker')
  ) THEN
    RAISE EXCEPTION 'Target must be a non-Leader group member';
  END IF;
  UPDATE public.household_members
  SET role = 'editor'
  WHERE household_id = p_household AND user_id = auth.uid() AND role = 'owner';
  UPDATE public.household_members
  SET role = 'owner'
  WHERE household_id = p_household AND user_id = p_user;
END
$function$;

-- After adapting and reviewing the functions and schema, restrict invocation:
-- REVOKE ALL ON FUNCTION public.rename_household(uuid, text) FROM PUBLIC, anon;
-- REVOKE ALL ON FUNCTION public.set_household_member_role(uuid, uuid, text) FROM PUBLIC, anon;
-- REVOKE ALL ON FUNCTION public.transfer_household_leadership(uuid, uuid) FROM PUBLIC, anon;
-- GRANT EXECUTE ON FUNCTION public.rename_household(uuid, text) TO authenticated;
-- GRANT EXECUTE ON FUNCTION public.set_household_member_role(uuid, uuid, text) TO authenticated;
-- GRANT EXECUTE ON FUNCTION public.transfer_household_leadership(uuid, uuid) TO authenticated;
--
-- RLS and authorization checklist (cannot be safely expressed without the real list schema):
-- * Group rows and member rosters are readable only by current group members.
-- * Membership, role changes, invites, and member removals are writable only through
--   owner-authorized RPCs; users cannot insert/update their own role directly.
-- * Leaders and Editors may create/edit/delete shared lists and list items.
-- * Checkers may change only the checked state on shared-list items. PostgreSQL RLS
--   policies are row-level, not column-level; use a narrowly scoped RPC for check state
--   and deny direct checker updates that can alter item names, quantities, ownership, or
--   list membership.
-- * Personal-list ownership and private-list access remain unchanged.
-- * Leaving/removing a member revokes access immediately without transferring list
--   ownership. Leadership transfer and member updates must serialize on the group row.
--
-- Required tests after adaptation: unauthorized RPC calls; cross-group reads/writes;
-- Editor and Checker permissions; Checker attempts to edit/delete/add; exactly one Leader;
-- concurrent transfers; leave/remove access revocation; invite expiration/use limits; and
-- private-list ownership before/after share and unshare.
*/
