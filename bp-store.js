/* bp-store.js — relational data layer for Better Price (lists/items, households, price book, favorites, deals)
 *
 * Model: Supabase is the source of truth. Local state = last-known server rows ("srv") + an OUTBOX of pending ops.
 * The app's existing arrays (glists/gitems in localStorage) are a PROJECTION of srv + outbox, so the old UI keeps working:
 *   saveU('glists'|'gitems', arr) -> bp.interceptSave() diffs against the projection and enqueues record-level ops.
 * Ops are flushed through the apply_ops RPC (idempotent, per-field conflict handling, see the SQL migration).
 * Offline: edits land in the outbox (persisted), the UI shows "Saved on this device", and the outbox drains on reconnect.
 * DOM-free on purpose (UI lives in bp-ui.js) so the logic is unit-testable.
 */
(function (global) {
  'use strict';

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const ITEM_FIELDS = ['name', 'qty', 'price', 'store', 'notes', 'done'];
  const BATCH = 50;
  const PULL_OVERLAP = 500;            // re-read this many seq values back: a txn that committed late can't be skipped
  const RETRY_MS = [2000, 5000, 15000, 30000, 60000];

  const newId = () => {
    if (global.crypto && crypto.randomUUID) return crypto.randomUUID();
    const b = new Uint8Array(16); crypto.getRandomValues(b); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    const x = Array.from(b, v => v.toString(16).padStart(2, '0')).join('');
    return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
  };
  const isUuid = v => typeof v === 'string' && UUID_RE.test(v);
  const clone = o => JSON.parse(JSON.stringify(o));

  const bp = (global.bp = {
    enabled: false, newId, isUuid,
    host: { onChange() {}, onRemap() {}, onStatus() {}, toast() {} },
  });

  const S = {
    sb: null, uid: null, email: '', enabled: false, generation: 0,
    srv: { lists: {}, items: {} },          // last known server rows by id
    cursor: { lists: 0, items: 0 },
    outbox: [],                              // pending ops, in order
    idmap: {},                               // legacy non-uuid id -> uuid (stable across saves)
    hydrated: false, migrated: false,
    loc: { lists: {}, items: {} },           // current projection (app shape), used for diffing
    flushing: false, pulling: false, pullAgain: false, error: null, retryN: 0,
    timers: { flush: null, retry: null, pull: null },
    chan: null, lastFullPull: 0, listeners: {}, extras: {}, session: null,
  };
  bp._S = S;                                  // exposed for tests / debugging

  /* ------------------------------ persistence ------------------------------ */
  const stateKey = () => `bpr_${S.uid}_state`;
  const appKey = k => `bp_${S.uid}_${k}`;   // identical to saveU()'s per-user namespace
  function persist() {
    try {
      localStorage.setItem(stateKey(), JSON.stringify({
        srv: S.srv, cursor: S.cursor, outbox: S.outbox, idmap: S.idmap, hydrated: S.hydrated, migrated: S.migrated, extras: S.extras,
      }));
    } catch (e) { console.error('bp persist failed (storage full?)', e); emit('persist-error'); }
  }
  function restore() {
    try {
      const st = JSON.parse(localStorage.getItem(stateKey()) || 'null');
      if (!st) return;
      S.srv = st.srv || S.srv; S.cursor = st.cursor || S.cursor; S.idmap = st.idmap || {};
      S.hydrated = !!st.hydrated; S.migrated = !!st.migrated; S.extras = st.extras || {};
      S.outbox = (st.outbox || []).map(o => { delete o.inflight; return o; });  // a crash mid-flush: server dedupes by op_id
    } catch (e) { console.error('bp restore failed', e); }
  }

  /* ------------------------------ events/status ------------------------------ */
  function emit(ev, data) { (S.listeners[ev] || []).forEach(fn => { try { fn(data); } catch (e) { console.error(e); } }); }
  bp.on = (ev, fn) => { (S.listeners[ev] = S.listeners[ev] || []).push(fn); return () => { S.listeners[ev] = S.listeners[ev].filter(f => f !== fn); }; };

  function computeStatus() {
    const pending = S.outbox.length, online = global.navigator ? navigator.onLine !== false : true;
    if (!S.enabled) return { state: 'local', pending: 0 };
    if (S.flushing && pending) return { state: 'syncing', pending };
    if (S.error && pending) return { state: 'error', pending };
    if (!online) return { state: pending ? 'saved' : 'offline', pending };
    return { state: pending ? 'saved' : 'synced', pending };
  }
  bp.status = computeStatus;
  function pushStatus() { const s = computeStatus(); bp.host.onStatus(s); emit('status', s); }

  /* ------------------------------ projection ------------------------------ */
  const listToApp = r => ({ id: r.id, name: r.name, householdId: r.household_id || null, ownerId: r.owner_id, shared: !!r.household_id });
  const itemToApp = r => {
    const o = {
      id: r.id, listId: r.list_id, name: r.name, qty: r.qty, price: r.price == null ? '' : String(+r.price),
      store: r.store || '', notes: r.notes || '', done: !!r.done,
    };
    if (r.starter_key) o.starterKey = r.starter_key;
    return o;
  };
  const priceOut = p => (p === '' || p == null || isNaN(parseFloat(p))) ? null : String(parseFloat(p));
  const normItem = i => ({
    name: String(i.name || '').trim(), qty: String(i.qty == null || i.qty === '' ? '1' : i.qty), price: priceOut(i.price),
    store: String(i.store || '').trim(), notes: String(i.notes || '').trim(), done: !!i.done,
  });

  function project() {
    const lists = {}, items = {}, order = [], itemOrder = [];
    Object.values(S.srv.lists).sort((a, b) => (a.created_at || '').localeCompare(b.created_at || '')).forEach(r => { lists[r.id] = Object.assign(listToApp(r), S.extras[r.id]); order.push(r.id); });
    Object.values(S.srv.items).sort((a, b) => (a.created_at || '').localeCompare(b.created_at || '')).forEach(r => {
      if (lists[r.list_id]) { items[r.id] = itemToApp(r); itemOrder.push(r.id); }
    });
    for (const op of S.outbox) {                // overlay pending local ops (they are newer than any server row we hold)
      switch (op.type) {
        case 'list_create': if (!lists[op.id]) order.push(op.id);
          lists[op.id] = Object.assign({ id: op.id, name: op.name, householdId: op.household_id || null, ownerId: S.uid, shared: !!op.household_id }, S.extras[op.id]); break;
        case 'list_patch': if (lists[op.id]) {
          if ('name' in op.patch) lists[op.id].name = op.patch.name;
          if ('household_id' in op.patch) { lists[op.id].householdId = op.patch.household_id || null; lists[op.id].shared = !!op.patch.household_id; }
        } break;
        case 'list_delete': delete lists[op.id]; for (const id of Object.keys(items)) if (items[id].listId === op.id) delete items[id]; break;
        case 'item_create': if (lists[op.list_id]) {
          if (!items[op.id]) itemOrder.push(op.id);
          items[op.id] = itemToApp({ id: op.id, list_id: op.list_id, name: op.name, qty: op.qty, price: op.price, store: op.store, notes: op.notes, done: op.done, starter_key: op.starter_key });
        } break;
        case 'item_patch': if (items[op.id]) {
          const p = {}; for (const k of Object.keys(op.patch)) p[k] = op.patch[k];
          if ('price' in p) p.price = p.price == null || p.price === '' ? '' : String(p.price);
          Object.assign(items[op.id], p);
        } break;
        case 'item_delete': delete items[op.id]; break;
      }
    }
    return { lists, items, order: order.filter(id => lists[id]), itemOrder: itemOrder.filter(id => items[id]) };
  }

  let lastProjectionJson = '';
  function materialize(force) {
    const p = project();
    S.loc = { lists: p.lists, items: p.items };
    const la = p.order.map(id => p.lists[id]), ia = p.itemOrder.map(id => p.items[id]);
    const json = JSON.stringify([la, ia]);
    try {
      localStorage.setItem(appKey('glists'), JSON.stringify(la));
      localStorage.setItem(appKey('gitems'), JSON.stringify(ia));
    } catch (e) { console.error('bp materialize failed', e); }
    if (force || json !== lastProjectionJson) { lastProjectionJson = json; bp.host.onChange({ lists: la, items: ia }); emit('change', { lists: la, items: ia }); }
  }

  /* ------------------------------ outbox ------------------------------ */
  const kindOf = t => t.split('_')[1];
  const entOf = t => t.split('_')[0];

  function dropListOps(listId) {               // a list that never reached the server takes its pending item ops with it
    S.outbox = S.outbox.filter(o => !(entOf(o.type) === 'item' && o.list_id === listId && !o.inflight));
  }

  function enqueue(op) {
    op.op_id = newId();
    const ent = entOf(op.type), kind = kindOf(op.type);
    if (ent === 'list' || ent === 'item') {
      for (let i = S.outbox.length - 1; i >= 0; i--) {   // coalesce into the latest NOT-in-flight op for the same record
        const q = S.outbox[i];
        if (entOf(q.type) !== ent || q.id !== op.id) continue;
        if (q.inflight) break;
        const qk = kindOf(q.type);
        if (qk === 'create' && kind === 'patch') { Object.assign(q, op.patch); persist(); return; }
        if (qk === 'create' && kind === 'delete') {      // never reached the server: cancel out
          S.outbox.splice(i, 1);
          if (ent === 'list') dropListOps(op.id);
          persist(); return;
        }
        if (qk === 'patch' && kind === 'patch') { Object.assign(q.patch, op.patch); persist(); return; }
        if (qk === 'patch' && kind === 'delete') { S.outbox.splice(i, 1); }
        break;
      }
    }
    S.outbox.push(op);
    persist();
  }

  function scheduleFlush(ms) {
    clearTimeout(S.timers.flush);
    S.timers.flush = setTimeout(flush, ms == null ? 350 : ms);
    pushStatus();
  }

  /* ------------------------------ diff (app arrays -> ops) ------------------------------ */
  function remapId(obj, kind, listIdLookup) {
    // Anything the app created with a non-uuid id (Date.now(), 'list_penny_…') gets a uuid. Mutated IN PLACE so the
    // app's own references stay valid; host.onRemap lets it patch activeListId / item.listId.
    if (isUuid(obj.id)) return;
    const old = String(obj.id), key = kind + ':' + old;
    const id = S.idmap[key] || (S.idmap[key] = newId());
    obj.id = id;
    if (kind === 'list') bp.host.onRemap(old, id);
  }

  function diffLists(arr) {
    const seen = new Set();
    for (const l of arr) {
      if (!l || l.id == null) continue;
      const legacy = isUuid(l.id) ? null : String(l.id);
      remapId(l, 'list');
      seen.add(l.id);
      const cur = S.loc.lists[l.id];
      const name = String(l.name || '').trim() || 'List';
      if (l.starterList) S.extras[l.id] = { starterList: true };
      if (!cur) {
        enqueue({ type: 'list_create', id: l.id, name, legacy_id: legacy });
        S.loc.lists[l.id] = { id: l.id, name, householdId: null, ownerId: S.uid, shared: false };
      } else if (cur.name !== name) {
        const base = (S.srv.lists[l.id] || {}).version || 0;
        enqueue({ type: 'list_patch', id: l.id, base_version: base, patch: { name } });
        cur.name = name;
      }
    }
    for (const id of Object.keys(S.loc.lists)) {
      if (seen.has(id)) continue;
      if (S.loc.lists[id].ownerId !== S.uid) {   // a shared list owned by someone else: members can't delete it
        bp.host.toast("Only the list owner can delete a shared list.");
        bp.refreshSoon(); continue;
      }
      enqueue({ type: 'list_delete', id });
      delete S.loc.lists[id];
    }
  }

  function diffItems(arr) {
    const seen = new Set();
    for (const it of arr) {
      if (!it || it.id == null) continue;
      remapId(it, 'item');
      const lk = 'list:' + it.listId;
      if (!isUuid(it.listId)) it.listId = S.idmap[lk] || it.listId;
      if (!isUuid(it.listId)) { console.warn('bp: item without a resolvable list id skipped', it); continue; }
      seen.add(it.id);
      const cur = S.loc.items[it.id], n = normItem(it);
      if (!cur) {
        enqueue({ type: 'item_create', id: it.id, list_id: it.listId, ...n, starter_key: it.starterKey || null });
        S.loc.items[it.id] = itemToApp({ id: it.id, list_id: it.listId, ...n, starter_key: it.starterKey });
        continue;
      }
      const c = normItem(cur), patch = {};
      for (const f of ITEM_FIELDS) if (JSON.stringify(c[f]) !== JSON.stringify(n[f])) patch[f] = n[f];
      if (Object.keys(patch).length) {
        const base = (S.srv.items[it.id] || {}).version || 0;
        enqueue({ type: 'item_patch', id: it.id, list_id: it.listId, base_version: base, patch });
        Object.assign(S.loc.items[it.id], itemToApp({ id: it.id, list_id: it.listId, ...n }));
      }
    }
    for (const id of Object.keys(S.loc.items)) {
      if (seen.has(id)) continue;
      const li = S.loc.items[id];
      delete S.loc.items[id];
      if (!S.loc.lists[li.listId]) continue;      // its list was deleted: the list_delete op covers it
      enqueue({ type: 'item_delete', id, list_id: li.listId });
    }
  }

  // Called from saveU(). Returns true when handled (caller must NOT write the legacy blob / mark it dirty).
  bp.interceptSave = function (k, arr) {
    if (!S.enabled || (k !== 'glists' && k !== 'gitems') || !Array.isArray(arr)) return false;
    try {
      if (k === 'glists') diffLists(arr); else diffItems(arr);
      localStorage.setItem(appKey(k), JSON.stringify(arr));
      const p = project(); lastProjectionJson = JSON.stringify([p.order.map(id => p.lists[id]), p.itemOrder.map(id => p.items[id])]);   // our own edit: don't echo it back as a change
      scheduleFlush();
      return true;
    } catch (e) { console.error('bp.interceptSave failed', e); return false; }
  };
  bp.isRelationalKey = k => S.enabled && (k === 'glists' || k === 'gitems');

  /* ------------------------------ server round-trips ------------------------------ */
  const isAuthErr = e => e && (e.status === 401 || e.code === 'PGRST301' || /jwt|not authenticated/i.test(e.message || ''));
  async function call(fn, sb = S.sb) {
    const generation = S.generation;
    let r = await fn();
    if (generation !== S.generation) throw new Error('Account changed while the request was in progress.');
    if (r.error && isAuthErr(r.error)) {
      await sb.auth.refreshSession();
      if (generation !== S.generation) throw new Error('Account changed while the request was in progress.');
      r = await fn();
      if (generation !== S.generation) throw new Error('Account changed while the request was in progress.');
    }
    if (r.error) throw r.error;
    return r.data;
  }
  const strip = o => { const c = { ...o }; delete c.inflight; return c; };
  const errorText = e => typeof e === 'string' ? e : (e && (e.message || e.details || e.hint)) || '';

  function applyRow(table, row) {                 // table: 'lists' | 'items'
    const bag = S.srv[table];
    if (row.deleted_at) {
      delete bag[row.id];
      if (table === 'lists') for (const id of Object.keys(S.srv.items)) if (S.srv.items[id].list_id === row.id) delete S.srv.items[id];
      return;
    }
    const cur = bag[row.id];
    if (!cur || row.version >= cur.version) bag[row.id] = row;
  }

  async function flush() {
    if (S.flushing || !S.enabled) return;
    if (global.navigator && navigator.onLine === false) { pushStatus(); return; }
    if (!S.outbox.length) { S.error = null; pushStatus(); return; }
    S.flushing = true; S.error = null;
    const generation = S.generation, sb = S.sb;
    let sawDuplicate = false;
    const rejectedOps = [];
    try {
      while (S.outbox.length) {
        if (generation !== S.generation) return;
        const batch = S.outbox.slice(0, BATCH); batch.forEach(o => { o.inflight = true; });
        pushStatus();
        let res;
        try { res = await call(() => sb.rpc('apply_ops', { ops: batch.map(strip) }), sb); }
        catch (e) {
          if (generation !== S.generation) return;
          batch.forEach(o => { delete o.inflight; });
          if (e && e.code === '22023') {              // malformed batch: retrying can never succeed, drop it rather than loop
            const message = errorText(e) || 'Malformed operation batch';
            const detail = { type: 'batch', op_ids: batch.map(o => o.op_id), message };
            console.error('bp: dropping malformed batch', detail);
            rejectedOps.push(detail);
            S.outbox.splice(0, batch.length); persist(); materialize();
            bp.host.toast(`Could not save list changes: ${message}`);
            continue;
          }
          throw e;
        }
        if (generation !== S.generation) return;
        const byId = {}; (res || []).forEach(r => { byId[r.op_id] = r; });
        const done = new Set(), conflicts = [], rejected = [];
        for (const op of batch) {
          const r = byId[op.op_id];
          if (!r) continue;                           // no verdict: keep it and retry
          done.add(op.op_id);
          if (r.status === 'duplicate') sawDuplicate = true;
          if (r.row && r.row.id) applyRow(entOf(op.type) === 'list' ? 'lists' : 'items', r.row);
          if (r.conflicts) conflicts.push({ op, c: r.conflicts });
          if (r.status === 'rejected' || r.status === 'deleted') rejected.push({ op, r });
        }
        S.outbox = S.outbox.filter(o => !done.has(o.op_id));
        batch.forEach(o => { delete o.inflight; });
        persist(); materialize();
        if (conflicts.length) {
          const f = new Set(); conflicts.forEach(x => Object.keys(x.c).forEach(k => f.add(k)));
          bp.host.toast(`Someone else changed ${[...f].join(', ')} at the same time. Their version was kept.`);
          emit('conflicts', conflicts);
        }
        if (rejected.length) {
          const hard = rejected.filter(x => x.r.status === 'rejected');
          if (hard.length) {
            const detail = hard.map(({ op, r }) => ({
              type: op.type, id: op.id, op_id: op.op_id,
              message: r.message || r.error_message || r.error || r.reason || r.details || r.hint || null,
            }));
            rejectedOps.push(...detail);
            console.error('bp: ops rejected', detail);
            const message = detail.find(x => x.message)?.message;
            bp.host.toast(message
              ? `Could not save list changes: ${errorText(message)}`
              : "A change couldn't be saved. Your saved list was restored. Please try again; if this keeps happening, contact support.");
          }
          sawDuplicate = true;                        // force a resync so local state matches the server
        }
        if (done.size < batch.length) throw new Error('server returned no verdict for some ops');
      }
      S.retryN = 0;
    } catch (e) {
      if (generation !== S.generation) return;
      console.error('bp sync failed:', e && (e.message || e));
      S.error = e; S.retryN++; scheduleRetry();
    } finally {
      if (generation === S.generation) { S.flushing = false; pushStatus(); }
    }
    if (sawDuplicate || S.pullAgain) bp.refreshSoon(true);
    return { rejected: rejectedOps };
  }
  bp.flush = flush;
  bp.retryNow = () => { S.error = null; clearTimeout(S.timers.retry); return flush(); };
  function scheduleRetry() { clearTimeout(S.timers.retry); S.timers.retry = setTimeout(flush, RETRY_MS[Math.min(S.retryN - 1, RETRY_MS.length - 1)]); }

  async function pull(opts) {
    const full = !!(opts && opts.full);
    if (!S.enabled || (global.navigator && navigator.onLine === false)) return;
    if (S.pulling) { S.pullAgain = true; return; }
    S.pulling = true; S.pullAgain = false;
    const generation = S.generation, sb = S.sb;
    try {
      const seen = { lists: new Set(), items: new Set() };
      for (const [table, key] of [['lists', 'lists'], ['list_items', 'items']]) {
        let since = full ? 0 : Math.max(0, S.cursor[key] - PULL_OVERLAP), max = S.cursor[key];
        for (;;) {
          const rows = await call(() => sb.from(table).select('*').gt('seq', since).order('seq', { ascending: true }).limit(1000), sb);
          if (generation !== S.generation) return;
          rows.forEach(r => { applyRow(key, r); if (!r.deleted_at) seen[key].add(r.id); if (r.seq > max) max = r.seq; });
          if (rows.length < 1000) break;
          since = rows[rows.length - 1].seq;
        }
        S.cursor[key] = max;
      }
      if (full) {                                    // access can vanish without a tombstone (removed from a household)
        for (const id of Object.keys(S.srv.lists)) if (!seen.lists.has(id)) delete S.srv.lists[id];
        for (const id of Object.keys(S.srv.items)) if (!seen.items.has(id) || !S.srv.lists[S.srv.items[id].list_id]) delete S.srv.items[id];
        S.lastFullPull = Date.now();
      }
      S.hydrated = true;
      persist(); materialize();
    } finally { if (generation === S.generation) S.pulling = false; }
    if (S.pullAgain) { S.pullAgain = false; return pull(); }
  }
  bp.pull = pull;
  bp.refreshSoon = function (full) {
    clearTimeout(S.timers.pull);
    S.timers.pull = setTimeout(() => { if (S.flushing) { S.pullAgain = true; return; } pull({ full: !!full }).catch(e => console.error('bp pull failed', e)); }, 400);
  };

  /* ------------------------------ lifecycle ------------------------------ */
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

  bp.start = async function (sb, session) {
    if (S.uid && S.uid !== session.user.id) bp.stop();
    S.sb = sb; S.session = session; S.uid = session.user.id; S.email = session.user.email || '';
    const generation = S.generation;
    restore();
    if (!S.migrated) {
      if (global.navigator && navigator.onLine === false) return false;       // legacy blob mode until we are online once
      try {
        const flag = await call(() => sb.from('user_flags').select('relational_migrated_at').eq('user_id', session.user.id).maybeSingle(), sb);
        if (generation !== S.generation) return false;
        if (!(flag && flag.relational_migrated_at)) {
          if (typeof global._sbFlushSync === 'function') await global._sbFlushSync();   // push the last local blob edits first
          if (generation !== S.generation) return false;
          await call(() => sb.rpc('bp_migrate_blob'), sb);
        }
        if (generation !== S.generation) return false;
        S.migrated = true; persist();
      } catch (e) {
        if (generation !== S.generation) return false;
        console.error('bp: migration failed, staying on legacy storage', e); return false;
      }
    }
    if (!S.hydrated) {                                                          // never wipe local lists on a failed first load
      try { S.enabled = true; await withTimeout(pull({ full: true }), 10000); }
      catch (e) {
        if (generation !== S.generation) return false;
        S.enabled = false; console.error('bp: first load failed, staying on legacy storage', e); setTimeout(() => bp.retryStart && bp.retryStart(), 15000); return false;
      }
      if (generation !== S.generation) return false;
    }
    S.enabled = true; bp.enabled = true;
    materialize(true);
    wire(); subscribe();
    pull({ full: true }).catch(e => console.error('bp refresh failed', e));
    flush();
    pushStatus();
    return true;
  };

  let wired = false;
  function wire() {
    if (wired || !global.addEventListener) return; wired = true;
    global.addEventListener('online', () => { pushStatus(); flush(); bp.refreshSoon(true); });
    global.addEventListener('offline', pushStatus);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || !S.enabled) return;
      flush(); bp.refreshSoon(Date.now() - S.lastFullPull > 10 * 60 * 1000);
    });
    setInterval(() => { if (S.enabled && document.visibilityState === 'visible') bp.refreshSoon(false); }, 60000);
  }

  function subscribe() {
    if (S.chan || !S.sb.channel) return;
    const on = (table, fn, filter) => ({ event: '*', schema: 'public', table, ...(filter ? { filter } : {}) });
    S.chan = S.sb.channel('bp-' + S.uid)
      .on('postgres_changes', on('lists'), () => bp.refreshSoon(false))
      .on('postgres_changes', on('list_items'), () => bp.refreshSoon(false))
      .on('postgres_changes', on('favorite_items'), () => emit('favorites'))
      .on('postgres_changes', on('deals'), () => emit('deals'))
      .on('postgres_changes', on('price_alerts', null, 'user_id=eq.' + S.uid), p => emit('alert', p.new))
      .subscribe(st => { if (st === 'SUBSCRIBED') bp.refreshSoon(false); });
  }

  bp.retryStart = () => (S.sb && S.session && !S.enabled) ? bp.start(S.sb, S.session) : null;

  bp.stop = function () {
    try { if (S.chan) S.sb.removeChannel(S.chan); } catch (e) { /* ignore */ }
    Object.values(S.timers).forEach(clearTimeout);
    S.generation++; S.chan = null; S.enabled = false; bp.enabled = false; S.uid = null;
    S.sb = null; S.session = null; S.email = ''; S.flushing = false; S.pulling = false; S.pullAgain = false;
    S.retryN = 0; S.error = null;
    S.srv = { lists: {}, items: {} }; S.cursor = { lists: 0, items: 0 }; S.outbox = []; S.idmap = {}; S.extras = {}; S.hydrated = false; S.migrated = false;
    S.loc = { lists: {}, items: {} }; lastProjectionJson = '';
  };

  /* ------------------------------ households ------------------------------ */
  const rpc = (fn, args) => call(() => S.sb.rpc(fn, args));
  bp.households = {
    async list() {
      const hs = await call(() => S.sb.from('households').select('id,name,created_at').order('created_at'));
      const out = [];
      for (const h of hs) out.push({ ...h, members: await rpc('bp_household_members', { p_household: h.id }) });
      return out;
    },
    create: async name => { const id = await rpc('create_household', { p_name: name }); return id; },
    invite: hid => rpc('create_invite', { p_household: hid }),
    rename: (hid, name) => rpc('rename_household', { p_household: hid, p_name: name }),
    setMemberRole: (hid, uid, role) => rpc('set_household_member_role', { p_household: hid, p_user: uid, p_role: role }),
    transferLeadership: (hid, uid) => rpc('transfer_household_leadership', { p_household: hid, p_user: uid }),
    async join(code) { const id = await rpc('join_household', { p_code: code }); await pull({ full: true }); return id; },
    async leave(hid) { await rpc('leave_household', { p_household: hid }); await pull({ full: true }); },
    async removeMember(hid, uid) { await rpc('remove_household_member', { p_household: hid, p_user: uid }); },
  };
  // Sharing is queued like any list edit; database role policies decide who can change it.
  bp.shareList = function (listId, householdId) {
    const l = S.loc.lists[listId];
    if (!l) throw new Error('List is not available.');
    enqueue({ type: 'list_patch', id: listId, base_version: (S.srv.lists[listId] || {}).version || 0, patch: { household_id: householdId || null } });
    materialize(); scheduleFlush(0);
  };
  bp.me = () => S.uid;

  /* ------------------------------ favorites / recent ------------------------------ */
  bp.favorites = {
    // scope: household id for a shared list, or null for personal
    async list(householdId) {
      let q = S.sb.from('favorite_items').select('*').eq('hidden', false)
        .order('pinned', { ascending: false }).order('add_count', { ascending: false }).order('last_added_at', { ascending: false }).limit(80);
      q = householdId ? q.eq('household_id', householdId) : q.is('household_id', null);
      return call(() => q);
    },
    pin: (id, pinned) => call(() => S.sb.from('favorite_items').update({ pinned }).eq('id', id)),
    hide: id => call(() => S.sb.from('favorite_items').update({ hidden: true, pinned: false }).eq('id', id)),
  };

  /* ------------------------------ price book ------------------------------ */
  const PB_KEY = () => `bpr_${S.uid}_pricebook`;
  bp.price = {
    // entries: [{product_name, store, unit_price, base_unit, unit_family, currency, pkg_*, discount_*, source}]
    add(entries, householdId) {
      let n = 0;
      for (const e of entries) {
        if (!(e.unit_price > 0) || !String(e.product_name || '').trim()) continue;
        enqueue({ type: 'price_add', id: newId(), household_id: householdId || null, observed_at: new Date().toISOString().slice(0, 10), source: 'compare', ...e });
        n++;
      }
      scheduleFlush(0); return n;
    },
    async history() {
      try {
        const rows = await call(() => S.sb.from('price_entries').select('*').order('observed_at', { ascending: false })
          .order('created_at', { ascending: false }).limit(1500));
        try { localStorage.setItem(PB_KEY(), JSON.stringify(rows)); } catch (e) { /* cache is best effort */ }
        return { rows, cached: false };
      } catch (e) {
        const c = JSON.parse(localStorage.getItem(PB_KEY()) || 'null');
        if (c) return { rows: c, cached: true };
        throw e;
      }
    },
    remove: id => call(() => S.sb.from('price_entries').update({ deleted_at: new Date().toISOString() }).eq('id', id)),
    targets: () => call(() => S.sb.from('price_targets').select('*').order('updated_at', { ascending: false })),
    setTarget: t => call(() => S.sb.from('price_targets').upsert({
      product_key: normKey(t.product_name), product_name: t.product_name, target_unit_price: t.target_unit_price,
      base_unit: t.base_unit, store: t.store || '', active: true, updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,product_key,base_unit,store' })),
    deleteTarget: id => call(() => S.sb.from('price_targets').delete().eq('id', id)),
    alerts: () => call(() => S.sb.from('price_alerts').select('*').is('read_at', null).order('created_at', { ascending: false }).limit(50)),
    markAlertsRead: () => call(() => S.sb.from('price_alerts').update({ read_at: new Date().toISOString() }).is('read_at', null)),
  };
  // Must match SQL bp_name_key(): lower-case, non-alphanumerics -> single space, trimmed.
  function normKey(t) { return String(t || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }
  bp.normKey = normKey;

  // Verdict from the user's OWN recorded prices (rows newest first) for ONE product_key + base_unit.
  // Nothing here is a market claim: "lowest" means lowest among prices you/your household saved.
  //   code: none | target | new | lowest | near | good | high | fair
  //   n / last: how many recorded prices and the newest observed_at, so the UI can show the sample behind the verdict.
  // label is an English fallback only; bp-ui.js renders translated copy from `code`.
  bp.price.verdict = function (rows, target) {
    const n = rows.length;
    if (!n) return { code: 'none', label: 'No data', n: 0, last: null };
    const latest = rows[0], p = +latest.unit_price, meta = { n, last: latest.observed_at };
    if (target && p <= +target.target_unit_price) return { ...meta, code: 'target', label: 'At or below your target' };
    if (n < 3) return { ...meta, code: 'new', label: 'Not enough history yet' };
    const min = Math.min(...rows.map(r => +r.unit_price));            // across everything recorded, so "lowest" is literally true
    if (p <= min) return { ...meta, code: 'lowest', label: "Lowest you've recorded" };
    if (p <= min * 1.03) return { ...meta, code: 'near', label: 'Close to your lowest' };
    const cutoff = Date.now() - 120 * 864e5;                           // "usual" = median of the last 120 days (all history if that is too thin)
    let pool = rows.filter(r => new Date(r.observed_at).getTime() >= cutoff);
    if (pool.length < 3) pool = rows;
    const prices = pool.map(r => +r.unit_price).sort((a, b) => a - b), med = prices[Math.floor(prices.length / 2)];
    if (p <= med * 0.85) return { ...meta, code: 'good', label: 'Good price (15%+ below your usual)' };
    if (p >= med * 1.15) return { ...meta, code: 'high', label: 'Higher than your usual' };
    return { ...meta, code: 'fair', label: 'In line with your usual' };
  };

  /* ------------------------------ deals ------------------------------ */
  const FAMILY_BASE = u => (['oz', 'lb', 'g', 'kg'].includes(u)) ? 'oz' : (['ml', 'l', 'gal'].includes(u)) ? 'fl oz' : (['ft', 'in', 'yd', 'm'].includes(u)) ? 'ft' : u;
  // Effective unit price of a deal in the comparison engine's base units. unitRates = the app's UNIT_RATES table.
  // BOGO: pricing assumes you buy complete sets (buy N, get M free  =>  you pay N/(N+M) of the shelf price).
  bp.deals = {
    effective(d, unitRates) {
      const rates = unitRates || global.UNIT_RATES || {};
      const price = +d.pkg_price; let net = price;
      if (d.discount_type === 'p') net = price * (1 - Math.min(+d.discount_value, 100) / 100);
      else if (d.discount_type === 'd') net = Math.max(0, price - +d.discount_value);
      else if (d.discount_type === 'bogo') net = price * d.buy_qty / (d.buy_qty + d.get_qty);
      const rate = rates[d.pkg_unit]; if (!rate) return null;
      const total = +d.pkg_size * +d.pkg_qty * rate;
      return { unitPrice: net / total, baseUnit: FAMILY_BASE(d.pkg_unit), net };
    },
    // How the deal maps onto a comparison card (the engine already understands % off and flat off).
    toCard(d) {
      let dv = 0, dt = 'p';
      if (d.discount_type === 'p') { dv = +d.discount_value; dt = 'p'; }
      else if (d.discount_type === 'd') { dv = +d.discount_value; dt = 'f'; }
      else if (d.discount_type === 'bogo') { dv = d.get_qty / (d.buy_qty + d.get_qty) * 100; dt = 'p'; }
      return { n: d.product_name + (d.store ? ' at ' + d.store : ''), p: +d.pkg_price, s: +d.pkg_size, q: +d.pkg_qty, u: d.pkg_unit, dv, dt };
    },
    list: () => call(() => S.sb.from('deals').select('*').is('deleted_at', null).order('valid_to', { ascending: true, nullsFirst: false }).limit(300)),
    add: d => call(() => S.sb.from('deals').insert(d).select().single()),
    update: (id, d) => call(() => S.sb.from('deals').update(d).eq('id', id).select().single()),
    clip: (id, clipped) => call(() => S.sb.from('deals').update({ clipped }).eq('id', id)),
    remove: id => call(() => S.sb.from('deals').update({ deleted_at: new Date().toISOString() }).eq('id', id)),
    matchesForList: listId => call(() => S.sb.rpc('bp_match_deals', { p_list: listId })),
  };

  bp.normItem = normItem;
  if (typeof module !== 'undefined' && module.exports) module.exports = bp;
})(typeof window !== 'undefined' ? window : globalThis);
