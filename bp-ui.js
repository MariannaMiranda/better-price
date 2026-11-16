/* bp-ui.js — UI for the relational features. Depends on bp-store.js. All strings are escaped via h(). English-only for now. */
(function (global) {
  'use strict';
  const bp = global.bp;
  const ui = (bp.ui = { host: { activeListId: () => null, addItems: () => 0, fillCard: () => false, currency: () => '$', unitRates: () => ({}), preferredStores: () => [], accessToken: async () => null } });

  const h = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (sel, root) => (root || document).querySelector(sel);
  const money = (n, cur) => `${cur || '$'}${(+n).toFixed(+n < 1 ? 4 : 3)}`;
  const fmtDate = d => { try { return new Date(d + (String(d).length === 10 ? 'T00:00:00' : '')).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); } catch (e) { return d; } };
  const toast = (m, t) => bp.host.toast(m, t);
  const online = () => navigator.onLine !== false;

  const CSS = `
  .bpx-pill{display:none;align-items:center;gap:6px;border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.08);color:#fff;font:600 12px var(--font,system-ui);padding:5px 10px;border-radius:999px;cursor:pointer;margin-right:6px;white-space:nowrap}
  .bpx-pill.on{display:inline-flex}.bpx-dot{width:8px;height:8px;border-radius:50%;background:#9ca3af;flex:none}
  .bpx-pill[data-s=synced] .bpx-dot{background:#10b981}.bpx-pill[data-s=saved] .bpx-dot{background:#f59e0b}
  .bpx-pill[data-s=syncing] .bpx-dot{background:#60a5fa;animation:bpxp 1s infinite}.bpx-pill[data-s=error] .bpx-dot{background:#ef4444}.bpx-pill[data-s=offline] .bpx-dot{background:#9ca3af}
  @keyframes bpxp{50%{opacity:.25}}@media (prefers-reduced-motion:reduce){.bpx-dot{animation:none!important}}
  @media (max-width:520px){.bpx-pill .bpx-t{display:none}}
  .bpx-hubbtn{position:relative;display:none;background:none;border:none;color:rgba(255,255,255,.8);cursor:pointer;padding:4px 8px}.bpx-hubbtn.on{display:inline-flex}
  .bpx-hubbtn svg{width:20px;height:20px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
  .bpx-badge{position:absolute;top:-2px;right:0;background:#ef4444;color:#fff;font:700 10px var(--font,system-ui);min-width:16px;height:16px;border-radius:8px;display:none;align-items:center;justify-content:center;padding:0 4px}
  .bpx-ov{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9000;display:flex;align-items:flex-end;justify-content:center}
  .bpx-sheet{background:var(--card-bg,var(--white,#fff));color:var(--text);width:100%;max-width:640px;max-height:92vh;max-height:92dvh;border-radius:18px 18px 0 0;display:flex;flex-direction:column;box-shadow:0 -8px 40px rgba(0,0,0,.3)}
  @media (min-width:700px){.bpx-ov{align-items:center}.bpx-sheet{border-radius:18px;max-height:86vh}}
  .bpx-hd{display:flex;align-items:center;gap:8px;padding:14px 16px 8px}.bpx-hd h2{flex:1;font-size:17px;margin:0}
  .bpx-x{background:var(--input-bg);border:1px solid var(--border);color:var(--text);width:34px;height:34px;border-radius:50%;cursor:pointer;font-size:16px}
  .bpx-tabs{display:flex;gap:4px;padding:0 12px 8px;border-bottom:1px solid var(--border)}
  .bpx-tab{flex:1;background:none;border:none;color:var(--muted);font:600 13px var(--font,system-ui);padding:9px 6px;border-radius:9px;cursor:pointer}.bpx-tab[aria-selected=true]{background:var(--input-bg);color:var(--text)}
  .bpx-body{padding:12px 16px 20px;overflow:auto;flex:1}
  .bpx-card{border:1px solid var(--border);border-radius:12px;padding:11px 12px;margin-bottom:9px;background:var(--bg)}
  .bpx-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.bpx-grow{flex:1;min-width:0}
  .bpx-name{font-weight:700;font-size:14px}.bpx-sub{font-size:12px;color:var(--muted)}
  .bpx-price{font:700 15px var(--font,system-ui);white-space:nowrap}
  .bpx-chip{font:700 11px var(--font,system-ui);padding:3px 8px;border-radius:999px;border:1px solid var(--border);white-space:nowrap}
  .bpx-chip.g{color:#047857;background:#ecfdf5;border-color:#a7f3d0}.bpx-chip.b{color:#9a3412;background:#fff7ed;border-color:#fed7aa}.bpx-chip.n{color:var(--muted)}
  html[data-theme=dark] .bpx-chip.g,.dark .bpx-chip.g{background:#052015;color:#6ee7b7;border-color:#065f46}
  .bpx-btn{background:var(--input-bg);border:1px solid var(--border);color:var(--text);font:600 13px var(--font,system-ui);padding:8px 12px;border-radius:10px;cursor:pointer}
  .bpx-btn.p{background:#2f7fd0;border-color:#2f7fd0;color:#fff}.bpx-btn.d{color:var(--danger)}.bpx-btn:disabled{opacity:.5;cursor:not-allowed}
  .bpx-in{background:var(--input-bg);border:1.5px solid var(--border);color:var(--text);border-radius:9px;padding:8px 10px;font:14px var(--font,system-ui);min-width:0;width:100%}
  .bpx-lbl{font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;margin:8px 0 3px;display:block}
  .bpx-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.bpx-note{font-size:12px;color:var(--muted);margin:6px 0}
  .bpx-bar{display:none;gap:8px;flex-wrap:wrap;padding:8px 12px}.bpx-bar.on{display:flex}
  .bpx-chart{width:100%;height:auto;background:var(--input-bg);border-radius:10px}
  .bpx-empty{text-align:center;color:var(--muted);padding:26px 8px;font-size:14px}
  .bpx-code{font:700 20px ui-monospace,monospace;letter-spacing:2px;user-select:all}`;

  /* ------------------------------ mount ------------------------------ */
  let mounted = false, pill, hubBtn, bar, alertCount = 0;
  ui.mount = function () {
    if (mounted) return; mounted = true;
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    const right = $('.hdr-right');
    pill = document.createElement('button'); pill.className = 'bpx-pill'; pill.setAttribute('aria-live', 'polite');
    pill.innerHTML = '<span class="bpx-dot"></span><span class="bpx-t"></span>';
    pill.onclick = () => { const s = bp.status(); if (s.state === 'error' || s.state === 'saved') bp.retryNow(); else toast(s.state === 'offline' ? 'You are offline. Changes are saved on this device.' : 'Everything is synced.', 'ok'); };
    hubBtn = document.createElement('button'); hubBtn.className = 'bpx-hubbtn'; hubBtn.title = 'Savings: price book, deals, household'; hubBtn.setAttribute('aria-label', 'Savings hub');
    hubBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.2"/></svg><span class="bpx-badge" id="bpxBadge"></span>';
    hubBtn.onclick = () => openHub('book');
    if (right) { right.insertBefore(hubBtn, right.firstChild); right.insertBefore(pill, right.firstChild); }
    const gl = $('#tab-grocery .grocery-layout');
    if (gl) {
      bar = document.createElement('div'); bar.className = 'bpx-bar';
      bar.innerHTML = '<button class="bpx-btn" data-a="replenish">Replenish</button><button class="bpx-btn" data-a="sharelist">Share list</button><button class="bpx-btn" data-a="listdeals">Deals for this list</button>';
      bar.onclick = e => { const a = e.target.closest('[data-a]')?.dataset.a; if (a === 'replenish') openReplenish(); else if (a === 'sharelist') openHub('house'); else if (a === 'listdeals') openHub('deals'); };
      gl.parentNode.insertBefore(bar, gl);
    }
    const aw = $('.analysis-wrap');
    if (aw) {
      const b = document.createElement('button'); b.id = 'bpxSavePrices'; b.className = 'bpx-btn'; b.style.cssText = 'display:none;margin:8px 0';
      b.textContent = 'Save these prices to my Price Book'; b.onclick = openSavePrices; aw.appendChild(b);
    }
    bp.on('status', renderStatus);
    bp.on('alert', a => { alertCount++; setBadge(); if (a) toast(`Good price: ${a.product_name}${a.store ? ' at ' + a.store : ''} hit ${money(a.unit_price)}/${a.base_unit}`, 'ok'); });
    bp.on('conflicts', () => {});
    global.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });
  };
  ui.refresh = function () {                     // call after bp.start() resolves / on sign-out
    if (!mounted) return;
    const on = !!bp.enabled; pill.classList.toggle('on', on); hubBtn.classList.toggle('on', on); bar && bar.classList.toggle('on', on);
    if (on) { renderStatus(bp.status()); loadAlertCount(); }
  };
  ui.showSaveButton = show => { const b = $('#bpxSavePrices'); if (b) b.style.display = show && bp.enabled ? 'inline-block' : 'none'; };

  function renderStatus(s) {
    if (!pill) return;
    const T = { synced: 'Synced', saved: `Saved on device${s.pending ? ' (' + s.pending + ')' : ''}`, syncing: 'Syncing…', offline: 'Offline', error: 'Sync problem – tap to retry', local: '' }[s.state] || '';
    pill.dataset.s = s.state; $('.bpx-t', pill).textContent = T; pill.title = T;
  }
  async function loadAlertCount() { try { alertCount = (await bp.price.alerts()).length; setBadge(); } catch (e) { /* offline */ } }
  function setBadge() { const b = $('#bpxBadge'); if (!b) return; b.textContent = alertCount > 9 ? '9+' : alertCount; b.style.display = alertCount ? 'flex' : 'none'; }

  /* ------------------------------ sheet plumbing ------------------------------ */
  let sheetEl = null, lastFocus = null;
  function openSheet(title, bodyHtml, tabs, active) {
    closeSheet(); lastFocus = document.activeElement;
    sheetEl = document.createElement('div'); sheetEl.className = 'bpx-ov';
    sheetEl.innerHTML = `<div class="bpx-sheet" role="dialog" aria-modal="true" aria-label="${h(title)}">
      <div class="bpx-hd"><h2>${h(title)}</h2><button class="bpx-x" data-a="close" aria-label="Close">&#10005;</button></div>
      ${tabs ? `<div class="bpx-tabs" role="tablist">${tabs.map(([k, l]) => `<button class="bpx-tab" role="tab" data-a="tab" data-k="${k}" aria-selected="${k === active}">${h(l)}</button>`).join('')}</div>` : ''}
      <div class="bpx-body" id="bpxBody">${bodyHtml || ''}</div></div>`;
    sheetEl.addEventListener('mousedown', e => { if (e.target === sheetEl) closeSheet(); });
    document.body.appendChild(sheetEl); $('.bpx-x', sheetEl).focus();
    return $('#bpxBody', sheetEl);
  }
  function closeSheet() { if (sheetEl) { sheetEl.remove(); sheetEl = null; try { lastFocus && lastFocus.focus(); } catch (e) { /* gone */ } } }
  const body = () => $('#bpxBody');
  const busy = () => { body().innerHTML = '<div class="bpx-empty">Loading…</div>'; };
  const fail = e => { console.error(e); body().innerHTML = `<div class="bpx-empty">${online() ? 'Something went wrong. Try again in a moment.' : 'You are offline. This section needs a connection.'}</div>`; };

  /* ------------------------------ hub ------------------------------ */
  const TABS = [['book', 'Price Book'], ['deals', 'Deals'], ['house', 'Household']];
  async function openHub(tab) {
    openSheet('Savings', '', TABS, tab);
    sheetEl.addEventListener('click', hubClick);
    sheetEl.addEventListener('submit', e => e.preventDefault());
    sheetEl.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches && e.target.matches('[data-a="product"]')) hubClick(e); });
    if (ui._install) {
      const ib = document.createElement('button'); ib.className = 'bpx-btn'; ib.textContent = 'Install app';
      ib.onclick = async () => { try { ui._install.prompt(); await ui._install.userChoice; } catch (e) { /* dismissed */ } ui._install = null; ib.remove(); };
      $('.bpx-hd', sheetEl).insertBefore(ib, $('.bpx-x', sheetEl));
    } else if (/iphone|ipad/i.test(navigator.userAgent) && !navigator.standalone) {
      $('.bpx-tabs', sheetEl).insertAdjacentHTML('afterend', '<div class="bpx-note" style="padding:6px 16px 0">Install on iPhone/iPad: tap Share, then Add to Home Screen.</div>');
    }
    await showTab(tab);
  }
  async function showTab(tab) {
    $$('.bpx-tab').forEach(t => t.setAttribute('aria-selected', t.dataset.k === tab));
    busy();
    try { await ({ book: renderBook, deals: renderDeals, house: renderHouse })[tab](); } catch (e) { fail(e); }
  }
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];

  async function hubClick(e) {
    const el = e.target.closest('[data-a]'); if (!el) return;
    const a = el.dataset.a;
    try {
      if (a === 'close') return closeSheet();
      if (a === 'tab') return showTab(el.dataset.k);
      if (a === 'product') return renderProduct(el.dataset.k);
      if (a === 'back') return showTab('book');
      if (a === 'readalerts') { await bp.price.markAlertsRead(); alertCount = 0; setBadge(); return showTab('book'); }
      if (a === 'settarget') return saveTarget(el.dataset.k);
      if (a === 'deltarget') { await bp.price.deleteTarget(el.dataset.id); toast('Target removed', 'ok'); return renderProduct(el.dataset.k); }
      if (a === 'delentry') { await bp.price.remove(el.dataset.id); toast('Price removed', 'ok'); return renderProduct(el.dataset.k); }
      if (a === 'adddeal') return submitDeal();
      if (a === 'clip') { await bp.deals.clip(el.dataset.id, el.dataset.v === '1'); return showTab('deals'); }
      if (a === 'deldeal') { await bp.deals.remove(el.dataset.id); return showTab('deals'); }
      if (a === 'dealtocompare') return dealToCompare(el.dataset.id);
      if (a === 'importdeals') return importDeals();
      if (a === 'mkhouse') return mkHouse();
      if (a === 'joinhouse') return joinHouse();
      if (a === 'invite') { const c = await bp.households.invite(el.dataset.id); $('#bpxInv' + el.dataset.id).innerHTML = `<div class="bpx-note">Invite code (valid 7 days, 10 uses):</div><div class="bpx-code">${h(c)}</div>`; return; }
      if (a === 'leave') { if (confirm('Leave this household? Lists you own will stop being shared.')) { await bp.households.leave(el.dataset.id); return showTab('house'); } }
      if (a === 'kick') { if (confirm('Remove this member?')) { await bp.households.removeMember(el.dataset.hid, el.dataset.uid); return showTab('house'); } }
    } catch (err) { console.error(err); toast(errMsg(err), ''); }
  }
  function errMsg(e) {
    const m = (e && e.message) || '';
    if (/invalid_or_expired_invite/.test(m)) return 'That invite code is invalid or expired.';
    if (/household is full/.test(m)) return 'That household is full.';
    if (/limit reached/.test(m)) return 'You have reached the household limit.';
    if (!online()) return 'You are offline.';
    return 'That did not work. Please try again.';
  }

  /* ------------------------------ price book ------------------------------ */
  let pbRows = [], pbTargets = [];
  const groupKey = r => r.product_key + '|' + r.base_unit;
  async function renderBook() {
    const [{ rows, cached }, targets, alerts] = await Promise.all([bp.price.history(), bp.price.targets().catch(() => []), bp.price.alerts().catch(() => [])]);
    pbRows = rows; pbTargets = targets;
    const groups = new Map();
    rows.forEach(r => { const k = groupKey(r); (groups.get(k) || groups.set(k, []).get(k)).push(r); });
    let html = cached ? '<div class="bpx-note">Offline: showing your last saved Price Book.</div>' : '';
    if (alerts.length) html += `<div class="bpx-card"><div class="bpx-row"><div class="bpx-grow bpx-name">${alerts.length} good-price alert${alerts.length > 1 ? 's' : ''}</div><button class="bpx-btn" data-a="readalerts">Mark read</button></div>${alerts.slice(0, 6).map(a => `<div class="bpx-sub">${h(a.product_name)}${a.store ? ' at ' + h(a.store) : ''}: ${money(a.unit_price)}/${h(a.base_unit)} (target ${money(a.target_unit_price)})</div>`).join('')}</div>`;
    if (!groups.size) html += '<div class="bpx-empty">Nothing saved yet.<br>Run a comparison, then tap "Save these prices to my Price Book".</div>';
    for (const [k, list] of [...groups].sort((a, b) => b[1][0].observed_at.localeCompare(a[1][0].observed_at))) {
      const t = pbTargets.find(x => x.product_key === list[0].product_key && x.base_unit === list[0].base_unit && x.active);
      const v = bp.price.verdict(list, t), best = list.reduce((m, r) => (+r.unit_price < +m.unit_price ? r : m), list[0]);
      html += `<div class="bpx-card" data-a="product" data-k="${h(k)}" style="cursor:pointer" tabindex="0"><div class="bpx-row"><div class="bpx-grow"><div class="bpx-name">${h(list[0].product_name)}</div>
        <div class="bpx-sub">${list.length} price${list.length > 1 ? 's' : ''} · best ${money(best.unit_price, best.currency)}${best.store ? ' at ' + h(best.store) : ''}</div></div>
        <div style="text-align:right"><div class="bpx-price">${money(list[0].unit_price, list[0].currency)}<span class="bpx-sub">/${h(list[0].base_unit)}</span></div>
        <span class="bpx-chip ${['target', 'lowest', 'good'].includes(v.code) ? 'g' : v.code === 'high' ? 'b' : 'n'}">${h(v.label)}</span></div></div></div>`;
    }
    body().innerHTML = html;
  }
  function chart(rows, target) {
    const pts = rows.slice().reverse(); if (pts.length < 2) return '<div class="bpx-note">Save at least two prices to see a trend.</div>';
    const W = 320, H = 120, P = 12, ys = pts.map(r => +r.unit_price).concat(target ? [+target.target_unit_price] : []);
    const lo = Math.min(...ys), hi = Math.max(...ys), span = hi - lo || hi || 1;
    const X = i => P + (i * (W - 2 * P)) / (pts.length - 1), Y = v => H - P - ((v - lo) / span) * (H - 2 * P);
    return `<svg class="bpx-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Unit price history, ${pts.length} points, from ${money(pts[0].unit_price)} to ${money(pts[pts.length - 1].unit_price)}">
      ${target ? `<line x1="${P}" x2="${W - P}" y1="${Y(+target.target_unit_price)}" y2="${Y(+target.target_unit_price)}" stroke="#10b981" stroke-dasharray="4 3"/>` : ''}
      <polyline fill="none" stroke="#2f7fd0" stroke-width="2" points="${pts.map((r, i) => `${X(i)},${Y(+r.unit_price)}`).join(' ')}"/>
      ${pts.map((r, i) => `<circle cx="${X(i)}" cy="${Y(+r.unit_price)}" r="3" fill="#2f7fd0"/>`).join('')}</svg>
      <div class="bpx-sub" style="display:flex;justify-content:space-between"><span>${fmtDate(pts[0].observed_at)}</span>${target ? '<span style="color:#10b981">- - your target</span>' : ''}<span>${fmtDate(pts[pts.length - 1].observed_at)}</span></div>`;
  }
  function renderProduct(k) {
    const list = pbRows.filter(r => groupKey(r) === k); if (!list.length) return showTab('book');
    const f = list[0], t = pbTargets.find(x => x.product_key === f.product_key && x.base_unit === f.base_unit && x.active), v = bp.price.verdict(list, t);
    const byStore = new Map(); list.forEach(r => { const s = r.store || 'Unknown store'; if (!byStore.has(s) || +r.unit_price < +byStore.get(s).unit_price) byStore.set(s, r); });
    const me = bp.me();
    body().innerHTML = `<button class="bpx-btn" data-a="back">&larr; Price Book</button>
      <h3 style="margin:10px 0 2px">${h(f.product_name)}</h3><div class="bpx-sub">${h(v.label)} · latest ${money(f.unit_price, f.currency)}/${h(f.base_unit)}</div>
      <div style="margin:10px 0">${chart(list, t)}</div>
      <span class="bpx-lbl">Best price by store</span>${[...byStore].sort((a, b) => a[1].unit_price - b[1].unit_price).map(([s, r]) => `<div class="bpx-row bpx-sub" style="justify-content:space-between"><span>${h(s)}</span><b>${money(r.unit_price, r.currency)}/${h(r.base_unit)}</b></div>`).join('')}
      <span class="bpx-lbl">Alert me when it drops to (per ${h(f.base_unit)})</span>
      <div class="bpx-row"><input class="bpx-in bpx-grow" id="bpxTarget" inputmode="decimal" placeholder="e.g. ${(+f.unit_price * 0.9).toFixed(4)}" value="${t ? h(t.target_unit_price) : ''}" aria-label="Target unit price">
        <button class="bpx-btn p" data-a="settarget" data-k="${h(k)}">${t ? 'Update' : 'Set alert'}</button>${t ? `<button class="bpx-btn d" data-a="deltarget" data-id="${h(t.id)}" data-k="${h(k)}">Remove</button>` : ''}</div>
      <div class="bpx-note">Alerts fire when any new price you (or your household) save is at or below this. No store data is fetched automatically.</div>
      <span class="bpx-lbl">History</span>${list.slice(0, 40).map(r => `<div class="bpx-row bpx-sub" style="justify-content:space-between;border-bottom:1px solid var(--border);padding:4px 0"><span>${fmtDate(r.observed_at)} · ${h(r.store || '—')}</span><span><b>${money(r.unit_price, r.currency)}</b>${r.user_id === me ? ` <button class="bpx-btn d" style="padding:2px 8px" data-a="delentry" data-id="${h(r.id)}" data-k="${h(k)}" aria-label="Delete this price">&#10005;</button>` : ''}</span></div>`).join('')}`;
  }
  async function saveTarget(k) {
    const f = pbRows.find(r => groupKey(r) === k), v = parseFloat($('#bpxTarget').value);
    if (!(v > 0)) return toast('Enter a target price greater than 0.');
    await bp.price.setTarget({ product_name: f.product_name, base_unit: f.base_unit, target_unit_price: v });
    pbTargets = await bp.price.targets(); toast('Alert set', 'ok'); renderProduct(k);
  }

  /* save-from-comparison sheet */
  async function openSavePrices() {
    const res = (ui.host.getCompare && ui.host.getCompare()) || [];
    const rows = res.filter(r => r.n && !/^Item \d+$/.test(r.n));
    if (!rows.length) return toast('Give each product a name first so it can be tracked.');
    let hs = []; try { hs = await bp.households.list(); } catch (e) { /* offline: personal only */ }
    const stores = ui.host.preferredStores();
    const b = openSheet('Save to Price Book', `<datalist id="bpxStores">${stores.map(s => `<option value="${h(s)}">`).join('')}</datalist>
      <div class="bpx-note">Only save prices you have confirmed on the shelf or receipt. Each one becomes a data point in your history.</div>
      ${rows.map((r, i) => `<div class="bpx-card"><label class="bpx-row"><input type="checkbox" data-i="${i}" checked><span class="bpx-grow"><span class="bpx-name">${h(r.n)}</span><br><span class="bpx-sub">${money(r.up, ui.host.currency())} / ${h(r.baseUnit)}</span></span></label>
        <input class="bpx-in" data-s="${i}" list="bpxStores" placeholder="Store (optional)" aria-label="Store for ${h(r.n)}"></div>`).join('')}
      ${hs.length ? `<span class="bpx-lbl">Share with</span><select class="bpx-in" id="bpxScope"><option value="">Just me</option>${hs.map(x => `<option value="${h(x.id)}">${h(x.name)} (household)</option>`).join('')}</select>` : ''}
      <div class="bpx-row" style="margin-top:12px"><button class="bpx-btn p bpx-grow" id="bpxDoSave">Save prices</button></div>`);
    $('#bpxDoSave', b).onclick = () => {
      const entries = rows.map((r, i) => (b.querySelector(`[data-i="${i}"]`).checked ? {
        product_name: r.n, store: b.querySelector(`[data-s="${i}"]`).value.trim(), unit_price: r.up, base_unit: r.baseUnit, unit_family: r.fam,
        currency: ui.host.currency(), pkg_price: r.price, pkg_size: r.size, pkg_qty: r.qty, pkg_unit: r.unit,
        discount_value: r.dv || null, discount_type: r.dv ? (r.dt === 'p' ? 'p' : 'd') : null,
      } : null)).filter(Boolean);
      const n = bp.price.add(entries, $('#bpxScope', b)?.value || null);
      closeSheet(); toast(n ? `Saved ${n} price${n > 1 ? 's' : ''} to your Price Book` : 'Nothing selected', n ? 'ok' : '');
    };
  }
  ui.openSavePrices = openSavePrices;

  /* ------------------------------ deals ------------------------------ */
  const UNITS = ['oz', 'lb', 'g', 'kg', 'ml', 'l', 'gal', 'count', 'sheets', 'ft', 'in', 'yd', 'm'];
  function dealLine(d, best) {
    const e = bp.deals.effective(d, ui.host.unitRates());
    const how = d.discount_type === 'p' ? `${+d.discount_value}% off` : d.discount_type === 'd' ? `${money(d.discount_value, ui.host.currency())} off` : d.discount_type === 'bogo' ? `buy ${d.buy_qty} get ${d.get_qty} free` : 'sale price';
    let cmp = '';
    if (e && best) { const diff = (e.unitPrice - best) / best * 100; cmp = Math.abs(diff) < 1 ? 'same as your best' : diff < 0 ? `${Math.abs(diff).toFixed(0)}% below your best` : `${diff.toFixed(0)}% above your best`; }
    return { e, how, cmp, good: !!(e && best && e.unitPrice < best) };
  }
  async function bestPrices() {                        // product_key|baseUnit -> best unit price in the price book
    const map = new Map(); try { (await bp.price.history()).rows.forEach(r => { const k = r.product_key + '|' + r.base_unit; if (!map.has(k) || +r.unit_price < map.get(k)) map.set(k, +r.unit_price); }); } catch (e) { /* no history */ }
    return map;
  }
  const bestFor = (map, d) => { const e = bp.deals.effective(d, ui.host.unitRates()); return e ? map.get(d.name_key + '|' + e.baseUnit) : undefined; };

  async function renderDeals() {
    const [deals, best] = await Promise.all([bp.deals.list(), bestPrices()]);
    const lid = ui.host.activeListId();
    let matches = []; if (lid) { try { matches = await bp.deals.matchesForList(lid); } catch (e) { /* ignore */ } }
    const today = new Date().toISOString().slice(0, 10);
    let html = '';
    if (matches.length) {
      html += '<span class="bpx-lbl">Matches for your current list</span>';
      const seen = new Set();
      html += matches.filter(m => { if (seen.has(m.item_id + m.deal.id)) return false; seen.add(m.item_id + m.deal.id); return true; }).map(m => {
        const l = dealLine(m.deal, bestFor(best, m.deal));
        return `<div class="bpx-card"><div class="bpx-row"><div class="bpx-grow"><div class="bpx-name">${h(m.item_name)} <span class="bpx-sub">→ ${h(m.deal.product_name)}${m.deal.store ? ' @ ' + h(m.deal.store) : ''}</span></div>
          <div class="bpx-sub">${h(l.how)}${l.e ? ` · effective ${money(l.e.unitPrice, ui.host.currency())}/${h(l.e.baseUnit)}` : ''}${l.cmp ? ' · ' + h(l.cmp) : ''}</div></div>
          <button class="bpx-btn" data-a="dealtocompare" data-id="${h(m.deal.id)}">Compare</button></div></div>`;
      }).join('');
    }
    html += `<span class="bpx-lbl">Add a weekly-ad deal or coupon</span>
      <div class="bpx-card"><div class="bpx-grid"><input class="bpx-in" id="dlName" placeholder="Product" maxlength="200"><input class="bpx-in" id="dlStore" placeholder="Store" maxlength="120">
      <input class="bpx-in" id="dlPrice" inputmode="decimal" placeholder="Shelf price"><input class="bpx-in" id="dlSize" inputmode="decimal" placeholder="Size per pack">
      <input class="bpx-in" id="dlQty" inputmode="decimal" placeholder="Packs (default 1)"><select class="bpx-in" id="dlUnit">${UNITS.map(u => `<option>${u}</option>`).join('')}</select>
      <select class="bpx-in" id="dlKind"><option value="weekly_ad">Weekly ad</option><option value="coupon">Coupon (needs clip)</option></select>
      <select class="bpx-in" id="dlDisc"><option value="">Sale price as listed</option><option value="p">% off</option><option value="d">Amount off</option><option value="bogo">Buy X get Y free</option></select>
      <input class="bpx-in" id="dlDv" inputmode="decimal" placeholder="Discount value / buy X"><input class="bpx-in" id="dlGet" inputmode="numeric" placeholder="Get Y (BOGO)">
      <input class="bpx-in" id="dlTo" type="date" aria-label="Valid until"></div>
      <div class="bpx-note">Enter the shelf price and the discount separately; the effective unit price is calculated for you. No retailer feeds are used.</div>
      <button class="bpx-btn p" data-a="adddeal">Add deal</button></div>
      <details class="bpx-card"><summary class="bpx-name" style="cursor:pointer">Import a weekly ad (CSV)</summary><div class="bpx-note">Columns: store,product,kind,price,size,qty,unit,discount_type,discount_value,buy_qty,get_qty,valid_to</div>
      <textarea class="bpx-in" id="dlCsv" rows="4" placeholder="Publix,Whole milk,weekly_ad,4.29,1,1,gal,,,,,2026-11-19"></textarea><button class="bpx-btn" data-a="importdeals" style="margin-top:6px">Import</button></details>
      <span class="bpx-lbl">Active deals</span>`;
    const act = deals.filter(d => !d.valid_to || d.valid_to >= today);
    html += act.length ? act.map(d => {
      const l = dealLine(d, bestFor(best, d));
      return `<div class="bpx-card"><div class="bpx-row"><div class="bpx-grow"><div class="bpx-name">${h(d.product_name)}${d.store ? ' <span class="bpx-sub">@ ' + h(d.store) + '</span>' : ''}</div>
        <div class="bpx-sub">${d.kind === 'coupon' ? 'Coupon' : 'Weekly ad'} · ${h(l.how)}${d.valid_to ? ' · until ' + fmtDate(d.valid_to) : ''}</div>
        <div class="bpx-sub">${l.e ? `Effective <b>${money(l.e.unitPrice, ui.host.currency())}/${h(l.e.baseUnit)}</b>` : 'Unit not supported'}${l.cmp ? ` · <span class="bpx-chip ${l.good ? 'g' : 'n'}">${h(l.cmp)}</span>` : ''}</div></div></div>
        <div class="bpx-row" style="margin-top:6px"><button class="bpx-btn" data-a="dealtocompare" data-id="${h(d.id)}">Compare</button>
        ${d.kind === 'coupon' ? `<button class="bpx-btn" data-a="clip" data-id="${h(d.id)}" data-v="${d.clipped ? 0 : 1}">${d.clipped ? 'Unclip' : 'Clip'}</button>` : ''}<button class="bpx-btn d" data-a="deldeal" data-id="${h(d.id)}">Delete</button></div></div>`;
    }).join('') : '<div class="bpx-empty">No active deals yet.</div>';
    body().innerHTML = html; ui._deals = deals;
  }
  const num = id => { const v = parseFloat($(id).value); return isNaN(v) ? null : v; };
  async function submitDeal() {
    const disc = $('#dlDisc').value, d = {
      product_name: $('#dlName').value.trim(), store: $('#dlStore').value.trim(), kind: $('#dlKind').value, pkg_price: num('#dlPrice'),
      pkg_size: num('#dlSize'), pkg_qty: num('#dlQty') || 1, pkg_unit: $('#dlUnit').value, valid_to: $('#dlTo').value || null,
    };
    if (!d.product_name || d.pkg_price == null || !(d.pkg_size > 0)) return toast('Product, price and pack size are required.');
    if (disc === 'p' || disc === 'd') { d.discount_type = disc; d.discount_value = num('#dlDv'); if (d.discount_value == null) return toast('Enter the discount value.'); if (disc === 'p' && d.discount_value > 100) return toast('Percent off cannot exceed 100.'); }
    if (disc === 'bogo') { d.discount_type = 'bogo'; d.buy_qty = parseInt($('#dlDv').value, 10); d.get_qty = parseInt($('#dlGet').value, 10); if (!(d.buy_qty > 0 && d.get_qty > 0)) return toast('Enter how many to buy and how many are free.'); }
    await bp.deals.add(d); toast('Deal added', 'ok'); showTab('deals');
  }
  async function importDeals() {
    const csv = $('#dlCsv').value.trim(); if (!csv) return;
    const token = await ui.host.accessToken(); if (!token) return toast('Please sign in again.');
    const r = await fetch('/api/deals-import', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ csv }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return toast(j.error || 'Import failed.');
    toast(`Imported ${j.imported} deal${j.imported === 1 ? '' : 's'}${j.skipped ? `, skipped ${j.skipped}` : ''}`, 'ok'); showTab('deals');
  }
  function dealToCompare(id) {
    const d = (ui._deals || []).find(x => x.id === id) || null;
    const fromMatch = d || null;
    const apply = deal => { const ok = ui.host.fillCard(bp.deals.toCard(deal)); if (ok) { closeSheet(); toast('Deal added to a comparison card', 'ok'); } else toast('No empty comparison card. Add a card first.'); };
    if (fromMatch) return apply(fromMatch);
    bp.deals.matchesForList(ui.host.activeListId()).then(ms => { const m = ms.find(x => x.deal.id === id); if (m) apply(m.deal); });
  }

  /* ------------------------------ household ------------------------------ */
  async function renderHouse() {
    const hs = await bp.households.list(), me = bp.me(), lists = (ui.host.lists && ui.host.lists()) || [];
    let html = '';
    html += hs.length ? hs.map(x => {
      const owner = x.members.some(m => m.is_me && m.role === 'owner');
      return `<div class="bpx-card"><div class="bpx-row"><div class="bpx-grow bpx-name">${h(x.name)}</div>${owner ? `<button class="bpx-btn" data-a="invite" data-id="${h(x.id)}">Invite</button>` : ''}<button class="bpx-btn d" data-a="leave" data-id="${h(x.id)}">Leave</button></div>
        <div id="bpxInv${h(x.id)}"></div>
        ${x.members.map(m => `<div class="bpx-row bpx-sub" style="justify-content:space-between"><span>${h(m.display_name)}${m.is_me ? ' (you)' : ''}${m.role === 'owner' ? ' · owner' : ''}</span>${owner && !m.is_me ? `<button class="bpx-btn d" style="padding:2px 8px" data-a="kick" data-hid="${h(x.id)}" data-uid="${h(m.user_id)}">Remove</button>` : ''}</div>`).join('')}</div>`;
    }).join('') : '<div class="bpx-note">A household lets several people share lists, favorites and price history. Edits merge automatically, even from offline phones.</div>';
    html += `<div class="bpx-card"><span class="bpx-lbl" style="margin-top:0">Create a household</span><div class="bpx-row"><input class="bpx-in bpx-grow" id="hhName" maxlength="80" placeholder="e.g. Home"><button class="bpx-btn p" data-a="mkhouse">Create</button></div>
      <span class="bpx-lbl">Join with an invite code</span><div class="bpx-row"><input class="bpx-in bpx-grow" id="hhCode" maxlength="16" autocapitalize="characters" placeholder="Invite code"><button class="bpx-btn" data-a="joinhouse">Join</button></div></div>`;
    const mine = lists.filter(l => l.ownerId === me);
    if (hs.length && mine.length) {
      html += `<span class="bpx-lbl">Who can see each of your lists</span>` + mine.map(l => `<div class="bpx-row" style="margin-bottom:6px"><span class="bpx-grow bpx-name">${h(l.name)}</span>
        <select class="bpx-in" style="width:auto" data-share="${h(l.id)}" aria-label="Sharing for ${h(l.name)}"><option value="">Just me</option>${hs.map(x => `<option value="${h(x.id)}"${l.householdId === x.id ? ' selected' : ''}>${h(x.name)}</option>`).join('')}</select></div>`).join('');
    }
    body().innerHTML = html;
    $$('select[data-share]', body()).forEach(sel => sel.onchange = () => { try { bp.shareList(sel.dataset.share, sel.value || null); toast(sel.value ? 'List shared' : 'List is private again', 'ok'); } catch (e) { toast(e.message); } });
  }
  async function mkHouse() { const n = $('#hhName').value.trim(); if (!n) return toast('Give the household a name.'); await bp.households.create(n); toast('Household created', 'ok'); showTab('house'); }
  async function joinHouse() { const c = $('#hhCode').value.trim(); if (!c) return toast('Enter the invite code.'); await bp.households.join(c); toast('Joined. Shared lists are loading.', 'ok'); showTab('house'); }

  /* ------------------------------ replenish ------------------------------ */
  async function openReplenish() {
    const lid = ui.host.activeListId(); if (!lid) return toast('Open a list first.');
    const list = (ui.host.lists() || []).find(l => String(l.id) === String(lid));
    const b = openSheet('Replenish', '<div class="bpx-empty">Loading…</div>');
    try {
      const favs = await bp.favorites.list(list && list.householdId);
      const onList = new Set((ui.host.listItems(lid) || []).map(i => bp.normKey(i.name)));
      const rows = favs.filter(f => !onList.has(f.name_key));
      b.innerHTML = rows.length ? `<div class="bpx-note">Pinned and most-bought first. Items already on this list are hidden.</div>${rows.map((f, i) => `<label class="bpx-card bpx-row"><input type="checkbox" data-i="${i}"${f.pinned || f.add_count > 1 ? ' checked' : ''}>
        <span class="bpx-grow"><span class="bpx-name">${h(f.name)}</span><br><span class="bpx-sub">bought ${f.add_count}× · last ${fmtDate(f.last_added_at.slice(0, 10))}${f.default_store ? ' · ' + h(f.default_store) : ''}</span></span>
        <button class="bpx-btn" data-pin="${h(f.id)}" data-v="${f.pinned ? 0 : 1}" aria-label="${f.pinned ? 'Unpin' : 'Pin'} ${h(f.name)}">${f.pinned ? 'Unpin' : 'Pin'}</button>
        <button class="bpx-btn d" data-hide="${h(f.id)}" aria-label="Hide ${h(f.name)}">&#10005;</button></label>`).join('')}
        <button class="bpx-btn p" id="bpxAddFav" style="width:100%;margin-top:8px">Add selected to list</button>` : '<div class="bpx-empty">Nothing to replenish yet.<br>Items you add to lists show up here for one-tap re-adding.</div>';
      b.onclick = async e => {
        const pin = e.target.closest('[data-pin]'), hide = e.target.closest('[data-hide]');
        if (pin) { e.preventDefault(); await bp.favorites.pin(pin.dataset.pin, pin.dataset.v === '1'); return openReplenish(); }
        if (hide) { e.preventDefault(); await bp.favorites.hide(hide.dataset.hide); return openReplenish(); }
        if (e.target.id === 'bpxAddFav') {
          const chosen = rows.filter((f, i) => b.querySelector(`[data-i="${i}"]`).checked).map(f => ({ name: f.name, qty: f.default_qty, store: f.default_store }));
          const n = ui.host.addItems(chosen); closeSheet(); toast(n ? `Added ${n} item${n > 1 ? 's' : ''}` : 'Nothing selected', n ? 'ok' : '');
        }
      };
    } catch (e) { fail(e); }
  }
  ui.openReplenish = openReplenish; ui.openHub = openHub;
})(window);
