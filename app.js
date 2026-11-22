/* Landlord Hub — app: routing, screens for landlord / tenant / caretaker, actions.
   Data lives on this device (localStorage) so the app keeps working during power cuts
   and with no data bundle. A backend would sync it later. */
(function () {
  const { money, fmtDate, fmtDay, iso, parse } = LH;
  const KEY = 'landlordhub.v1';
  const SKEY = 'landlordhub.session';
  const app = document.getElementById('app');
  const sheetRoot = document.getElementById('sheet-root');
  const toastEl = document.getElementById('toast');

  let state, session;
  const ui = { tenantFilter: 'all', tenantQuery: '', login: { step: 'phone', phone: '' } };

  /* ---------- Storage ---------- */
  function load() {
    try { state = JSON.parse(localStorage.getItem(KEY)); } catch (e) { state = null; }
    if (!state || state.version !== 1) { state = LH.seed(LH.today()); save(); }
    // One-time rename: the sample landlord is now Haggai Mukonka (also fixes data already saved on a phone).
    if (state.landlord && state.landlord.name === 'Mwila Banda') {
      state = JSON.parse(JSON.stringify(state).split('Mwila Banda').join('Haggai Mukonka')
        .split('mwila.banda@example.com').join('haggai.mukonka@example.com')
        .split('Banda Properties').join('Mukonka Properties'));
      save();
    }
    // Landlord Hub keeps no ID numbers (NRC, passport, TPIN): wipe any that older versions saved.
    if (stripIds(state)) save();
    // Deductions were added later: give older saved data a sample history too.
    if (!Array.isArray(state.deductions)) { state.deductions = LH.seedDeductions(state, LH.today()); save(); }
    // Messages were added later: start with a couple of sample replies.
    if (!Array.isArray(state.messages)) { state.messages = LH.seedMessages(state, LH.today()); save(); }
    try { session = JSON.parse(localStorage.getItem(SKEY)); } catch (e) { session = null; }
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* storage full or blocked */ } }
  // Names and phone numbers only: no NRC, passport or TPIN anywhere. Returns true if it removed something.
  function stripIds(st) {
    const ID_FIELDS = ['nrc', 'nrcVerified', 'passport', 'tpin'];
    let removed = false;
    const clean = (o) => { if (o) ID_FIELDS.forEach((k) => { if (k in o) { delete o[k]; removed = true; } }); };
    clean(st.landlord);
    (st.tenants || []).forEach(clean);
    (st.caretakers || []).forEach(clean);
    return removed;
  }

  /* Text size: normal by default; older readers can choose Large or Extra large in More / Account. */
  const TS_KEY = 'landlordhub.textsize';
  const TEXT_SIZES = [['1', 'Normal'], ['1.15', 'Large'], ['1.3', 'Extra large']];
  function getTextSize() { try { return localStorage.getItem(TS_KEY) || '1'; } catch (e) { return '1'; } }
  function applyTextSize(v) { document.documentElement.style.setProperty('--ts', v); }
  applyTextSize(getTextSize());
  function textSizeCard() {
    const cur = getTextSize();
    return `<section class="section"><div class="section-head"><h2>Text size</h2></div>
      <div class="card pad"><div class="ts-options" role="radiogroup" aria-label="Text size">
        ${TEXT_SIZES.map(([v, l], i) => `<button type="button" class="ts-option${v === cur ? ' active' : ''}" role="radio" aria-checked="${v === cur}" data-action="textSize" data-v="${v}"><span class="ts-a" style="font-size:${18 + i * 5}px">A</span>${l}</button>`).join('')}
      </div><p class="muted small mt-s">Changes the size of words everywhere in the app.</p></div></section>`;
  }
  function saveSession() { try { session ? localStorage.setItem(SKEY, JSON.stringify(session)) : localStorage.removeItem(SKEY); } catch (e) {} }

  /* ---------- Helpers ---------- */
  const T = () => LH.today();
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const byId = (arr, id) => arr.find((x) => x.id === id);
  const activeTenants = () => state.tenants.filter((t) => !t.ended);
  const unitOf = (t) => byId(state.units, t.unitId);
  const propOf = (u) => byId(state.properties, u.propertyId);
  const tenantIn = (u) => state.tenants.find((t) => t.unitId === u.id && !t.ended);
  const acct = (t) => LH.account(state, t, T());
  const first = (name) => name.split(' ')[0];
  const initials = (name) => String(name || '').replace(/[^\p{L}\s]/gu, '').trim().split(/\s+/).map((s) => s[0] || '').slice(0, 2).join('').toUpperCase();
  const where = (t) => { const u = unitOf(t); return `${u.label} · ${propOf(u).name}`; };
  const me = () => session.role === 'landlord' ? state.landlord
    : session.role === 'tenant' ? byId(state.tenants, session.id) : byId(state.caretakers, session.id);
  const perLabel = (u) => (u.period === 'term' ? 'term' : 'month');
  // What one payment covers for this tenant: 'month', '3 months', 'term'.
  const perWord = (t) => { const u = unitOf(t); if (u.period === 'term') return 'term'; const n = LH.every(t, u); return n === 1 ? 'month' : `${n} months`; };
  const howOften = (t) => { const w = perWord(t); return w === 'month' ? 'Every month' : w === 'term' ? 'Every term' : `Every ${w}`; };
  const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);

  const STATUS = { paid: 'Paid', partial: 'Part paid', overdue: 'Late', due: 'Due' };
  const pill = (a) => `<span class="pill ${a.status}">${a.status === 'due' ? 'Due ' + fmtDay(a.dueDate) : STATUS[a.status]}</span>`;
  function statusLine(a) {
    if (a.status === 'paid') return a.aheadUntil ? `Paid up to ${a.aheadUntil}` : `Next due ${fmtDay(a.dueDate)}`;
    if (a.status === 'overdue') return `${money(a.balance)} · ${a.daysLate} day${a.daysLate === 1 ? '' : 's'} late`;
    if (a.status === 'partial') return `${money(a.balance)} left · ${a.daysLate ? a.daysLate + ' days late' : 'due ' + fmtDay(a.dueDate)}`;
    const d = LH.daysBetween(T(), a.dueDate);
    return `${money(a.balance)} due ${d === 0 ? 'today' : 'in ' + d + ' day' + (d === 1 ? '' : 's')}`;
  }

  /* ---------- Icons (hand-drawn set, 24px grid) ---------- */
  const ICONS = {
    home: '<path d="M3.5 10.5 12 3.5l8.5 7"/><path d="M5.5 9v11h13V9"/><path d="M10 20v-5.5h4V20"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.4 3.2-5.5 6.5-5.5s5.9 2.1 6.5 5.5"/><path d="M16 4.7a3.5 3.5 0 0 1 0 6.6"/><path d="M18.2 14.8c1.8.7 3 2.4 3.3 5.2"/>',
    building: '<rect x="4" y="3" width="11" height="18" rx="1"/><path d="M15 9h4a1 1 0 0 1 1 1v11"/><path d="M8 7h3M8 11h3M8 15h3"/><path d="M2 21h20"/>',
    notice: '<path d="M4 10v4a1 1 0 0 0 1 1h2l6 4.5v-15L7 9H5a1 1 0 0 0-1 1z"/><path d="M16.5 9a4 4 0 0 1 0 6"/><path d="M19 6.5a7.5 7.5 0 0 1 0 11"/>',
    more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
    chev: '<path d="m9.5 6 6 6-6 6"/>',
    back: '<path d="m14.5 6-6 6 6 6"/>',
    x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2"/>',
    copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2.5"/><path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5"/>',
    edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>',
    phone: '<path d="M5.2 4h3.3l1.6 4-2.1 1.3a10.8 10.8 0 0 0 6.7 6.7l1.3-2.1 4 1.6v3.3a1.6 1.6 0 0 1-1.7 1.6C10.6 19.9 4.1 13.4 3.6 5.7A1.6 1.6 0 0 1 5.2 4z"/>',
    chat: '<path d="M4.5 19.5 6 15.6A7.8 7.8 0 1 1 9 18.6z"/>',
    sms: '<rect x="3.5" y="5" width="17" height="12" rx="2"/><path d="M8 21l3-4"/><path d="M8 10h8M8 13h5"/>',
    receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
    tool: '<path d="M14.7 6.3a4 4 0 0 0 5 5l-8.9 8.9a2.1 2.1 0 0 1-3-3z"/><path d="M14.7 6.3 17 4l3 3-2.3 2.3"/>',
    wallet: '<path d="M4 7.5V18a2 2 0 0 0 2 2h13a1 1 0 0 0 1-1v-3"/><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H17v2.5"/><path d="M4 7.5h15a1 1 0 0 1 1 1V12"/><path d="M15.5 12H21v4h-5.5a2 2 0 0 1 0-4z"/>',
    cash: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9.5v5M18 9.5v5"/>',
    bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
    chart: '<path d="M4 4v16h16"/><path d="M8 16v-4M12 16V8M16 16v-6"/>',
    shield: '<path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6z"/><path d="m9 12 2 2 4-4"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    download: '<path d="M12 4v11"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M5 19.5h14"/>',
    logout: '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="m10 16-4-4 4-4"/><path d="M6 12h10"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 20c.8-3.8 4-6 8-6s7.2 2.2 8 6"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 8.5-8.5M16 7l2.5 2.5"/>',
    door: '<path d="M6 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17"/><path d="M3.5 21h17"/><path d="M14.5 12h.01"/>',
    send: '<path d="M20.5 3.5 3.5 10.5l7 2.5 2.5 7z"/><path d="m10.5 13 4-4"/>',
    file: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/><path d="M10 12h5M10 16h5"/>',
    offline: '<path d="M3 3l18 18"/><path d="M8.5 16.5a5 5 0 0 1 7 0"/><path d="M5 12.8a10 10 0 0 1 4.5-2.5M14.8 10.4A10 10 0 0 1 19 12.8"/><path d="M12 20h.01"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
    swap: '<path d="M4 8h14l-3.5-3.5"/><path d="M20 16H6l3.5 3.5"/>',
    camera: '<path d="M4 8h3l1.5-2.5h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  };
  const icon = (n, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ''}</svg>`;
  const houseMark = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11 12 4.5l8 6.5"/><path d="M6.5 9.5V19h11V9.5"/><path d="M10.5 19v-4h3v4"/></svg>';

  /* ---------- Toast, sheets ---------- */
  let toastTimer;
  // toast(msg, undoFn): with undoFn, shows an Undo button for a few seconds, so nothing is lost by a mis-tap.
  let undoFn = null;
  function toast(msg, undo) {
    undoFn = typeof undo === 'function' ? undo : null;
    toastEl.innerHTML = `${icon('check', 'sm')}<span>${esc(msg)}</span>${undoFn ? '<button class="toast-undo" data-action="undo">Undo</button>' : ''}`;
    toastEl.classList.toggle('has-undo', !!undoFn);
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.classList.remove('show'); undoFn = null; }, undoFn ? 6000 : 2600);
  }
  let lastFocus = null;
  function openSheet(html) {
    lastFocus = document.activeElement;
    sheetRoot.innerHTML = `<div class="sheet-backdrop" data-action="closeSheet"></div><div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
    sheetRoot.classList.add('open');
    requestAnimationFrame(() => requestAnimationFrame(() => sheetRoot.classList.add('show')));
    const f = sheetRoot.querySelector('[autofocus]');
    if (f && matchMedia('(min-width: 700px)').matches) setTimeout(() => f.focus(), 60);
  }
  function setSheet(html) { const s = sheetRoot.querySelector('.sheet'); if (s) s.innerHTML = html; else openSheet(html); }
  function closeSheet() {
    // A payment just came in: once the sheet has slid away, show the money going into "Received".
    if (moneyIn) { const m = moneyIn; moneyIn = null; setTimeout(() => moneyToReceived(m), 380); }
    sheetRoot.classList.remove('show');
    setTimeout(() => { if (!sheetRoot.classList.contains('show')) { sheetRoot.innerHTML = ''; sheetRoot.classList.remove('open'); } }, 380);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  const sheetHead = (title) => `<div class="sheet-head"><h2>${esc(title)}</h2><button class="icon-btn plain" data-action="closeSheet" aria-label="Close">${icon('x')}</button></div>`;

  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /* ---------- Routing & shell ---------- */
  const NAV = {
    landlord: [['home', 'Home', 'home'], ['tenants', 'Tenants', 'users'], ['properties', 'Properties', 'building'], ['notices', 'Notices', 'notice'], ['more', 'More', 'more']],
    tenant: [['home', 'Home', 'home'], ['receipts', 'Receipts', 'receipt'], ['notices', 'Notices', 'notice'], ['requests', 'Repairs', 'tool'], ['account', 'Account', 'user']],
    caretaker: [['home', 'Home', 'home'], ['tenants', 'Tenants', 'users'], ['activity', 'Activity', 'clock'], ['account', 'Account', 'user']],
  };
  const route = () => (location.hash.replace(/^#\/?/, '') || 'home').split('/');
  const go = (p) => { location.hash = '#/' + p; };

  // The account / "More" page moves out of the bottom bar and into the avatar at the top right.
  const TOP_ROUTE = { landlord: 'more', tenant: 'account', caretaker: 'account' };

  function shell(content, active) {
    const nav = NAV[session.role];
    const who = me();
    const top = TOP_ROUTE[session.role];
    const roleName = { landlord: 'Landlord', tenant: 'Tenant', caretaker: 'Caretaker' }[session.role];
    const unread = unseenCount();
    const badge = unread ? `<span class="top-badge num">${unread > 9 ? '9+' : unread}</span>` : '';
    const bellLabel = `Notifications${unread ? `, ${unread} new` : ''}`;
    const link = ([r, label, ic], cls) => `<a href="#/${r}" class="${cls}${active === r ? ' active' : ''}"${active === r ? ' aria-current="page"' : ''}>${icon(ic)}<span>${label}</span></a>`;
    return `<div class="layout">
      <header class="topbar">
        <a href="#/home" class="logo topbar-logo" aria-label="Landlord Hub, home"></a>
        <div class="topbar-actions">
          <button class="top-btn" data-action="notifications" aria-label="${bellLabel}">${icon('bell')}${badge}</button>
          <a href="#/${top}" class="top-avatar${active === top ? ' active' : ''}" aria-label="${session.role === 'landlord' ? 'More and settings' : 'Your account'}">${initials(who.name)}</a>
        </div>
      </header>
      <aside class="sidenav">
        <a href="#/home" class="logo side-logo" aria-label="Landlord Hub, home"></a>
        ${nav.map((n) => link(n, 'side-link')).join('')}
        <button class="side-link" data-action="notifications" aria-label="${bellLabel}">${icon('bell')}<span>Notifications</span>${unread ? `<span class="side-count num">${unread}</span>` : ''}</button>
        <div class="side-foot"><span class="avatar">${initials(who.name)}</span><div class="grow" style="min-width:0"><div style="font-weight:600;font-size:14px">${esc(who.name)}</div><div class="small muted">${roleName}</div></div></div>
      </aside>
      <main class="main" id="main">${navigator.onLine ? '' : offlineBar()}${content}</main>
      <nav class="tabbar" aria-label="Main">${nav.filter((n) => n[0] !== top).map((n) => link(n, 'tab')).join('')}</nav>
    </div>`;
  }

  /* ---------- Notifications ---------- */
  // Built from live data each time, so they clear themselves once the problem is sorted.
  function notifications() {
    const out = [];
    const add = (id, ic, title, meta, href, tone = '') => out.push({ id, ic, title, meta, href, tone });
    const late = (pool) => pool.map((t) => ({ t, a: acct(t) })).filter((s) => s.a.balance > 0 && s.a.daysLate > 0).sort((x, y) => y.a.daysLate - x.a.daysLate);
    if (session.role === 'landlord') {
      state.payments.filter((p) => p.status === 'pending').forEach((p) => {
        const t = byId(state.tenants, p.tenantId);
        add('pay:' + p.id, 'wallet', `Confirm ${money(p.amount)} from ${t.name}`, `${p.method} · they say they've paid`, 'home');
      });
      late(activeTenants()).forEach(({ t, a }) => add(`late:${t.id}:${iso(a.dueDate)}`, 'clock', `${t.name} is ${a.daysLate} day${a.daysLate === 1 ? '' : 's'} late`, `${money(a.balance)} owed · ${where(t)}`, 'tenant/' + t.id, 'warn'));
      state.requests.filter((r) => r.status === 'open').forEach((r) => {
        const t = byId(state.tenants, r.tenantId);
        add('req:' + r.id, 'tool', `New repair: ${r.category}`, `${t ? t.name + ' · ' : ''}${fmtDay(parse(r.date))}`, 'requests');
      });
      newFromTenants().forEach((m) => {
        const t = byId(state.tenants, m.tenantId); if (!t) return;
        const n = m.about && m.about !== 'rent' ? byId(state.notices, m.about) : null;
        add('msg:' + m.id, 'chat', `${t.name}: ${snippet(m.text, 60)}`, m.promise ? `Will pay on ${fmtDay(parse(m.promise))}` : n ? `Reply to “${n.title}”` : `Message · ${fmtDay(parse(m.date))}`, 'tenant/' + t.id);
      });
    } else if (session.role === 'caretaker') {
      late(careTenants()).forEach(({ t, a }) => add(`late:${t.id}:${iso(a.dueDate)}`, 'clock', `${t.name} is ${a.daysLate} day${a.daysLate === 1 ? '' : 's'} late`, `${money(a.balance)} owed · ${where(t)}`, 'tenants', 'warn'));
    } else {
      const t = myTenant(), a = acct(t);
      if (a.balance > 0 && a.daysLate > 0) add('owe:' + iso(a.dueDate), 'clock', `Your rent is ${a.daysLate} day${a.daysLate === 1 ? '' : 's'} late`, `${money(a.balance)} to pay`, 'home', 'warn');
      else if (a.balance > 0) { const d = LH.daysBetween(T(), a.dueDate); if (d <= 5) add('due:' + iso(a.dueDate), 'clock', `Rent due ${d === 0 ? 'today' : 'in ' + d + ' day' + (d === 1 ? '' : 's')}`, `${money(a.balance)} · ${fmtDay(a.dueDate)}`, 'home'); }
      state.payments.filter((p) => p.tenantId === t.id && p.status === 'pending').forEach((p) => add('pend:' + p.id, 'wallet', `${money(p.amount)} waiting to be confirmed`, `${first(state.landlord.name)} will check it soon`, 'home'));
      const since = iso(LH.addDays(T(), -30));
      myNotices(t).filter((n) => n.date >= since).forEach((n) => add('notice:' + n.id, 'notice', n.title, `Notice · ${fmtDay(parse(n.date))}`, 'notices'));
      state.requests.filter((r) => r.tenantId === t.id && r.status !== 'open').forEach((r) => add(`req:${r.id}:${r.status}`, 'tool', `${r.category} repair: ${r.status === 'done' ? 'done' : 'in progress'}`, fmtDay(parse(r.date)), 'requests'));
      newFromLandlord(t.id).forEach((m) => add('lmsg:' + m.id, 'chat', `${first(state.landlord.name)}: ${snippet(m.text, 60)}`, `Message · ${fmtDay(parse(m.date))}`, 'home'));
    }
    return out;
  }
  const SEEN_KEY = 'landlordhub.seen';
  const seenKey = () => `${session.role}:${session.id || ''}`;
  function getSeen() { try { return (JSON.parse(localStorage.getItem(SEEN_KEY)) || {})[seenKey()] || []; } catch (e) { return []; } }
  function setSeen(ids) {
    try { const all = JSON.parse(localStorage.getItem(SEEN_KEY)) || {}; all[seenKey()] = ids; localStorage.setItem(SEEN_KEY, JSON.stringify(all)); } catch (e) {}
  }
  function unseenCount() { const seen = new Set(getSeen()); return notifications().filter((n) => !seen.has(n.id)).length; }
  function notificationsSheet() {
    const list = notifications(), seen = new Set(getSeen());
    openSheet(`${sheetHead('Notifications')}
      <div class="list">${list.map((n) => `<a class="row" href="#/${n.href}" data-action="closeSheet">
        <span class="tile ${n.tone}">${icon(n.ic)}</span>
        <div class="grow"><div class="title">${esc(n.title)}</div><div class="meta">${esc(n.meta)}</div></div>
        ${seen.has(n.id) ? icon('chev', 'sm faint') : '<span class="unread-dot" aria-label="New"></span>'}
      </a>`).join('') || `<div class="empty">${icon('check')}<div>You're all caught up.</div></div>`}</div>`);
    setSeen(list.map((n) => n.id));
    document.querySelectorAll('.top-badge, .side-count').forEach((el) => el.remove());
    document.querySelectorAll('[data-action="notifications"]').forEach((el) => el.setAttribute('aria-label', 'Notifications'));
  }
  const offlineBar = () => `<div class="banner offline" id="offline">${icon('offline', 'sm')}<span>You're offline. Changes are saved on this phone.</span></div>`;

  function head(title, o = {}) {
    return `<header class="page-head">
      ${o.back ? `<a class="icon-btn" href="#/${o.back}" aria-label="Back">${icon('back')}</a>` : ''}
      <div class="grow"><h1>${esc(title)}</h1>${o.sub ? `<div class="sub">${o.sub}</div>` : ''}</div>
      ${o.action || ''}
    </header>`;
  }

  let lastRoute = '';
  function render() {
    const [a, b] = route();
    // An invite link opens the join screen for the tenant, whoever is signed in on this phone.
    if (a === 'join' && b) { app.innerHTML = joinView(b); lastRoute = location.hash; return; }
    if (a === 'j' && b) { app.innerHTML = shortJoinView(b.toUpperCase()); lastRoute = location.hash; return; }
    if (!session) { app.innerHTML = loginView(); return; }
    const views = { landlord: L, tenant: TN, caretaker: C }[session.role];
    const view = views[a] || views.home;
    const active = NAV[session.role].some((n) => n[0] === a) ? a : ({ tenant: 'tenants', property: 'properties', collections: 'home', payments: 'home', reports: 'more', requests: 'more', caretakers: 'more', reminders: 'more', activity: session.role === 'landlord' ? 'more' : 'activity', privacy: 'more', messages: 'more', reference: session.role === 'landlord' ? 'tenants' : 'home' }[a] || 'home');
    app.innerHTML = shell(view(b), active);
    const r = location.hash;
    if (r !== lastRoute) {
      const prev = lastRoute; lastRoute = r;
      window.scrollTo(0, 0);
      if (prev) pageTransition(prev, r);
    }
    setupCollapse();
  }

  /* Page changes slide, so it's always clear where you went:
     going deeper (Home → Payments → a tenant) slides in from the right, going back slides in
     from the left, and switching between bottom tabs rises gently from below. */
  function routeDepth(h) {
    const [a, b] = h.replace(/^#\/?/, '').split('/');
    if (!a || a === 'home') return 0;
    const isTab = NAV[session.role].some((n) => n[0] === a) || a === TOP_ROUTE[session.role];
    return (isTab ? 1 : 2) + (b ? 1 : 0);
  }
  function pageTransition(from, to) {
    const main = document.getElementById('main');
    if (!main || !main.animate || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const d1 = routeDepth(from), d2 = routeDepth(to);
    const start = d2 > d1 ? 'translateX(56px)' : d2 < d1 ? 'translateX(-56px)' : 'translateY(22px)';
    main.animate([{ transform: start, opacity: 0 }, { transform: 'none', opacity: 1 }],
      { duration: 380, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }

  /* ---------- Summary cards that shrink into the top-right corner ----------
     On phones, as the page scrolls up the whole block of cards (same 2×2 arrangement)
     shrinks and glides into the top-right corner, just under the top bar, and stays there.
     As it gets small, each card swaps to a bigger short label so it stays readable.
     Tap the small block to go back to the top. */
  // Smoothness: the block is pinned with CSS `position: sticky`, so the browser holds it in the corner
  // on its own; script only changes its size while it is shrinking. Once fully shrunk nothing is
  // updated at all, so it sits perfectly still however you scroll, until you come back up.
  const SHRINK_TO = 0.5;    // final size: half
  const SHRINK_EXTRA = 140; // px of scrolling after reaching the corner while it finishes shrinking
  const wide = matchMedia('(min-width: 900px)');
  let collapse = null, ticking = false;
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const ease = (t) => t * t * (3 - 2 * t); // gentle start and finish
  function setupCollapse() {
    collapse = null;
    const stats = app.querySelector('.stats[data-collapse]');
    const bar = app.querySelector('.topbar');
    if (!stats || !bar) return;
    stats.querySelectorAll('.stat').forEach((c) => {
      c.insertAdjacentHTML('beforeend', `<div class="compact" aria-hidden="true"><span class="c-label">${esc(c.dataset.short || '')}</span><span class="c-value num">${esc(c.querySelector('.value').textContent)}</span></div>`);
    });
    // A zero-height marker just before the block tells us where it sits in the page, even while it's stuck.
    const anchor = document.createElement('div');
    stats.before(anchor);
    stats.addEventListener('click', () => { if (stats.classList.contains('docked')) window.scrollTo({ top: 0, behavior: 'smooth' }); });
    collapse = { stats, bar, anchor, last: -1 };
    measureCollapse();
  }
  // Where the phone's browser supports scroll-linked CSS animations (recent Chrome / Android, Safari 26+),
  // the shrink and fades run on the graphics chip in lockstep with your finger, with no script per frame.
  // Older browsers fall back to the script below.
  const NATIVE = !!(window.CSS && CSS.supports && CSS.supports('animation-timeline: scroll()'));
  function measureCollapse() {
    const c = collapse;
    if (!c) return;
    c.off = wide.matches;
    const dockTop = c.bar.offsetHeight + 10;
    c.stats.style.top = c.off ? '' : `${dockTop}px`;
    const marginTop = parseFloat(getComputedStyle(c.stats).marginTop) || 0;
    const top = c.stats.style.transform; c.stats.style.transform = '';
    const natural = c.anchor.getBoundingClientRect().top + window.scrollY + marginTop; // page position of the block
    c.stats.style.transform = top;
    c.end = Math.max(1, natural - dockTop) + SHRINK_EXTRA; // scroll position where it's fully shrunk
    c.stats.style.setProperty('--end', `${Math.round(c.end)}px`);
    c.stats.classList.toggle('sda', NATIVE && !c.off);
    c.last = -1;
    updateCollapse();
  }
  function updateCollapse() {
    const c = collapse;
    if (!c || !c.stats.isConnected) return;
    const s = c.stats;
    const p = c.off ? 0 : clamp01(window.scrollY / c.end); // 0 = full size, 1 = fully shrunk
    if (p === c.last) return; // nothing changed (e.g. already docked): leave it completely alone
    if (NATIVE && !c.off) { c.last = p; s.classList.toggle('docked', p === 1); return; } // CSS does the animating
    c.last = p;
    const e = ease(p);
    s.style.transform = p ? `scale(${(1 - (1 - SHRINK_TO) * e).toFixed(4)})` : '';
    s.style.setProperty('--p', e.toFixed(3));
    // Part-way through, the full card text fades out, then the short, larger version fades in (never both at once).
    s.style.setProperty('--f', (1 - clamp01((e - 0.25) / 0.2)).toFixed(3));
    s.style.setProperty('--c', clamp01((e - 0.47) / 0.2).toFixed(3));
    s.classList.toggle('docked', p === 1);
  }
  // Scroll events already arrive once per frame, so update straight away rather than a frame later.
  window.addEventListener('scroll', () => updateCollapse(), { passive: true });
  window.addEventListener('resize', () => measureCollapse());

  /* ---------- Shared numbers ---------- */
  function monthStats(y, m, tenants = activeTenants()) {
    let expected = 0;
    for (const t of tenants) for (const p of LH.periods(t, unitOf(t), T())) if (p.due.getFullYear() === y && p.due.getMonth() === m) expected += p.amount;
    const ids = new Set(tenants.map((t) => t.id));
    const received = sum(state.payments.filter((p) => p.status === 'confirmed' && ids.has(p.tenantId) && parse(p.date).getFullYear() === y && parse(p.date).getMonth() === m), (p) => p.amount);
    const deductions = sum(deductionsIn(y, m), (d) => d.amount);
    return { expected, received, deductions };
  }
  const deductionsIn = (y, m) => (state.deductions || []).filter((d) => { const x = parse(d.date); return x.getFullYear() === y && (m === undefined || x.getMonth() === m); });

  // Three bars per month: expected (grey), received (accent) and deductions (dark neutral).
  function chart(months) {
    const W = 320, H = 132, base = 112, max = Math.max(1, ...months.map((x) => Math.max(x.expected, x.received, x.deductions || 0)));
    const gw = W / months.length;
    const bw = Math.max(4, Math.min(10, (gw - 8) / 3)), gap = bw > 6 ? 1.5 : 1;
    const bars = months.map((x, i) => {
      const cx = i * gw + gw / 2, left = cx - (bw * 3 + gap * 2) / 2;
      const bar = (cls, v, k) => { const h = (v / max) * 96; return `<rect class="${cls}" x="${(left + k * (bw + gap)).toFixed(1)}" y="${(base - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(h, 1).toFixed(1)}" rx="${Math.min(2.5, bw / 3).toFixed(1)}"/>`; };
      return `<g><title>${x.label}: ${money(x.expected)} expected, ${money(x.received)} received, ${money(x.deductions || 0)} deducted</title>
        ${bar('exp', x.expected, 0)}${bar('rec', x.received, 1)}${bar('ded', x.deductions || 0, 2)}
        <text x="${cx}" y="${H - 4}" text-anchor="middle">${x.label}</text></g>`;
    }).join('');
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Rent expected, received and deducted for ${months.length} months">${bars}</svg>
      <div class="legend"><span><i style="background:var(--line-strong)"></i>Expected</span><span><i style="background:var(--accent)"></i>Received</span><span><i style="background:var(--deduct)"></i>Deductions</span></div>`;
  }
  function lastMonths(n) {
    const t = T(), out = [];
    for (let k = n - 1; k >= 0; k--) {
      const d = new Date(t.getFullYear(), t.getMonth() - k, 1);
      out.push({ label: LH.MONTHS[d.getMonth()], ...monthStats(d.getFullYear(), d.getMonth()) });
    }
    return out;
  }

  function tenantRow(t, o = {}) {
    const a = acct(t);
    return `<a class="row" href="#/${o.href || 'tenant/' + t.id}">
      <span class="avatar">${initials(t.name)}</span>
      <div class="grow"><div class="title">${esc(t.name)}</div><div class="meta">${o.meta || esc(where(t))}</div>${(() => { const pr = promiseOf(t); return pr ? `<div class="meta promise${pr.past ? ' past' : ''}">${esc(promiseText(pr))}</div>` : ''; })()}${isLinked(t) ? '' : '<div class="meta link-wait">Not on the app yet</div>'}</div>
      ${o.noEnd ? '' : `<div class="end">${pill(a)}<span class="small muted num">${a.status === 'paid' ? (a.aheadUntil ? 'to ' + a.aheadUntil : '') : money(a.balance)}</span></div>`}
    </a>`;
  }
  function paymentRow(p, o = {}) {
    const t = byId(state.tenants, p.tenantId);
    return `<button class="row" data-action="receipt" data-id="${p.id}">
      <span class="tile neutral">${icon(p.method === 'Cash' ? 'cash' : 'wallet')}</span>
      <div class="grow"><div class="title">${o.self ? esc(p.method) : esc(t ? t.name : 'Tenant')}</div><div class="meta">${fmtDay(parse(p.date))} · ${o.self ? esc(p.receipt || '') : esc(p.method)}${p.by === 'caretaker' && !o.self ? ' · by ' + esc(first(p.byName)) : ''}</div>${o.receiptNo && p.receipt ? `<div class="meta">Receipt ${esc(p.receipt)}</div>` : ''}</div>
      <div class="end"><span class="amount" style="font-weight:700">${money(p.amount)}</span>${o.receiptNo ? '<span class="small" style="color:var(--accent);font-weight:650">View receipt</span>' : ''}</div>
    </button>`;
  }

  /* ---------- Messages: tenants can reply to their landlord ----------
     A tenant answers a notice or their rent reminder ("I'll pay on Friday") instead of phoning.
     The landlord sees it on the tenant's page, in Messages and in notifications, and can answer.
     Until records sync online (Phase 3), messages stay on the phone they were written on. */
  const messages = () => (state.messages = state.messages || []);
  const threadOf = (tid) => messages().filter((m) => m.tenantId === tid).sort((a, b) => a.at - b.at);
  const newFromTenants = () => messages().filter((m) => m.from === 'tenant' && !m.read);
  const newFromLandlord = (tid) => messages().filter((m) => m.tenantId === tid && m.from === 'landlord' && !m.read);
  const snippet = (text, n) => { const s = String(text || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  const clockTime = (ms) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  // The latest "I'll pay on …" day from a tenant who still owes rent (ignored once it's 2 weeks old).
  function promiseOf(t) {
    if (acct(t).balance <= 0) return null;
    const m = [...threadOf(t.id)].reverse().find((x) => x.from === 'tenant' && x.promise);
    if (!m || m.promise < iso(LH.addDays(T(), -14))) return null;
    return { date: parse(m.promise), past: m.promise < iso(T()) };
  }
  const promiseText = (pr) => (pr.past ? `Said they'd pay by ${fmtDay(pr.date)}` : `Will pay on ${LH.fmtLong(pr.date)}`);

  function bubble(m, viewer, withName) {
    const mine = m.from === viewer;
    const t = byId(state.tenants, m.tenantId);
    const n = m.about && m.about !== 'rent' ? byId(state.notices, m.about) : null;
    const tag = n ? `Re: ${n.title}` : m.about === 'rent' ? 'About rent' : '';
    const who = mine ? 'You' : m.from === 'landlord' ? first(state.landlord.name) : withName && t ? t.name : t ? first(t.name) : 'Tenant';
    return `<div class="bubble ${mine ? 'mine' : 'theirs'}">
      ${tag ? `<div class="bubble-tag">${esc(tag)}</div>` : ''}
      <div class="bubble-text">${esc(m.text)}</div>
      ${m.promise ? `<div class="bubble-promise">${icon('clock', 'sm')}Will pay on ${esc(LH.fmtLong(parse(m.promise)))}</div>` : ''}
      <div class="bubble-meta">${esc(who)} · ${fmtDay(parse(m.date))}, ${clockTime(m.at)}</div>
    </div>`;
  }
  function threadHTML(tid, viewer, limit) {
    const list = threadOf(tid), shown = limit ? list.slice(-limit) : list;
    return `<div class="thread">${shown.map((m) => bubble(m, viewer)).join('')}</div>`;
  }

  // The "write a message" sheet, for a tenant (to their landlord) or a landlord (to a tenant).
  // about: 'rent', a notice id, or nothing for a general message.
  function messageSheet(tenantId, about) {
    const tenantSide = session.role === 'tenant';
    const t = byId(state.tenants, tenantId); if (!t) return;
    const n = about && about !== 'rent' ? byId(state.notices, about) : null;
    const to = tenantSide ? first(state.landlord.name) : first(t.name);
    const a = acct(t), owe = a.balance > 0;
    const day = (d) => `<button type="button" class="chip" data-action="pickPromise" data-date="${iso(d)}">${esc(LH.fmtLong(d))}</button>`;
    let promiseBlock = '';
    if (tenantSide && about === 'rent' && owe) {
      let fri = LH.addDays(T(), 1); while (fri.getDay() !== 5) fri = LH.addDays(fri, 1);
      let eom = new Date(T().getFullYear(), T().getMonth() + 1, 0);
      if (eom <= T()) eom = new Date(T().getFullYear(), T().getMonth() + 2, 0);
      const days = [LH.addDays(T(), 1), fri, eom].filter((d, i, arr) => arr.findIndex((x) => iso(x) === iso(d)) === i);
      promiseBlock = `<div class="field"><span class="label">When will you pay ${money(a.balance)}?</span>
          <div class="chips wrap">${days.map(day).join('')}</div>
          <label class="field mt-s" style="margin-bottom:0"><span class="small muted">Or choose a day</span><input class="input" type="date" name="promiseDate" min="${iso(LH.addDays(T(), 1))}" max="${iso(LH.addDays(T(), 90))}" data-input="promiseDate"></label></div>`;
    }
    const quick = tenantSide
      ? (n ? ['Noted, thank you.', 'I have a question: '] : about === 'rent' ? ["I've already paid you. ", 'Can we talk about my rent? '] : ['Hello, '])
      : ['Thank you, noted.', `Thank you, ${first(t.name)}. I'll look out for it.`, 'Please call me when you can.'];
    const earlier = n ? threadOf(t.id).filter((m) => m.about === n.id) : threadOf(t.id).slice(-3);
    openSheet(`${sheetHead(n ? `Reply to “${esc(n.title)}”` : `Message ${esc(to)}`)}
      ${earlier.length ? `<div class="thread mb">${earlier.map((m) => bubble(m, tenantSide ? 'tenant' : 'landlord')).join('')}</div>` : ''}
      <form data-form="sendMessage" autocomplete="off">
        <input type="hidden" name="tenant" value="${t.id}"><input type="hidden" name="about" value="${esc(about || '')}"><input type="hidden" name="promise" value="">
        ${promiseBlock}
        <div class="chips wrap" style="margin-bottom:10px">${quick.map((q) => `<button type="button" class="chip" data-action="quickText" data-text="${esc(q)}">${esc(q.trim().replace(/:$/, ''))}</button>`).join('')}</div>
        <label class="field"><span class="label">Your message</span><textarea class="input" name="text" rows="3" maxlength="500" required placeholder="${tenantSide ? `Write to ${esc(to)}…` : `Write to ${esc(to)}…`}"></textarea></label>
        <button class="btn primary block lg" type="submit">${icon('send', 'sm')}Send to ${esc(to)}</button>
        <button class="btn ghost block mt-s" type="button" data-action="messageWhatsApp" data-phone="${tenantSide ? state.landlord.phone : t.phone}">${icon('chat', 'sm')}Send by WhatsApp instead</button>
      </form>`);
  }

  /* ---------- Rent reference: a tenant's payment record, to show a future landlord ----------
     Built from the payments the landlord recorded or confirmed, so a tenant can't type it in.
     A future landlord checks it by calling the landlord named on it and quoting the code. */
  const plural = (word, n) => (n === 1 ? word : word + 's');
  function howLong(since) {
    const now = T();
    let m = (now.getFullYear() - since.getFullYear()) * 12 + now.getMonth() - since.getMonth();
    if (now.getDate() < since.getDate()) m--;
    m = Math.max(0, m);
    const y = Math.floor(m / 12), r = m % 12;
    if (!y) return r ? `${r} ${plural('month', r)}` : 'less than a month';
    return `${y} ${plural('year', y)}${r ? ` ${r} ${plural('month', r)}` : ''}`;
  }
  function referenceText(t) {
    const rec = LH.rentRecord(state, t, T()), a = acct(t), p = propOf(unitOf(t)), L0 = state.landlord;
    const code = LH.referenceCode(t, T());
    return `Rent reference ${code}

${t.name} has rented from ${L0.business || L0.name} in ${p.area || p.name} since ${LH.monthLabel(rec.since)} (${howLong(rec.since)}).

Rent paid on time: ${rec.onTime} of ${rec.total} ${plural(rec.word, rec.total)} (${Math.round((rec.onTime / rec.total) * 100)}%)
Longest run on time: ${rec.bestStreak} in a row
Rent now: ${a.balance > 0 ? money(a.balance) + ' owed' : 'fully paid'}

To check this reference, call ${L0.name} on ${LH.prettyPhone(L0.phone)} and quote ${code}.
From the rent records kept in Landlord Hub, ${fmtDate(T())}.`;
  }
  function referenceView(t, back) {
    const tenantSide = session.role === 'tenant';
    if (!t) return head('Tenant not found', { back });
    const rec = LH.rentRecord(state, t, T()), a = acct(t), p = propOf(unitOf(t)), L0 = state.landlord;
    const title = head('Rent reference', { back, sub: tenantSide ? 'Your payment record, to show a future landlord' : `${esc(first(t.name))}'s payment record, for a future landlord` });
    if (!rec.total) return `${title}<div class="empty">${icon('clock')}<div class="mt-s">${tenantSide ? 'Your' : esc(first(t.name)) + "'s"} rent record starts once the first rent has fallen due.</div></div>`;
    const code = LH.referenceCode(t, T());
    const strip = rec.periods.slice(-12);
    const stateWord = { ontime: 'paid on time', late: 'paid late', unpaid: 'not paid yet' };
    const pct = Math.round((rec.onTime / rec.total) * 100);
    return `${title}
      <article class="card ref-card" aria-label="Rent reference ${code}">
        <div class="between" style="align-items:flex-start"><div><div class="r-cap">Rent reference</div><div class="ref-name">${esc(t.name)}</div></div><div class="ref-code num">${code}</div></div>
        <div class="small muted mt-s">Renting in ${esc(p.area || p.name)} since ${LH.monthLabel(rec.since)} · ${howLong(rec.since)}</div>
        <div class="ref-score"><span class="num">${rec.onTime}</span> of ${rec.total} ${plural(rec.word, rec.total)} paid on time <span class="pill ${pct >= 90 ? 'paid' : pct >= 70 ? 'partial' : 'overdue'}">${pct}%</span></div>
        <div class="ref-strip" role="img" aria-label="Last ${strip.length} ${plural(rec.word, strip.length)}: ${strip.map((x) => `${x.label} ${stateWord[x.state]}`).join(', ')}">${strip.map((x) => `<i class="${x.state}" title="${esc(x.label)}: ${stateWord[x.state]}"></i>`).join('')}</div>
        <div class="legend ref-legend"><span><i class="ontime"></i>On time</span><span><i class="late"></i>Late</span><span><i class="unpaid"></i>Not paid yet</span></div>
        <dl class="kv mt">
          <dt>Longest run on time</dt><dd>${rec.bestStreak} in a row</dd>
          <dt>Paid late</dt><dd>${rec.late}</dd>
          <dt>Rent now</dt><dd>${a.balance > 0 ? `${money(a.balance)} owed` : 'Fully paid'}</dd>
          <dt>Paid through Landlord Hub</dt><dd>${money(rec.totalPaid)}</dd>
        </dl>
        <div class="ref-landlord"><div class="r-cap">Landlord who can confirm this</div><div class="r-strong">${esc(L0.business || L0.name)}</div><div>${esc(L0.name)} · <span class="num">${LH.prettyPhone(L0.phone)}</span></div></div>
        <p class="small faint" style="margin:12px 0 0">Made on ${fmtDate(T())} from the rent records ${esc(L0.name)} keeps in Landlord Hub. On time means paid in full by the due date, allowing ${LH.REF_GRACE_DAYS} days for mobile money to arrive.</p>
      </article>
      <div class="btn-row mt"><button class="btn primary" data-action="shareReference" data-id="${t.id}">${icon('chat', 'sm')}Share on WhatsApp</button><button class="btn" data-action="copyReference" data-id="${t.id}">${icon('copy', 'sm')}Copy</button></div>
      <p class="small muted mt">${tenantSide
        ? `Send it to a landlord you want to rent from. They can call ${esc(first(L0.name))} and quote <strong>${code}</strong> to check it's real.`
        : `Send it to ${esc(first(t.name))}, or to a landlord who asks about them. Anyone checking it can call you and quote <strong>${code}</strong>.`}</p>`;
  }

  /* =====================================================================
     LANDLORD
     ===================================================================== */
  const L = {};

  L.home = function () {
    const t = T(), hour = new Date().getHours();
    const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    const accts = activeTenants().map((x) => ({ t: x, a: acct(x) }));
    const ms = monthStats(t.getFullYear(), t.getMonth());
    const outstanding = sum(accts, (s) => Math.max(0, s.a.balance));
    const overdue = accts.filter((s) => s.a.status === 'overdue' || (s.a.status === 'partial' && s.a.daysLate > 0)).sort((x, y) => y.a.daysLate - x.a.daysLate);
    const overdueSum = sum(overdue, (s) => s.a.balance);
    const pct = ms.expected ? Math.min(100, Math.round((ms.received / ms.expected) * 100)) : 0;
    const pending = state.payments.filter((p) => p.status === 'pending');
    const recent = state.payments.filter((p) => p.status === 'confirmed').sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 5);
    const monthName = LH.MONTHS_LONG[t.getMonth()];
    const openReq = state.requests.filter((r) => r.status !== 'done').length;
    const newReq = state.requests.filter((r) => r.status === 'open').length;
    // "Today" line: the few things that need the landlord, in plain words, each one tap away.
    const todo = [
      pending.length && `<button class="todo-item" data-action="jump" data-to="sec-confirm">${pending.length} payment${pending.length === 1 ? '' : 's'} to confirm</button>`,
      overdue.length && `<button class="todo-item warn" data-action="jump" data-to="sec-attention">${overdue.length} tenant${overdue.length === 1 ? '' : 's'} late</button>`,
      newReq && `<a class="todo-item" href="#/requests">${newReq} new repair${newReq === 1 ? '' : 's'}</a>`,
      newFromTenants().length && `<a class="todo-item" href="#/messages">${newFromTenants().length} new message${newFromTenants().length === 1 ? '' : 's'}</a>`,
    ].filter(Boolean);

    return `${head(`${greet}, ${first(state.landlord.name)}`, { sub: LH.fmtLong(t), action: `<button class="btn primary sm hide-mob" data-action="recordPayment">${icon('plus', 'sm')}Record payment</button>` })}
      <div class="todo" aria-label="Needs you today">${todo.length ? `<span class="todo-head">Today</span>${todo.join('')}` : `<span class="todo-done">${icon('check', 'sm')}All caught up. Nothing needs you today.</span>`}</div>
      <div class="stats raised" data-collapse>
        <div class="card stat" data-short="Expected"><div class="label">Expected in ${monthName}</div><div class="value">${money(ms.expected)}</div><div class="hint">${activeTenants().length} tenants</div></div>
        <div class="card stat hero" data-short="Received"><div class="label">Received</div><div class="value">${money(ms.received)}</div><div class="hint">${pct}% collected</div><div class="meter" aria-hidden="true"><i style="width:${pct}%"></i></div></div>
        <div class="card stat" data-short="Still owed"><div class="label">Still owed</div><div class="value">${money(outstanding)}</div><div class="hint">All unpaid rent</div></div>
        <div class="card stat ${overdue.length ? 'alert' : ''}" data-short="Late"><div class="label">Tenants late</div><div class="value">${overdue.length}</div><div class="hint">${overdue.length ? money(overdueSum) + ' late' : 'Nobody is late'}</div></div>
      </div>
      <section class="section">
        <div class="section-head"><h2>What would you like to do?</h2></div>
        <nav class="actions-list" aria-label="What would you like to do?">
          ${[
            // [tag, attributes, icon, big label, plain explanation, tone]
            ['button', 'data-action="recordPayment"', 'plus', 'Record a payment', 'A tenant paid you? Write it down here', 'main'],
            ['button', 'data-action="smsPay"', 'sms', 'Record from a payment SMS', 'Paste MTN MoMo or Airtel Money messages'],
            ['a', 'href="#/payments"', 'receipt', 'Payments and receipts', 'See every payment and open its receipt'],
            ['a', 'href="#/collections"', 'chart', 'See graphs of your money', `${money(ms.received)} received in ${monthName}`],
            ['button', 'data-action="jump" data-to="sec-attention"', 'clock', 'Who has not paid', overdue.length ? `${overdue.length} tenant${overdue.length === 1 ? '' : 's'} late · ${money(overdueSum)}` : 'Everyone has paid', overdue.length ? 'warn' : ''],
            ['button', `data-action="remindAll"${overdue.length ? '' : ' disabled'}`, 'bell', 'Remind late tenants', overdue.length ? 'Send them a WhatsApp or SMS' : 'Nobody to remind'],
            ['button', 'data-action="newNotice"', 'notice', 'Send a notice', 'Tell tenants about water, power or rent'],
            ['a', 'href="#/tenants"', 'users', 'My tenants', `${activeTenants().length} tenants · phone numbers and balances`],
            ['a', 'href="#/properties"', 'building', 'My properties', `${state.properties.length} propert${state.properties.length === 1 ? 'y' : 'ies'} · houses, rooms and rent`],
            ['a', 'href="#/reports"', 'file', 'Reports for tax (ZRA)', 'Income by month and property'],
          ].map(([tag, attrs, ic, label, desc, tone = '']) => `<${tag} class="action-tab ${tone}" ${attrs}${tag === 'button' ? ' type="button"' : ''}>
            <span class="at-icon">${icon(ic, 'lg')}</span>
            <span class="at-text"><span class="at-label">${label}</span><span class="at-desc">${desc}</span></span>
            ${icon('chev', 'chev')}</${tag}>`).join('')}
        </nav>
      </section>
      <div class="cols">
        <div class="col">
          ${pending.length ? `<section class="section jump-target" id="sec-confirm"><div class="section-head"><h2>Waiting for you to confirm</h2></div><div class="list">
            ${pending.map((p) => { const tt = byId(state.tenants, p.tenantId); return `<div class="row static" style="align-items:flex-start">
              <span class="tile">${icon('wallet')}</span>
              <div class="grow"><div class="title">${esc(tt.name)} says they paid ${money(p.amount)}</div>
                <div class="meta">${esc(p.method)} · ${fmtDay(parse(p.date))} · Ref ${esc(p.ref || '—')}</div>
                ${p.note ? `<div class="small muted mt-s">“${esc(p.note)}”</div>` : ''}
                <div class="btn-row mt-s" style="max-width:320px"><button class="btn primary sm" data-action="confirmPending" data-id="${p.id}">${icon('check', 'sm')}Confirm</button><button class="btn sm" data-action="rejectPending" data-id="${p.id}">Not received</button></div>
              </div></div>`; }).join('')}
          </div></section>` : ''}
          <section class="section jump-target" id="sec-collection">
            <div class="section-head"><h2>Collection</h2><a href="#/collections">See all</a></div>
            <div class="card pad">
              <div class="between"><div><div style="font-weight:650">${monthName} collection</div><div class="small muted">${money(ms.received)} of ${money(ms.expected)}${ms.deductions ? ` · ${money(ms.deductions)} deducted` : ''}</div></div><span class="pill accent num">${pct}%</span></div>
              <div class="progress mt" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>
              ${chart(lastMonths(6))}
            </div>
          </section>
          <section class="section jump-target" id="sec-attention">
            <div class="section-head"><h2>Needs attention</h2>${overdue.length > 1 ? `<button class="link-btn" data-action="remindAll">Remind all ${overdue.length}</button>` : ''}</div>
            <div class="list">
              ${overdue.length ? overdue.map((s) => `<div class="row-wrap">${tenantRow(s.t, { noEnd: true, meta: `<span class="num" style="color:var(--text);font-weight:600">${money(s.a.balance)}</span> · <span style="color:var(--overdue)">${s.a.daysLate} days late</span>` })}<button class="btn sm" data-action="remind" data-id="${s.t.id}">Remind</button></div>`).join('')
                : `<div class="empty">Everyone is up to date. Nice.</div>`}
            </div>
          </section>
        </div>
        <div class="col">
          <section class="section jump-target" id="sec-recent">
            <div class="section-head"><h2>Recent payments</h2><a href="#/payments">See all</a></div>
            <div class="list">${recent.map((p) => paymentRow(p)).join('') || '<div class="empty">No payments yet.</div>'}</div>
          </section>
          <section class="section">
            <div class="section-head"><h2>Shortcuts</h2></div>
            <div class="list">
              <a class="row" href="#/notices"><span class="tile">${icon('notice')}</span><div class="grow"><div class="title">Send a notice</div><div class="meta">Water, power, rent changes</div></div>${icon('chev', 'chev')}</a>
              <a class="row" href="#/requests"><span class="tile">${icon('tool')}</span><div class="grow"><div class="title">Repairs</div><div class="meta">${openReq} open request${openReq === 1 ? '' : 's'}</div></div>${icon('chev', 'chev')}</a>
              <a class="row" href="#/reports"><span class="tile">${icon('chart')}</span><div class="grow"><div class="title">Reports & ZRA summary</div><div class="meta">Income for ${t.getFullYear()}</div></div>${icon('chev', 'chev')}</a>
            </div>
          </section>
        </div>
      </div>`;
  };

  /* Payments and receipts: every confirmed payment, newest first, grouped by month. Tap one for its receipt. */
  L.payments = function () {
    const pays = state.payments.filter((p) => p.status === 'confirmed').sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.at || 0) - (a.at || 0)));
    const pending = state.payments.filter((p) => p.status === 'pending');
    const t = T(), key = (d) => d.slice(0, 7);
    const thisMonth = pays.filter((p) => key(p.date) === iso(t).slice(0, 7));
    const groups = [];
    pays.forEach((p) => { const g = groups[groups.length - 1]; if (g && g.key === key(p.date)) g.items.push(p); else groups.push({ key: key(p.date), items: [p] }); });
    const monthLabel = (k) => `${LH.MONTHS_LONG[Number(k.slice(5, 7)) - 1]} ${k.slice(0, 4)}`;
    return `${head('Payments and receipts', { back: 'home', sub: 'Tap a payment to see, share or save its receipt' })}
      <div class="stats two raised">
        <div class="card stat hero"><div class="label">This month</div><div class="value">${money(sum(thisMonth, (p) => p.amount))}</div><div class="hint">${thisMonth.length} payment${thisMonth.length === 1 ? '' : 's'}</div></div>
        <div class="card stat"><div class="label">All receipts</div><div class="value">${pays.length}</div><div class="hint">${money(sum(pays, (p) => p.amount))} in total</div></div>
      </div>
      ${pending.length ? `<div class="banner">${icon('clock', 'sm')}<span>${pending.length} payment${pending.length === 1 ? ' is' : 's are'} waiting for you to confirm. A receipt is made once you confirm. <a href="#/home">Go to confirm</a></span></div>` : ''}
      ${groups.map((g) => `<section class="section"><div class="section-head"><h2>${monthLabel(g.key)}</h2><span class="small muted num">${money(sum(g.items, (p) => p.amount))}</span></div>
        <div class="list">${g.items.map((p) => paymentRow(p, { receiptNo: true })).join('')}</div></section>`).join('') || '<div class="empty mt">No payments yet. Record one from the home screen.</div>'}`;
  };

  L.tenants = function () {
    const all = activeTenants().map((t) => ({ t, a: acct(t) }));
    const groups = {
      all: all,
      late: all.filter((s) => s.a.status === 'overdue' || (s.a.status === 'partial' && s.a.daysLate > 0)),
      partial: all.filter((s) => s.a.status === 'partial'),
      due: all.filter((s) => s.a.status === 'due'),
      paid: all.filter((s) => s.a.status === 'paid'),
    };
    const chips = [['all', 'All'], ['late', 'Late'], ['partial', 'Part paid'], ['due', 'Due soon'], ['paid', 'Paid']];
    return `${head('Tenants', { sub: `${all.length} tenants across ${state.properties.length} properties`, action: `<button class="icon-btn" data-action="addTenant" aria-label="Add tenant">${icon('plus')}</button>` })}
      <div class="search"><label class="sr" for="tq">Search tenants</label>${icon('search', 'sm')}<input id="tq" class="input" type="search" placeholder="Search by name, phone or house" value="${esc(ui.tenantQuery)}" data-input="tenantSearch" autocomplete="off"></div>
      <div class="chips mt" role="tablist">${chips.map(([k, l]) => `<button class="chip${ui.tenantFilter === k ? ' active' : ''}" data-action="tenantFilter" data-f="${k}" role="tab" aria-selected="${ui.tenantFilter === k}">${l}<span class="count">${groups[k].length}</span></button>`).join('')}</div>
      <div class="list mt" id="tenant-list">${tenantListHTML(groups[ui.tenantFilter])}</div>`;
  };
  function tenantListHTML(list) {
    const q = ui.tenantQuery.trim().toLowerCase();
    const qd = q.replace(/\D/g, '');
    const f = list.filter((s) => !q || s.t.name.toLowerCase().includes(q) || where(s.t).toLowerCase().includes(q) || (qd && s.t.phone.includes(qd)));
    return f.length ? f.map((s) => tenantRow(s.t)).join('') : '<div class="empty">No tenants match.</div>';
  }

  L.tenant = function (id) {
    const t = byId(state.tenants, id);
    if (!t) return head('Tenant not found', { back: 'tenants' });
    const a = acct(t), u = a.unit, net = LH.network(t.phone);
    const entries = [
      ...a.periods.map((p) => ({ date: p.due, label: `${u.period === 'term' ? '' : 'Rent · '}${p.label}`, amount: p.amount, kind: 'charge' })),
      ...a.payments.map((p) => ({ date: parse(p.date), label: `${p.method}${p.ref ? ' · ' + p.ref : ''}`, amount: -p.amount, kind: 'pay', id: p.id })),
    ].sort((x, y) => x.date - y.date || (x.kind === 'charge' ? -1 : 1));
    let run = 0;
    entries.forEach((e) => { run += e.amount; e.bal = run; });
    const shown = entries.reverse().slice(0, 12);
    const reqs = state.requests.filter((r) => r.tenantId === t.id);

    const big = a.balance > 0 ? money(a.balance) : a.balance < 0 ? money(-a.balance) : 'K0';
    const bigLabel = a.balance > 0 ? 'Owes' : a.balance < 0 ? 'In credit' : 'Balance';
    const pr = promiseOf(t), thread = threadOf(t.id);
    const threadNow = thread.length ? threadHTML(t.id, 'landlord', 4) : '';
    // Opening the tenant's page counts as reading their messages.
    const unread = thread.filter((m) => m.from === 'tenant' && !m.read);
    if (unread.length) { unread.forEach((m) => { m.read = true; }); save(); }

    return `${head(t.name, { back: 'tenants', sub: esc(where(t)), action: `<button class="btn sm" data-action="editTenant" data-id="${t.id}">${icon('edit', 'sm')}Edit</button>` })}
      <div class="cols"><div class="col">
      <div class="card pad">
        <div class="between"><div class="small muted" style="font-weight:550">${bigLabel}</div>${pill(a)}</div>
        <div style="font:680 32px/1.15 var(--font-display);letter-spacing:-.03em;margin:6px 0 4px" class="num">${big}</div>
        <div class="small muted">${statusLine(a)}</div>
        ${pr ? `<div class="promise-line${pr.past ? ' past' : ''}">${icon('clock', 'sm')}<span>${esc(first(t.name))} ${pr.past ? `said they'd pay by ${fmtDay(pr.date)}` : `will pay on ${LH.fmtLong(pr.date)}`}</span></div>` : ''}
        <div class="btn-row mt">
          <button class="btn primary" data-action="recordPayment" data-id="${t.id}">${icon('plus', 'sm')}Add payment</button>
          ${a.balance > 0 ? `<button class="btn" data-action="remind" data-id="${t.id}">${icon('bell', 'sm')}Remind</button>` : ''}
        </div>
      </div>
      <section class="section"><div class="section-head"><h2>Ledger</h2><span class="small faint">Newest first</span></div>
        <div class="list ledger">${shown.map((e) => `<${e.id ? `button data-action="receipt" data-id="${e.id}"` : 'div'} class="row${e.id ? '' : ' static'}">
            <div class="grow"><div class="title" style="font-weight:${e.kind === 'pay' ? 560 : 500}">${e.kind === 'pay' ? 'Payment received' : esc(e.label)}</div><div class="meta">${fmtDate(e.date)}${e.kind === 'pay' ? ' · ' + esc(e.label) : ''}</div></div>
            <div class="end"><span class="amount ${e.kind === 'pay' ? 'credit' : ''}" style="font-weight:600">${e.kind === 'pay' ? '+' + money(-e.amount) : money(e.amount)}</span><span class="bal num">${e.bal < 0 ? money(-e.bal) + ' credit' : 'Bal ' + money(e.bal)}</span></div>
          </${e.id ? 'button' : 'div'}>`).join('')}
        </div>
        ${entries.length > 12 ? `<div class="small faint mt-s" style="padding:0 2px">Showing the latest 12 of ${entries.length} entries.</div>` : ''}
      </section>
      </div><div class="col">
      <section class="section" id="messages"><div class="section-head"><h2>Messages</h2>${thread.length > 4 ? `<button class="link-btn" data-action="conversation" data-id="${t.id}">See all ${thread.length}</button>` : ''}</div>
        <div class="card pad">${threadNow || `<div class="small muted">No messages yet. ${esc(first(t.name))} can reply to your notices and reminders in the app, so you don't have to call.</div>`}
          <button class="btn block mt" data-action="messageTenant" data-id="${t.id}">${icon('chat', 'sm')}Write to ${esc(first(t.name))}</button></div>
      </section>
      <section class="section"><div class="section-head"><h2>App account</h2></div>
        ${isLinked(t)
          ? `<div class="card pad link-card ok"><span class="at-icon">${icon('check')}</span><div class="grow"><strong>Linked to you</strong><div class="small muted">${t.linked ? `Joined on ${fmtDate(parse(t.linked.at))}. ` : ''}${esc(first(t.name))} sees their rent and receipts on their own phone.</div></div></div>`
          : `<div class="card pad link-card"><span class="at-icon">${icon('link')}</span><div class="grow"><strong>Not linked yet</strong><div class="small muted">${t.invite && t.invite.sentAt ? `Invite sent ${fmtDay(parse(t.invite.sentAt))}. Waiting for ${esc(first(t.name))} to open it.` : `Send ${esc(first(t.name))} a link so they can see their rent and pay in the app.`}</div>
              <button class="btn primary sm mt-s" data-action="invite" data-id="${t.id}">${icon('send', 'sm')}${t.invite && t.invite.sentAt ? 'Send the link again' : 'Send invite link'}</button></div></div>`}
      </section>
      <section class="section"><div class="section-head"><h2>Details</h2><button class="link-btn" data-action="editTenant" data-id="${t.id}">Edit details</button></div>
        <div class="card pad"><dl class="kv">
          <dt>Phone</dt><dd>${LH.prettyPhone(t.phone)} ${net ? `<span class="net ${net}" style="margin-left:6px">${net}</span>` : ''}</dd>
          ${(t.lines || []).length ? `<dt>Also pays from</dt><dd>${t.lines.map((p) => `${LH.prettyPhone(p)}${LH.network(p) ? ` <span class="net ${LH.network(p)}" style="margin-left:6px">${LH.network(p)}</span>` : ''}`).join('<br>')}</dd>` : ''}
          <dt>${u.period === 'term' ? 'Rent per term' : 'Monthly rent'}</dt><dd>${money(u.rent)}</dd>
          ${u.service ? `<dt>${esc(u.serviceName || 'Service charge')}</dt><dd>${money(u.service)}</dd>` : ''}
          <dt>Pays</dt><dd>${howOften(t)}${perWord(t) !== 'month' && perWord(t) !== 'term' ? ` · ${money(a.per)} each time` : ''}</dd>
          <dt>Rent due on</dt><dd>${ordinal(t.dueDay)}${perWord(t) === 'month' ? ' of the month' : perWord(t) === 'term' ? ' of the term' : `, every ${perWord(t)}`}</dd>
          <dt>Next due</dt><dd>${fmtDate(a.dueDate)}</dd>
          <dt>Deposit held</dt><dd>${money(t.deposit || 0)}</dd>
          <dt>Moved in</dt><dd>${fmtDate(parse(t.since))}</dd>
          <dt>Reminder language</dt><dd>${LH.LANGS[t.lang || 'en']}</dd>
        </dl>
        <div class="btn-row mt">
          <a class="btn sm" href="tel:+${LH.intl(t.phone)}">${icon('phone', 'sm')}Call</a>
          <a class="btn sm" href="${LH.waLink(t.phone, `Hello ${first(t.name)}, `)}" target="_blank" rel="noopener">${icon('chat', 'sm')}WhatsApp</a>
        </div>
        <button class="btn block mt-s" data-action="editTenant" data-id="${t.id}">${icon('edit', 'sm')}Edit details</button></div>
      </section>
      <section class="section"><div class="section-head"><h2>Repairs</h2></div>
        <div class="list">${reqs.length ? reqs.map(requestRow).join('') : '<div class="empty">No repair requests.</div>'}</div>
      </section>
      <section class="section"><div class="list">
        <a class="row" href="#/reference/${t.id}"><span class="tile neutral">${icon('shield')}</span><div class="grow"><div class="title">Rent reference</div><div class="meta">Their payment record, for a future landlord</div></div>${icon('chev', 'chev')}</a>
        <button class="row" data-action="noticeTo" data-id="${t.id}"><span class="tile neutral">${icon('file')}</span><div class="grow"><div class="title">Send a letter</div><div class="meta">Late notice, rent change, notice to vacate</div></div>${icon('chev', 'chev')}</button>
        <button class="row" data-action="endTenancy" data-id="${t.id}"><span class="tile neutral">${icon('door')}</span><div class="grow"><div class="title">End tenancy</div><div class="meta">Frees ${esc(u.label)} for a new tenant</div></div>${icon('chev', 'chev')}</button>
      </div></section>
      </div></div>`;
  };
  const ordinal = (x) => { const n = Math.round(Number(x)) || 0; return n + (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'); };

  L.properties = function () {
    const t = T();
    return `${head('Properties', { sub: `${state.units.length} houses and rooms · ${state.units.filter((u) => tenantIn(u)).length} rented out`, action: `<button class="icon-btn" data-action="addProperty" aria-label="Add property">${icon('plus')}</button>` })}
      <div class="stack">${state.properties.map((p) => {
        const units = state.units.filter((u) => u.propertyId === p.id);
        const occ = units.filter((u) => tenantIn(u));
        const ten = occ.map(tenantIn);
        const ms = monthStats(t.getFullYear(), t.getMonth(), ten);
        const late = ten.filter((x) => acct(x).status === 'overdue').length;
        const pct = ms.expected ? Math.min(100, Math.round((ms.received / ms.expected) * 100)) : null;
        return `<a class="card pad" href="#/property/${p.id}" style="display:block;color:inherit">
          <div class="between"><div style="min-width:0"><div style="font-weight:650;font-size:16px">${esc(p.name)}</div><div class="small muted">${esc(p.area)} · ${p.kind === 'boarding' ? `Boarding house · ${new Set(units.map(houseOf)).size} house${new Set(units.map(houseOf)).size === 1 ? '' : 's'}` : p.kind === 'house' ? 'House' : 'Flats or houses'}</div></div>${icon('chev', 'chev')}</div>
          <div class="stats mt" style="grid-template-columns:repeat(3,1fr) !important;gap:8px">
            <div><div class="small muted">${p.kind === 'boarding' ? 'Beds taken' : 'Rented out'}</div><div style="font-weight:650" class="num">${occ.length} of ${units.length}</div></div>
            <div><div class="small muted">This month</div><div style="font-weight:650" class="num">${pct === null ? '—' : money(ms.received)}</div></div>
            <div><div class="small muted">Late</div><div style="font-weight:650;${late ? 'color:var(--overdue)' : ''}" class="num">${late}</div></div>
          </div>
          ${pct === null ? `<div class="small faint mt">No rent due this month${p.kind === 'boarding' ? ' — beds are billed per term' : ''}.</div>` : `<div class="progress mt"><span style="width:${pct}%"></span></div>`}
        </a>`;
      }).join('')}</div>`;
  };

  L.property = function (id) {
    const p = byId(state.properties, id);
    if (!p) return head('Not found', { back: 'properties' });
    const units = state.units.filter((u) => u.propertyId === p.id);
    const care = state.caretakers.filter((c) => c.propertyIds.includes(p.id));
    const boarding = p.kind === 'boarding';
    const row = (u) => {
      const t = tenantIn(u);
      if (t) return tenantRow(t).replace(`<div class="meta">${esc(where(t))}</div>`, `<div class="meta">${esc(u.label)} · ${money(u.rent)}/${perLabel(u)}</div>`);
      return `<div class="row-wrap"><div class="row static"><span class="tile neutral">${icon(boarding ? 'user' : 'door')}</span><div class="grow"><div class="title">${esc(u.label)}</div><div class="meta">Empty · ${money(u.rent)}/${perLabel(u)}</div></div></div><button class="btn sm" data-action="addTenant" data-unit="${u.id}">Add tenant</button></div>`;
    };
    // Boarding houses: one section per house, showing how many of its bed spaces are taken.
    const houses = boarding ? [...new Set(units.map(houseOf))] : [];
    const body = boarding
      ? houses.map((h) => {
          const us = units.filter((u) => houseOf(u) === h), occ = us.filter((u) => tenantIn(u)), free = us.length - occ.length;
          const freeUnit = us.find((u) => !tenantIn(u));
          // Who lives in this house, then one line for the free bed spaces.
          return `<section class="section"><div class="section-head"><div><h2>${esc(h)}</h2><div class="small muted num">${occ.length} of ${us.length} bed spaces taken</div></div><button class="link-btn" data-action="editHouse" data-pid="${p.id}" data-house="${esc(h)}">Edit house</button></div>
            <div class="list">${occ.map(row).join('')}
              <div class="row-wrap house-free"><div class="row static"><span class="tile ${free ? '' : 'neutral'}">${icon(free ? 'plus' : 'check')}</span><div class="grow"><div class="title">${free ? `${free} bed space${free === 1 ? '' : 's'} free` : 'House is full'}</div><div class="meta">${money(us[0].rent)} per bed, per term</div></div></div>
              ${free ? `<button class="btn primary sm" data-action="addTenant" data-unit="${freeUnit.id}">Add tenant</button>` : ''}</div>
            </div></section>`; }).join('') || '<div class="empty">No bed spaces yet. Tap “Bed spaces”.</div>'
      : `<div class="list">${units.map(row).join('') || '<div class="empty">Nothing here yet. Tap “Add”.</div>'}</div>`;
    return `${head(p.name, { back: 'properties', sub: `${esc(p.area)}${boarding ? ` · ${houses.length} house${houses.length === 1 ? '' : 's'}, ${units.length} bed spaces` : ''}`, action: `<button class="btn sm" data-action="addUnit" data-id="${p.id}">${icon('plus', 'sm')}${boarding ? 'Bed spaces' : 'Add'}</button>` })}
      ${boarding ? body.replace('<section class="section">', '<section class="section" style="margin-top:4px">') : body}
      <section class="section"><div class="section-head"><h2>Caretaker</h2><a href="#/caretakers">Manage</a></div>
        <div class="list">${care.length ? care.map((c) => `<div class="row static"><span class="avatar">${initials(c.name)}</span><div class="grow"><div class="title">${esc(c.name)}</div><div class="meta">${LH.prettyPhone(c.phone)} · records cash payments</div></div></div>`).join('') : '<div class="empty">No caretaker for this property.</div>'}</div>
      </section>`;
  };

  L.notices = function () {
    const list = [...state.notices].sort((a, b) => (a.date < b.date ? 1 : -1));
    return `${head('Notices', { sub: 'Sent in the app, by WhatsApp and by SMS', action: `<button class="btn primary sm" data-action="newNotice">${icon('plus', 'sm')}New</button>` })}
      <div class="list">${list.map((n) => `<button class="row" data-action="viewNotice" data-id="${n.id}" style="align-items:flex-start">
        <span class="tile">${icon('notice')}</span>
        <div class="grow"><div class="title">${esc(n.title)}</div><div class="notice-body">${esc(n.body)}</div><div class="meta mt-s">${fmtDay(parse(n.date))} · ${esc(audienceName(n.audience))} · ${n.channels.map(channelName).join(', ')}</div></div>
      </button>`).join('') || '<div class="empty">No notices yet.</div>'}</div>`;
  };
  const channelName = (c) => ({ app: 'App', whatsapp: 'WhatsApp', sms: 'SMS' }[c] || c);
  // A notice goes to 'all', one property id, one tenant id, or a list of tenant ids.
  function audienceName(a) {
    if (a === 'all') return 'All tenants';
    if (Array.isArray(a)) {
      const names = a.map((id) => byId(state.tenants, id)).filter(Boolean).map((t) => t.name);
      if (names.length <= 1) return names[0] || 'Tenants';
      return names.length === 2 ? `${names[0]} and ${names[1]}` : `${names[0]} and ${names.length - 1} others`;
    }
    const p = byId(state.properties, a); if (p) return p.name;
    const t = byId(state.tenants, a); if (t) return t.name;
    return 'Tenants';
  }
  function audienceTenants(a) {
    if (a === 'all') return activeTenants();
    if (Array.isArray(a)) return activeTenants().filter((t) => a.includes(t.id));
    if (byId(state.properties, a)) return activeTenants().filter((t) => unitOf(t).propertyId === a);
    const t = byId(state.tenants, a); return t ? [t] : [];
  }

  L.requests = function () {
    const order = { open: 0, progress: 1, done: 2 };
    const list = [...state.requests].sort((a, b) => order[a.status] - order[b.status] || (a.date < b.date ? 1 : -1));
    return `${head('Repairs', { back: 'home', sub: 'Requests from tenants' })}
      <div class="list">${list.map(requestRow).join('') || '<div class="empty">No requests.</div>'}</div>`;
  };
  function requestRow(r) {
    const t = byId(state.tenants, r.tenantId);
    const st = { open: ['New', 'overdue'], progress: ['In progress', 'partial'], done: ['Done', 'paid'] }[r.status];
    const canEdit = session.role !== 'tenant';
    return `<${canEdit ? `button data-action="requestStatus" data-id="${r.id}"` : 'div'} class="row${canEdit ? '' : ' static'}" style="align-items:flex-start">
      <span class="tile neutral">${icon('tool')}</span>
      <div class="grow"><div class="title" style="white-space:normal">${esc(r.text)}</div><div class="meta">${esc(r.category)} · ${session.role === 'tenant' ? '' : esc(t.name) + ' · '}${fmtDay(parse(r.date))}</div></div>
      <div class="end"><span class="pill ${st[1]}">${st[0]}</span></div>
    </${canEdit ? 'button' : 'div'}>`;
  }

  L.messages = function () {
    const groups = {};
    messages().forEach((m) => { (groups[m.tenantId] = groups[m.tenantId] || []).push(m); });
    const rows = Object.keys(groups).map((tid) => {
      const list = groups[tid].sort((x, y) => x.at - y.at);
      return { t: byId(state.tenants, tid), last: list[list.length - 1], unread: list.filter((m) => m.from === 'tenant' && !m.read).length };
    }).filter((r) => r.t).sort((x, y) => (y.unread > 0) - (x.unread > 0) || y.last.at - x.last.at);
    return `${head('Messages', { back: 'more', sub: 'Replies from your tenants' })}
      <div class="list">${rows.map(({ t, last, unread }) => {
        const pr = promiseOf(t);
        return `<a class="row" href="#/tenant/${t.id}">
          <span class="avatar">${initials(t.name)}</span>
          <div class="grow"><div class="title">${esc(t.name)}</div><div class="meta">${last.from === 'landlord' ? 'You: ' : ''}${esc(snippet(last.text, 80))}</div>${pr ? `<div class="meta promise${pr.past ? ' past' : ''}">${esc(promiseText(pr))}</div>` : ''}</div>
          <div class="end"><span class="small muted">${fmtDay(parse(last.date))}</span>${unread ? `<span class="pill accent">${unread} new</span>` : ''}</div>
        </a>`;
      }).join('') || '<div class="empty">No messages yet. When a tenant replies to a notice or a rent reminder, it shows here.</div>'}</div>
      <p class="small faint mt" style="padding:0 2px">Tenants reply from the app on their own phone. For now, messages reach you once records sync online; until then they can use “Send by WhatsApp instead”.</p>`;
  };
  L.reference = function (id) { return referenceView(byId(state.tenants, id), 'tenant/' + id); };

  L.more = function () {
    const item = (href, ic, title, meta) => `<a class="row" href="#/${href}"><span class="tile">${icon(ic)}</span><div class="grow"><div class="title">${title}</div><div class="meta">${meta}</div></div>${icon('chev', 'chev')}</a>`;
    return `${head('More')}
      ${textSizeCard()}
      ${smsAutoCard()}
      <div class="list mt">
        ${item('reports', 'chart', 'Reports & ZRA summary', 'Income by month and property')}
        ${item('messages', 'chat', 'Messages from tenants', newFromTenants().length ? `${newFromTenants().length} new` : 'Replies to notices and reminders')}
        ${item('requests', 'tool', 'Repairs', `${state.requests.filter((r) => r.status !== 'done').length} open`)}
        ${item('reminders', 'bell', 'Automatic reminders', 'When and how tenants are reminded')}
        ${item('caretakers', 'key', 'Caretakers', `${state.caretakers.length} caretaker${state.caretakers.length === 1 ? '' : 's'}`)}
        ${item('activity', 'clock', 'Activity log', 'Who did what, and when')}
      </div>
      <div class="list mt">
        ${item('privacy', 'shield', 'Account & privacy', 'Profile, payout wallet, your data')}
      </div>
      ${demoControls()}`;
  };

  function demoControls() {
    return `<section class="section"><div class="section-head"><h2>Demo</h2></div><div class="list">
      <button class="row" data-action="switchRole"><span class="tile neutral">${icon('swap')}</span><div class="grow"><div class="title">View as landlord, tenant or caretaker</div><div class="meta">See what each person sees</div></div>${icon('chev', 'chev')}</button>
      <button class="row" data-action="resetDemo"><span class="tile neutral">${icon('clock')}</span><div class="grow"><div class="title">Reset demo data</div><div class="meta">Start again with sample properties</div></div></button>
      <button class="row" data-action="logout"><span class="tile neutral">${icon('logout')}</span><div class="grow"><div class="title">Log out</div></div></button>
    </div></section>`;
  }

  /* All collections, one year at a time: chart, month-by-month table and the year's deductions. */
  L.collections = function (yy) {
    const t = T(), now = t.getFullYear();
    const firstYear = Math.min(now, ...state.payments.map((p) => Number(p.date.slice(0, 4))), ...(state.deductions || []).map((d) => Number(d.date.slice(0, 4))));
    const years = []; for (let y = now; y >= firstYear; y--) years.push(y);
    const y = years.includes(Number(yy)) ? Number(yy) : now;
    const lastM = y === now ? t.getMonth() : 11;
    const months = [];
    for (let m = 0; m <= lastM; m++) months.push({ m, label: LH.MONTHS[m], ...monthStats(y, m, state.tenants) });
    const tot = { expected: sum(months, (x) => x.expected), received: sum(months, (x) => x.received), deductions: sum(months, (x) => x.deductions) };
    const kept = tot.received - tot.deductions;
    const rate = tot.expected ? Math.round((tot.received / tot.expected) * 100) : 0;
    const ded = deductionsIn(y).sort((a, b) => (a.date < b.date ? 1 : -1));
    const propName = (id) => (id ? (byId(state.properties, id) || {}).name || 'Property' : 'All properties');
    return `${head('Collections', { back: 'home', sub: y === now ? `January to ${LH.MONTHS_LONG[lastM]} ${y}` : `All of ${y}`, action: `<button class="btn sm" data-action="addDeduction">${icon('plus', 'sm')}Deduction</button>` })}
      <div class="chips" role="tablist" aria-label="Year">${years.map((v) => `<a class="chip${v === y ? ' active' : ''}" href="#/collections/${v}" role="tab" aria-selected="${v === y}">${v}</a>`).join('')}</div>
      <div class="stats raised mt">
        <div class="card stat"><div class="label">Expected</div><div class="value">${money(tot.expected)}</div><div class="hint">Rent billed</div></div>
        <div class="card stat"><div class="label">Received</div><div class="value">${money(tot.received)}</div><div class="hint">${rate}% collected</div></div>
        <div class="card stat"><div class="label">Deductions</div><div class="value">${money(tot.deductions)}</div><div class="hint">${ded.length} item${ded.length === 1 ? '' : 's'}</div></div>
        <div class="card stat"><div class="label">You kept</div><div class="value">${money(kept)}</div><div class="hint">Received less deductions</div></div>
      </div>
      <div class="cols"><div class="col">
        <section class="section"><div class="card pad"><div style="font-weight:650">Month by month</div>${chart(months)}</div></section>
        <section class="section"><div class="section-head"><h2>Each month</h2></div>
          <div class="list table-wrap"><table class="t months-t"><thead><tr><th>Month</th><th class="r">Expected</th><th class="r">Received</th><th class="r">Deducted</th><th class="r">Kept</th></tr></thead><tbody>
            ${[...months].reverse().map((x) => `<tr><td>${LH.MONTHS[x.m]}</td><td class="r">${money(x.expected)}</td><td class="r">${money(x.received)}</td><td class="r">${x.deductions ? '−' + money(x.deductions) : '—'}</td><td class="r"><strong>${money(x.received - x.deductions)}</strong></td></tr>`).join('')}
          </tbody><tfoot><tr><td>Total</td><td class="r">${money(tot.expected)}</td><td class="r">${money(tot.received)}</td><td class="r">${tot.deductions ? '−' + money(tot.deductions) : '—'}</td><td class="r">${money(kept)}</td></tr></tfoot></table></div>
        </section>
      </div><div class="col">
        <section class="section"><div class="section-head"><h2>Deductions in ${y}</h2><button class="link-btn" data-action="addDeduction">Add</button></div>
          <div class="list">${ded.map((d) => `<div class="row static"><span class="tile neutral">${icon(d.reason === 'Repairs' ? 'tool' : d.reason === 'Caretaker pay' ? 'key' : d.reason === 'Mobile money fees' ? 'wallet' : 'receipt')}</span>
            <div class="grow"><div class="title">${esc(d.reason)}</div><div class="meta">${esc(d.note ? d.note + ' · ' : '')}${esc(propName(d.propertyId))} · ${fmtDay(parse(d.date))}</div></div>
            <div class="end"><span class="num" style="font-weight:600">−${money(d.amount)}</span><button class="link-btn small" data-action="removeDeduction" data-id="${d.id}" aria-label="Remove this deduction">Remove</button></div></div>`).join('') || '<div class="empty">No deductions this year.</div>'}</div>
        </section>
      </div></div>`;
  };

  function deductionSheet() {
    const t = T();
    openSheet(`${sheetHead('Add a deduction')}
      <p class="small muted" style="margin:-4px 0 14px">Money taken out of the rent you collected, such as repairs, caretaker pay or mobile money fees.</p>
      <form data-form="deduction" autocomplete="off">
        <label class="field"><span class="label">Amount</span><div class="input-group"><span class="prefix">K</span><input class="input" name="amount" type="number" inputmode="decimal" min="1" step="0.01" required autofocus></div></label>
        <label class="field"><span class="label">What for</span><select class="input" name="reason">${LH.DEDUCTION_REASONS.map((r) => `<option>${r}</option>`).join('')}</select></label>
        <label class="field"><span class="label">Property</span><select class="input" name="property"><option value="">All properties</option>${state.properties.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label>
        <label class="field"><span class="label">Date</span><input class="input" name="date" type="date" value="${iso(t)}" max="${iso(t)}" required></label>
        <label class="field"><span class="label">Note <span class="faint" style="font-weight:400">(optional)</span></span><input class="input" name="note" placeholder="e.g. Plumber for Flat 4"></label>
        <button class="btn primary block lg" type="submit">Save deduction</button>
      </form>`);
  }

  L.reports = function () {
    const t = T(), y = t.getFullYear();
    const months = [];
    for (let m = 0; m <= t.getMonth(); m++) months.push({ label: LH.MONTHS[m], ...monthStats(y, m, state.tenants) });
    const total = sum(months, (x) => x.received), expected = sum(months, (x) => x.expected);
    const byProp = state.properties.map((p) => {
      const ids = new Set(state.tenants.filter((x) => unitOf(x).propertyId === p.id).map((x) => x.id));
      const got = sum(state.payments.filter((x) => x.status === 'confirmed' && ids.has(x.tenantId) && x.date.startsWith(String(y))), (x) => x.amount);
      return { p, got };
    });
    const tax = total * 0.04;
    return `${head('Reports', { back: 'more', sub: `January to ${LH.MONTHS_LONG[t.getMonth()]} ${y}`, action: `<button class="btn sm" data-action="exportCsv">${icon('download', 'sm')}CSV</button>` })}
      <div class="stats">
        <div class="card stat"><div class="label">Rent received</div><div class="value">${money(total)}</div><div class="hint">${y} so far</div></div>
        <div class="card stat"><div class="label">Collection rate</div><div class="value">${expected ? Math.round((total / expected) * 100) : 0}%</div><div class="hint">of ${money(expected)} billed</div></div>
        <div class="card stat"><div class="label">Occupancy</div><div class="value">${Math.round((state.units.filter((u) => tenantIn(u)).length / state.units.length) * 100)}%</div><div class="hint">${state.units.filter((u) => !tenantIn(u)).length} empty</div></div>
        <div class="card stat"><div class="label">Deposits held</div><div class="value">${money(sum(activeTenants(), (x) => x.deposit || 0))}</div><div class="hint">Refundable</div></div>
      </div>
      <div class="cols"><div class="col">
      <section class="section"><div class="card pad"><div style="font-weight:650">Month by month</div>${chart(months.slice(-12))}</div></section>
      <section class="section"><div class="section-head"><h2>By property</h2></div>
        <div class="list"><table class="t"><thead><tr><th>Property</th><th class="r">Received</th></tr></thead><tbody>
          ${byProp.map((x) => `<tr><td>${esc(x.p.name)}</td><td class="r">${money(x.got)}</td></tr>`).join('')}
        </tbody></table></div>
      </section>
      </div><div class="col">
      <section class="section"><div class="section-head"><h2>ZRA rental income summary</h2></div>
        <div class="card pad">
          <dl class="kv">
            <dt>Gross rental income, ${y}</dt><dd>${money(total)}</dd>
            <dt>Estimated tax at 4%</dt><dd>${money(tax)}</dd>
            <dt class="total">Kept after tax</dt><dd class="total">${money(total - tax)}</dd>
          </dl>
          <div class="banner warn">${icon('info', 'sm')}<span>Estimate only. Assumes the residential rental income tax rate of 4% for income up to K800,000 a year. Confirm current rates with ZRA or your tax adviser before filing.</span></div>
          <button class="btn block mt" data-action="exportCsv">${icon('download', 'sm')}Download payments for ${y}</button>
        </div>
      </section>
      <section class="section"><div class="section-head"><h2>Weekly WhatsApp summary</h2></div>
        <div class="card pad"><div class="prose small" style="background:var(--surface-2);border:1px solid var(--line);border-radius:10px;padding:12px">${esc(weeklySummary())}</div>
        <a class="btn block mt" href="${LH.waLink('', weeklySummary())}" target="_blank" rel="noopener">${icon('chat', 'sm')}Share on WhatsApp</a>
        <div class="small faint mt-s">Sent every Monday morning — handy if you manage your property from abroad.</div></div>
      </section>
      </div></div>`;
  };
  function weeklySummary() {
    const t = T(), wk = LH.addDays(t, -6);
    const week = sum(state.payments.filter((p) => p.status === 'confirmed' && parse(p.date) >= wk && parse(p.date) <= t), (p) => p.amount);
    const ms = monthStats(t.getFullYear(), t.getMonth());
    const late = activeTenants().map(acct).filter((a) => a.status === 'overdue');
    const pend = state.payments.filter((p) => p.status === 'pending').length;
    return `Landlord Hub · week of ${fmtDay(wk)}–${fmtDay(t)}\n` +
      `Received this week: ${money(week)}\n` +
      `${LH.MONTHS_LONG[t.getMonth()]} so far: ${money(ms.received)} of ${money(ms.expected)}\n` +
      `Overdue: ${late.length} tenant${late.length === 1 ? '' : 's'}, ${money(sum(late, (a) => a.balance))}\n` +
      (pend ? `Waiting for your confirmation: ${pend}` : 'Nothing waiting for confirmation');
  }

  L.reminders = function () {
    const r = state.reminders;
    const sw = (k, title, meta) => `<label class="switch"><div class="grow"><div style="font-weight:560">${title}</div><div class="small muted">${meta}</div></div><input type="checkbox" data-action="toggleReminder" data-k="${k}" ${r[k] ? 'checked' : ''}></label>`;
    const sample = activeTenants().find((t) => acct(t).status === 'overdue') || activeTenants()[0];
    return `${head('Automatic reminders', { back: 'more', sub: 'Sent for you, so you don\'t have to chase' })}
      <div class="list">
        ${sw('before5', '5 days before', 'A friendly heads-up')}
        ${sw('dueDay', 'On the due day', 'Includes the Pay button')}
        ${sw('late3', '3 days late', 'Polite but clear')}
        ${sw('weekly', 'Every week after that', 'Until the rent is paid')}
      </div>
      <section class="section"><div class="section-head"><h2>Send by</h2></div>
        <div class="card pad"><div class="seg" role="radiogroup">
          ${[['whatsapp', 'WhatsApp, SMS if no WhatsApp'], ['sms', 'SMS only']].map(([v, l]) => `<label><input type="radio" name="ch" value="${v}" data-action="reminderChannel" ${r.channel === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}
        </div><div class="small muted mt">Each tenant gets reminders in their own language: English, Bemba or Nyanja. Change it on the tenant's page.</div></div>
      </section>
      ${sample ? `<section class="section"><div class="section-head"><h2>Preview</h2></div>
        <div class="card pad">${['en', 'bem', 'nya'].map((l) => `<div class="small muted" style="font-weight:600;margin-bottom:4px">${LH.LANGS[l]}</div><div class="prose small" style="margin-bottom:14px">${esc(reminderFor(sample, l))}</div>`).join('')}
        <div class="small faint">Bemba and Nyanja wording is a first draft — have a native speaker review it before launch.</div></div>
      </section>` : ''}`;
  };
  function reminderFor(t, lang) {
    const a = acct(t), u = a.unit;
    return LH.reminderText(lang || t.lang || 'en', {
      first: first(t.name), amount: money(Math.max(a.balance, a.per)), unit: u.label,
      due: a.dueDate, late: a.daysLate > 0, landlord: state.landlord.name, phone: LH.prettyPhone(state.landlord.phone),
    });
  }

  L.caretakers = function () {
    return `${head('Caretakers', { back: 'more', action: `<button class="btn primary sm" data-action="inviteCaretaker">${icon('plus', 'sm')}Invite</button>` })}
      <div class="list">${state.caretakers.map((c) => `<div class="row static"><span class="avatar">${initials(c.name)}</span><div class="grow"><div class="title">${esc(c.name)}</div><div class="meta">${LH.prettyPhone(c.phone)} · ${c.propertyIds.map((id) => esc(byId(state.properties, id).name)).join(', ')}</div></div></div>`).join('') || '<div class="empty">No caretakers yet.</div>'}</div>
      <section class="section"><div class="section-head"><h2>What caretakers can do</h2></div>
        <div class="card pad"><dl class="kv" style="grid-template-columns:auto 1fr">
          ${[['check', 'Record cash payments — both you and the tenant get a receipt straight away'], ['check', 'See tenants and balances for their properties only'], ['check', 'Update repair requests'], ['x', 'See reports, payouts or other properties'], ['x', 'Edit or delete payments']].map(([i, txt]) => `<dt style="color:${i === 'check' ? 'var(--paid)' : 'var(--faint)'}">${icon(i, 'sm')}</dt><dd style="text-align:left;font-weight:450">${txt}</dd>`).join('')}
        </dl></div>
      </section>`;
  };

  L.activity = function () {
    const ev = [
      ...state.payments.filter((p) => p.status !== 'rejected').map((p) => {
        const t = byId(state.tenants, p.tenantId);
        const who = p.by === 'tenant' ? t.name : p.byName;
        const text = p.status === 'pending' ? `${t.name} reported paying ${money(p.amount)} (${p.method}) — waiting for confirmation`
          : p.by === 'tenant' ? `Paid ${money(p.amount)} by ${p.method}` : `Recorded ${money(p.amount)} ${p.method.toLowerCase()} from ${t.name}`;
        return { date: p.date, who, text, ic: p.method === 'Cash' ? 'cash' : 'wallet', at: p.at || 0 };
      }),
      ...state.activity.map((a) => ({ ...a, ic: 'clock', at: a.at || 0 })),
    ].filter((e) => session.role !== 'caretaker' || e.who === me().name)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.at - a.at)).slice(0, 60);
    return `${head('Activity log', { back: session.role === 'landlord' ? 'more' : '', sub: 'Every change is recorded with who made it' })}
      <div class="list">${ev.map((e) => `<div class="row static" style="align-items:flex-start"><span class="tile neutral">${icon(e.ic)}</span><div class="grow"><div class="title" style="white-space:normal;font-weight:500">${esc(e.text)}</div><div class="meta">${esc(e.who)} · ${fmtDate(parse(e.date))}</div></div></div>`).join('') || '<div class="empty">Nothing yet.</div>'}</div>`;
  };

  L.privacy = function () { return privacyView('more'); };
  function privacyView(back) {
    const w = me(), role = session.role;
    return `${head('Account & privacy', { back })}
      <div class="card pad" style="display:flex;gap:14px;align-items:center"><span class="avatar lg">${initials(w.name)}</span><div><div style="font-weight:650;font-size:17px">${esc(w.name)}</div><div class="small muted">${LH.prettyPhone(w.phone)}${w.email ? ' · ' + esc(w.email) : ''}</div></div></div>
      ${role === 'landlord' ? `<section class="section"><div class="list">
        <div class="row static"><span class="tile neutral">${icon('wallet')}</span><div class="grow"><div class="title">Payout wallet</div><div class="meta">${LH.wallet(LH.network(w.payout))} · ${LH.prettyPhone(w.payout)}</div></div></div>
        <div class="row static"><span class="tile neutral">${icon('building')}</span><div class="grow"><div class="title">${esc(w.business || 'No business name')}</div><div class="meta">Business name on your receipts</div></div></div>
      </div></section>` : ''}
      <section class="section"><div class="section-head"><h2>Signing in</h2></div><div class="list">
        <div class="row static"><span class="tile neutral">${icon('phone')}</span><div class="grow"><div class="title">Phone number and one-time code</div><div class="meta">No password to remember</div></div></div>
        <div class="row static"><span class="tile neutral">${icon('key')}</span><div class="grow"><div class="title">PIN or fingerprint on this phone</div><div class="meta">Set when you first sign in</div></div><span class="pill paid">On</span></div>
      </div></section>
      <section class="section"><div class="section-head"><h2>Your data</h2></div><div class="list">
        <button class="row" data-action="showPrivacy"><span class="tile neutral">${icon('file')}</span><div class="grow"><div class="title">Privacy notice</div><div class="meta">What we collect and why</div></div>${icon('chev', 'chev')}</button>
        <button class="row" data-action="exportMine"><span class="tile neutral">${icon('download')}</span><div class="grow"><div class="title">Download my data</div><div class="meta">A copy of everything we hold about you</div></div></button>
        <button class="row" data-action="deleteMe"><span class="tile neutral" style="color:var(--overdue)">${icon('x')}</span><div class="grow"><div class="title" style="color:var(--overdue)">Delete my account</div><div class="meta">Rent records the law requires us to keep are kept, everything else is erased</div></div></button>
      </div></section>
      <div class="small faint mt" style="padding:0 2px">Landlord Hub keeps only names, phone numbers and rent records. It never asks for an NRC, passport or TPIN.</div>`;
  }

  /* =====================================================================
     TENANT
     ===================================================================== */
  const TN = {};
  const myTenant = () => byId(state.tenants, session.id);

  TN.home = function () {
    const t = myTenant(), a = acct(t), u = a.unit, p = propOf(u);
    const cur = a.current;
    const owe = a.balance > 0;
    const recent = [...a.payments].reverse().slice(0, 3);
    const latest = myNotices(t)[0];
    const pend = state.payments.filter((x) => x.tenantId === t.id && x.status === 'pending');
    const pr = promiseOf(t), thread = threadOf(t.id), rec = LH.rentRecord(state, t, T());
    const lf = esc(first(state.landlord.name));
    return `${head(`Hello, ${first(t.name)}`, { sub: `${esc(u.label)} · ${esc(p.name)}` })}
      <div class="card balance-card">
        <div class="between"><div class="label">${owe ? 'You owe' : 'Your balance'}</div>${pill(a)}</div>
        <div class="big">${owe ? money(a.balance) : 'K0'}</div>
        <div class="muted small">${owe ? (a.daysLate ? `Was due ${fmtDate(a.dueDate)} · ${a.daysLate} days late` : `Due ${fmtDate(a.dueDate)}`) : (a.aheadUntil ? `You've paid up to ${a.aheadUntil}. Thank you!` : `All paid. Next rent due ${fmtDate(a.dueDate)}.`)}</div>
        <button class="btn primary block lg mt" data-action="pay">${owe ? `Pay ${money(a.balance)}` : 'Pay in advance'}</button>
        ${owe ? (pr
          ? `<div class="banner">${icon('clock', 'sm')}<span>You told ${lf} you'll pay ${pr.past ? 'by' : 'on'} ${LH.fmtLong(pr.date)}. <button class="link-btn" data-action="replyRent">Change</button></span></div>`
          : `<button class="btn ghost block mt-s" data-action="replyRent">${icon('chat', 'sm')}Can't pay today? Tell ${lf} when</button>`) : ''}
        ${pend.length ? `<div class="banner">${icon('clock', 'sm')}<span>${money(sum(pend, (x) => x.amount))} you reported is waiting for ${esc(first(state.landlord.name))} to confirm.</span></div>` : ''}
      </div>
      <div class="cols"><div class="col">
      ${cur ? `<section class="section"><div class="section-head"><h2>${esc(cur.label)}</h2></div>
        <div class="card pad"><dl class="kv">
          <dt>Rent</dt><dd>${money(cur.rent)}</dd>
          ${cur.service ? `<dt>${esc(u.serviceName || 'Service charge')}</dt><dd>${money(cur.service)}</dd>` : ''}
          <dt>Paid</dt><dd>${money(cur.paidAmt || 0)}</dd>
          <dt class="total">Left to pay</dt><dd class="total">${money(Math.max(0, cur.amount - (cur.paidAmt || 0)))}</dd>
        </dl></div></section>` : ''}
      <section class="section"><div class="section-head"><h2>Recent receipts</h2><a href="#/receipts">See all</a></div>
        <div class="list">${recent.map((x) => paymentRow(x, { self: true })).join('') || '<div class="empty">No payments yet.</div>'}</div>
      </section>
      ${rec.total ? `<section class="section"><div class="section-head"><h2>Your rent record</h2></div>
        <a class="card pad link-card" href="#/reference" style="color:inherit"><span class="at-icon">${icon('shield')}</span><div class="grow"><strong>Paid on time ${rec.onTime} of ${rec.total} ${plural(rec.word, rec.total)}</strong><div class="small muted">Share your rent reference with a landlord you want to rent from next.</div></div>${icon('chev', 'chev')}</a>
      </section>` : ''}
      </div><div class="col">
      <section class="section"><div class="section-head"><h2>Messages</h2>${thread.length > 3 ? `<button class="link-btn" data-action="conversation" data-id="${t.id}">See all</button>` : ''}</div>
        <div class="card pad">${thread.length ? threadHTML(t.id, 'tenant', 3) : `<div class="small muted">Reply to a notice, or tell ${lf} when you'll pay. No need to call.</div>`}
          <button class="btn block mt" data-action="writeLandlord">${icon('chat', 'sm')}Write to ${lf}</button></div>
      </section>
      ${latest ? `<section class="section"><div class="section-head"><h2>Latest notice</h2><a href="#/notices">All notices</a></div>
        <button class="list row" data-action="viewNotice" data-id="${latest.id}" style="align-items:flex-start"><span class="tile">${icon('notice')}</span><div class="grow"><div class="title">${esc(latest.title)}</div><div class="notice-body">${esc(latest.body)}</div><div class="meta mt-s">${fmtDay(parse(latest.date))}</div></div></button>
      </section>` : ''}
      <section class="section"><div class="section-head"><h2>Your landlord</h2></div>
        <div class="card pad"><div style="display:flex;gap:12px;align-items:center"><span class="avatar">${initials(state.landlord.name)}</span><div><div style="font-weight:600">${esc(state.landlord.name)}</div><div class="small muted">${LH.prettyPhone(state.landlord.phone)}</div></div></div>
        <div class="btn-row mt"><a class="btn sm" href="tel:+${LH.intl(state.landlord.phone)}">${icon('phone', 'sm')}Call</a><a class="btn sm" href="${LH.waLink(state.landlord.phone, `Hello ${first(state.landlord.name)}, this is ${t.name} from ${u.label}. `)}" target="_blank" rel="noopener">${icon('chat', 'sm')}WhatsApp</a></div></div>
      </section>
      </div></div>`;
  };
  function myNotices(t) {
    const pid = unitOf(t).propertyId;
    return state.notices.filter((n) => n.audience === 'all' || n.audience === pid || n.audience === t.id || (Array.isArray(n.audience) && n.audience.includes(t.id))).sort((a, b) => (a.date < b.date ? 1 : -1));
  }
  TN.reference = function () { return referenceView(myTenant(), 'home'); };
  TN.receipts = function () {
    const t = myTenant(), a = acct(t);
    return `${head('Receipts', { sub: `${a.payments.length} payments · ${money(a.paid)} in total` })}
      <div class="list">${[...a.payments].reverse().map((x) => paymentRow(x, { self: true })).join('') || '<div class="empty">No payments yet.</div>'}</div>`;
  };
  TN.notices = function () {
    const list = myNotices(myTenant());
    return `${head('Notices', { sub: `From ${esc(state.landlord.name)}` })}
      <div class="list">${list.map((n) => `<button class="row" data-action="viewNotice" data-id="${n.id}" style="align-items:flex-start"><span class="tile">${icon('notice')}</span><div class="grow"><div class="title">${esc(n.title)}</div><div class="notice-body">${esc(n.body)}</div><div class="meta mt-s">${fmtDay(parse(n.date))}</div></div></button>`).join('') || '<div class="empty">No notices yet.</div>'}</div>`;
  };
  TN.requests = function () {
    const list = state.requests.filter((r) => r.tenantId === session.id).sort((a, b) => (a.date < b.date ? 1 : -1));
    return `${head('Repairs', { sub: 'Report something that needs fixing', action: `<button class="btn primary sm" data-action="newRequest">${icon('plus', 'sm')}New</button>` })}
      <div class="list">${list.map(requestRow).join('') || '<div class="empty">Nothing reported. Tap New if something needs fixing.</div>'}</div>`;
  };
  TN.account = function () { return privacyView('') + textSizeCard() + demoControls(); };

  /* =====================================================================
     CARETAKER
     ===================================================================== */
  const C = {};
  const myCare = () => byId(state.caretakers, session.id);
  const careTenants = () => activeTenants().filter((t) => myCare().propertyIds.includes(unitOf(t).propertyId));

  C.home = function () {
    const c = myCare(), t = T();
    const mine = state.payments.filter((p) => p.by === 'caretaker' && p.byName === c.name && p.status === 'confirmed');
    const today = sum(mine.filter((p) => p.date === iso(t)), (p) => p.amount);
    const month = sum(mine.filter((p) => parse(p.date).getMonth() === t.getMonth() && parse(p.date).getFullYear() === t.getFullYear()), (p) => p.amount);
    const late = careTenants().map((x) => ({ t: x, a: acct(x) })).filter((s) => s.a.balance > 0).sort((x, y) => y.a.daysLate - x.a.daysLate);
    return `${head(`Hello, ${first(c.name)}`, { sub: c.propertyIds.map((id) => esc(byId(state.properties, id).name)).join(' · ') })}
      <button class="btn primary block lg" data-action="recordPayment">${icon('cash')}Record cash payment</button>
      <div class="stats two mt raised" data-collapse>
        <div class="card stat" data-short="Today"><div class="label">You collected today</div><div class="value">${money(today)}</div></div>
        <div class="card stat" data-short="This month"><div class="label">This month</div><div class="value">${money(month)}</div></div>
      </div>
      <section class="section"><div class="section-head"><h2>Still to pay</h2></div>
        <div class="list">${late.map((s) => tenantRow(s.t, { href: 'tenants' })).join('') || '<div class="empty">Everyone has paid.</div>'}</div>
      </section>
      <div class="banner">${icon('info', 'sm')}<span>When you record cash, ${esc(first(state.landlord.name))} and the tenant both get a receipt by WhatsApp straight away.</span></div>`;
  };
  C.tenants = function () {
    const list = careTenants();
    return `${head('Tenants', { sub: `${list.length} tenants` })}
      <div class="list">${list.map((t) => { const a = acct(t); return `<button class="row" data-action="recordPayment" data-id="${t.id}"><span class="avatar">${initials(t.name)}</span><div class="grow"><div class="title">${esc(t.name)}</div><div class="meta">${esc(where(t))}</div></div><div class="end">${pill(a)}<span class="small muted num">${a.balance > 0 ? money(a.balance) : ''}</span></div></button>`; }).join('')}</div>
      <div class="small faint mt" style="padding:0 2px">Tap a tenant to record a cash payment.</div>`;
  };
  C.activity = function () { return L.activity(); };
  C.account = function () { return privacyView('') + textSizeCard() + demoControls(); };

  /* =====================================================================
     SHEETS
     ===================================================================== */
  function recordPaymentSheet(tenantId) {
    const isCare = session.role === 'caretaker';
    const pool = isCare ? careTenants() : activeTenants();
    const t = tenantId ? byId(state.tenants, tenantId) : null;
    const a = t ? acct(t) : null;
    const amt = a ? (a.balance > 0 ? a.balance : a.per) : '';
    const methods = isCare ? ['Cash'] : ['Cash', 'MTN MoMo', 'Airtel Money', 'Zamtel Kwacha', 'Bank transfer'];
    openSheet(`${sheetHead(isCare ? 'Record cash payment' : 'Record a payment')}
      ${isCare ? '' : `<button type="button" class="btn block sms-cta" data-action="smsPay">${icon('sms', 'sm')}Paid by MoMo or Airtel? Paste their SMS instead</button>`}
      <form data-form="recordPayment" autocomplete="off">
        <label class="field"><span class="label">Tenant</span>
          <select class="input" name="tenant" required data-input="payTenant">
            <option value="">Choose a tenant</option>
            ${pool.map((x) => { const xa = acct(x); return `<option value="${x.id}" ${t && t.id === x.id ? 'selected' : ''}>${esc(x.name)} — ${esc(unitOf(x).label)}${xa.balance > 0 ? ' · owes ' + money(xa.balance) : ''}</option>`; }).join('')}
          </select></label>
        <label class="field"><span class="label">Amount</span>
          <div class="input-group"><span class="prefix">K</span><input class="input big" name="amount" type="number" inputmode="decimal" min="1" step="0.01" required value="${amt}" data-input="payAmount"></div></label>
        <div class="quick chips" id="pay-quick" aria-label="Quick amounts">${quickAmounts(t, amt)}</div>
        <div class="help" id="pay-help" style="margin:-6px 0 16px">${payHelp(t, amt)}</div>
        ${isCare ? '<input type="hidden" name="method" value="Cash">' : `<div class="field"><span class="label">How did they pay?</span><div class="seg">${methods.map((m, i) => `<label><input type="radio" name="method" value="${m}" ${i === 0 ? 'checked' : ''}><span>${m}</span></label>`).join('')}</div></div>`}
        <div class="btn-row">
          <label class="field" style="flex:1"><span class="label">Date</span><input class="input" type="date" name="date" value="${iso(T())}" max="${iso(T())}" required></label>
          <label class="field" style="flex:1.3"><span class="label">Reference <span class="faint" style="font-weight:400">(optional)</span></span><input class="input" name="ref" placeholder="e.g. MP2411…"></label>
        </div>
        <button class="btn primary block lg" type="submit">${icon('check')}Save and send receipt</button>
      </form>`);
  }
  /* ---------- Payments from mobile money messages ----------
     The landlord pastes (or, on Android, shares) the "money received" SMS from MTN MoMo or
     Airtel Money. Each message is matched to a tenant by any of their phone lines and recorded
     against their rent straight away. Anything unclear is shown for the landlord to decide. */
  function tenantByLine(phone) {
    if (!phone) return null;
    return activeTenants().find((t) => LH.cleanPhone(t.phone) === phone || (t.lines || []).some((l) => LH.cleanPhone(l) === phone)) || null;
  }
  function tenantByName(name) {
    if (!name) return null;
    const words = name.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
    const hits = activeTenants().filter((t) => { const tn = t.name.toLowerCase(); return words.length && words.every((w) => tn.includes(w)); });
    return hits.length === 1 ? hits[0] : null;
  }
  const smsKey = (m) => (m.ref ? 'ref:' + m.ref.toUpperCase() : `x:${m.phone}|${m.amount}|${m.date}`);
  function alreadyRecorded(m) {
    const k = smsKey(m);
    return state.payments.some((p) => p.status !== 'rejected' && (p.smsKey === k || (m.ref && p.ref && p.ref.toUpperCase() === m.ref.toUpperCase())));
  }
  function smsSheet(prefill = '') {
    openSheet(`${sheetHead('Record from a payment SMS')}
      <form data-form="readSms" autocomplete="off">
        <div class="invite-hero"><span class="at-icon">${icon('sms')}</span><div><strong>Paste the message MTN MoMo or Airtel Money sent you</strong><div class="muted small">In your messages, press and hold the payment SMS, tap Copy, then paste it here. You can paste several at once.</div></div></div>
        <label class="field mt"><span class="sr">Payment messages</span><textarea class="input" name="sms" required placeholder="e.g. You have received ZMW 2,000.00 from BWALYA MWANSA 0954410987 … Transaction ID: 7845123690" style="min-height:150px">${esc(prefill)}</textarea></label>
        <button class="btn primary block lg" type="submit">${icon('check')}Read and record</button>
        <p class="small faint mt">Money is matched to a tenant by any of their phone lines. Payments already recorded are skipped.</p>
      </form>`);
  }
  // The thank-you the landlord can send with one tap after a payment is recorded.
  function receiptMessage(t, p) {
    const a = acct(t), when = fmtDate(parse(p.date));
    const bal = a.balance > 0 ? `You still owe ${money(a.balance)}.` : a.balance < 0 ? `You are ${money(-a.balance)} ahead.` : 'Your rent is fully paid.';
    return `Hello ${first(t.name)},\n\n${money(p.amount)} received for your rent on ${when}. Thank you.\n\n${bal}\nReceipt ${p.receipt}\n\n${state.landlord.name}`;
  }
  function smsResults(found, auto) {
    const done = [], ask = [], dup = [];
    const batch = [];
    found.forEach((m) => {
      if (alreadyRecorded(m)) return dup.push(m);
      const t = tenantByLine(m.phone);
      // Messages that didn't come straight from MTN MoMo / Airtel Money (shared from another app, or texted
      // from an ordinary number) could be fake, so the landlord checks them first.
      if (m.unverified) return ask.push({ m, guess: t || tenantByName(m.name) });
      if (t) {
        const p = addPayment({ tenantId: t.id, amount: m.amount, date: m.date && m.date <= iso(T()) ? m.date : iso(T()), method: LH.wallet(m.net || LH.network(state.landlord.phone)), ref: m.ref || '', by: 'landlord', byName: me().name, status: 'confirmed', smsKey: smsKey(m), fromSms: true });
        batch.push(p.id); done.push({ m, t, p });
      } else ask.push({ m, guess: tenantByName(m.name) });
    });
    if (done.length) {
      log(`Recorded ${done.length} payment${done.length === 1 ? '' : 's'} from mobile money messages`);
      save();
      const now = T(), total = sum(done.filter((x) => { const d = parse(x.p.date); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); }), (x) => x.p.amount);
      if (total) { const to = monthStats(now.getFullYear(), now.getMonth()).received; moneyIn = { amount: total, from: to - total, to }; }
    }
    ui.smsAsk = ask;
    const line = (m) => `${money(m.amount)} · ${LH.wallet(m.net || LH.network(state.landlord.phone))}${m.ref ? ` · Ref ${esc(m.ref)}` : ''}`;
    setSheet(`${sheetHead(done.length ? (auto ? 'Rent received by MoMo / Airtel' : 'Payments recorded') : auto ? 'Money received' : 'Messages read')}
      ${done.length ? `<section class="sms-group"><h3>${icon('check', 'sm')}Recorded (${done.length})</h3>${auto ? '<p class="small muted">Read from your MoMo and Airtel messages and taken off what each tenant owes.</p>' : ''}<div class="list">${done.map(({ m, t, p }) => `<div class="row-wrap"><button class="row" data-action="receipt" data-id="${p.id}"><span class="tile">${icon('wallet')}</span><div class="grow"><div class="title">${esc(t.name)}</div><div class="meta">${line(m)}</div><div class="meta">From ${LH.prettyPhone(m.phone)} · receipt ${esc(p.receipt)}</div></div></button><a class="btn sm" href="${LH.waLink(t.phone, receiptMessage(t, p))}" target="_blank" rel="noopener" aria-label="Send ${esc(first(t.name))} a thank-you on WhatsApp">${icon('chat', 'sm')}Thank</a></div>`).join('')}</div></section>` : ''}
      ${ask.length ? `<section class="sms-group"><h3>${icon('info', 'sm')}Needs you (${ask.length})</h3>${ask.some((x) => x.m.unverified) ? `<p class="small muted"><strong>Check your mobile money balance first.</strong> ${ask.every((x) => x.m.unverified) ? "These messages didn't" : "Some of these didn't"} come from MTN, Airtel or Zamtel directly, so they could be fake. Only record money you can see arrived.</p>` : ''}<p class="small muted">Choose who paid. A new number will be added to their lines for next time.</p>
        ${ask.map(({ m, guess }, i) => `<form class="card pad sms-ask" data-form="smsAssign"><input type="hidden" name="i" value="${i}">
          <div class="title" style="font-weight:700">${money(m.amount)}${m.name ? ` from ${esc(m.name)}` : ''}</div><div class="meta">${m.phone ? LH.prettyPhone(m.phone) : 'No number in the message'}${m.ref ? ` · Ref ${esc(m.ref)}` : ''}</div>
          <div class="btn-row mt-s"><select class="input" name="tenant" required style="flex:1.6"><option value="">Who paid?</option>${activeTenants().map((t) => `<option value="${t.id}" ${guess && guess.id === t.id ? 'selected' : ''}>${esc(t.name)} — ${esc(unitOf(t).label)}</option>`).join('')}</select><button class="btn primary" type="submit">Record</button></div>
          ${m.unverified ? `<div class="help">Not from MTN, Airtel or Zamtel directly.</div>` : guess ? `<div class="help">The name matches ${esc(guess.name)}. Check before recording.</div>` : ''}</form>`).join('')}</section>` : ''}
      ${dup.length ? `<p class="small muted mt">${dup.length} message${dup.length === 1 ? ' was' : 's were'} already recorded, so ${dup.length === 1 ? 'it was' : 'they were'} skipped.</p>` : ''}
      ${!found.length ? `<div class="empty">No money received was found in what you pasted. Paste the whole message from MTN MoMo or Airtel Money, including the amount.</div>` : ''}
      <div class="btn-row mt"><button class="btn" data-action="smsAgain">Paste more</button><button class="btn primary" data-action="closeSheet">Done</button></div>`);
    if (done.length) { render(); try { navigator.vibrate && navigator.vibrate(25); } catch (e) {} }
  }

  /* ---------- Android app: read MoMo / Airtel SMS automatically ----------
     Only in the Android app (native.js). The landlord switches it on once in More; from then on
     every "money received" SMS is matched to a tenant by their phone lines and recorded, whether
     it arrived while the app was open or closed. Only new messages after switching on are used. */
  const SMS_AUTO = 'landlordhub.smsauto', SMS_SINCE = 'landlordhub.smssince';
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} };
  // Real payment SMS come from a sender name such as "MoMo", "AirtelMoney" or "Zamtel", never a phone number.
  // Keep in step with TRUSTED_SENDER in android/.../SmsStore.java.
  const TRUSTED_SENDER = /momo|mtn|airtel|zamtel|kwacha/i;
  const trustedSender = (from) => /[a-z]/i.test(String(from || '')) && TRUSTED_SENDER.test(String(from || ''));
  let smsAccess = null; // is Notification access on? (checked each time the app is opened)
  const smsAutoOn = () => !!window.LHNative && lsGet(SMS_AUTO) === '1';
  let smsSyncing = false, smsAgainAfter = false, smsWantsOn = false;
  const smsQueue = []; // pop-ups that arrived while the app is open

  /* Payments read from MoMo / Airtel / Zamtel pop-ups are recorded quietly: no sheet, no prompt.
     Only an exact match between the sender's number and one of a tenant's saved lines is taken off
     that tenant's rent. Anything else waits in a short list on the More page for the landlord. */
  function recordQuietly(found) {
    let changed = false;
    found.forEach((m) => {
      if (alreadyRecorded(m)) return;
      const t = !m.unverified && tenantByLine(m.phone);
      const wallet = LH.wallet(m.net || LH.network(state.landlord.phone));
      if (t) {
        addPayment({ tenantId: t.id, amount: m.amount, date: m.date && m.date <= iso(T()) ? m.date : iso(T()), method: wallet, ref: m.ref || '', by: 'landlord', byName: 'Automatic (' + wallet + ')', status: 'confirmed', smsKey: smsKey(m), fromSms: true });
        state.activity.push({ id: LH.uid('a'), date: iso(T()), who: 'Landlord Hub', text: `Recorded ${money(m.amount)} from ${t.name} (${LH.prettyPhone(m.phone)}) from a ${wallet} message`, at: Date.now() });
      } else {
        state.smsWaiting = state.smsWaiting || [];
        if (state.smsWaiting.some((w) => smsKey(w) === smsKey(m))) return;
        state.smsWaiting.push(m);
      }
      changed = true;
    });
    if (changed) { save(); render(); }
  }
  const smsWaiting = () => (state.smsWaiting = (state.smsWaiting || []).filter((m) => !alreadyRecorded(m)));

  async function nativeSmsSync(live) {
    if (live) smsQueue.push(live);
    if (!window.LHNative || !session || session.role !== 'landlord') return;
    if (smsSyncing) { smsAgainAfter = true; return; } // a second pop-up while the first is being recorded
    smsSyncing = true;
    try {
      const st = await window.LHNative.status().catch(() => ({ granted: false }));
      const was = smsAccess; smsAccess = !!st.granted;
      // Coming back from the phone's settings after tapping Turn on.
      if (smsWantsOn) {
        smsWantsOn = false;
        if (smsAccess) {
          lsSet(SMS_AUTO, '1'); lsSet(SMS_SINCE, String(Date.now())); // only payments from now on
          log('Turned on automatic recording of MoMo, Airtel and Zamtel payments');
          save(); render(); toast('On. Payments from your tenants will now be recorded by themselves.');
        } else toast('Notification access is still off, so payments are not recorded yet.');
      } else if (was !== smsAccess && route()[0] === 'more') render();
      if (!smsAutoOn() || !smsAccess) return;
      const since = Number(lsGet(SMS_SINCE)) || 0;
      const msgs = smsQueue.splice(0).concat(await window.LHNative.pending().catch(() => []));
      const found = [];
      msgs.forEach((x) => {
        if (x.date && x.date < since) return; // from before it was switched on
        const unverified = !trustedSender(x.from);
        LH.parseMoneySms(x.body).forEach((m) => {
          if (!m.date && x.date) m.date = iso(new Date(Number(x.date)));
          if (unverified) m.unverified = true;
          // The sender's name says which wallet it came to when the message itself doesn't.
          else if (!m.net) m.net = /airtel/i.test(x.from) ? 'Airtel' : /zamtel|kwacha/i.test(x.from) ? 'Zamtel' : 'MTN';
          if (!found.some((f) => smsKey(f) === smsKey(m))) found.push(m);
        });
      });
      // Pop-ups from MoMo / Airtel / Zamtel are recorded quietly. A message the landlord shared into
      // the app themselves (Share → Landlord Hub) is shown, so they can check it before recording.
      const shared = found.filter((m) => m.unverified && !alreadyRecorded(m));
      recordQuietly(found.filter((m) => !m.unverified));
      if (shared.length) smsResults(shared, true);
    } finally {
      smsSyncing = false;
      if (smsAgainAfter) { smsAgainAfter = false; nativeSmsSync(); }
    }
  }
  if (window.LHNative) {
    window.LHNative.onMessage((m) => nativeSmsSync(m));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') nativeSmsSync(); });
  }
  function smsAutoCard() {
    const head = '<section class="section"><div class="section-head"><h2>Automatic MoMo, Airtel and Zamtel payments</h2></div>';
    if (!window.LHNative) {
      return `${head}
        <div class="card pad link-card"><span class="at-icon">${icon('sms')}</span><div class="grow"><strong>In the Android app</strong><div class="small muted">Landlord Hub reads the "money received" pop-ups from MTN MoMo, Airtel Money and Zamtel, and takes each payment off the tenant's rent by itself. Here in the browser, use “Record from a payment SMS”.</div></div></div></section>`;
    }
    const on = smsAutoOn() && smsAccess !== false, lost = smsAutoOn() && smsAccess === false;
    const waiting = smsWaiting();
    return `${head}
      <div class="card pad link-card ${on ? 'ok' : ''}"><span class="at-icon">${icon(on ? 'check' : 'sms')}</span><div class="grow">
        <strong>${on ? 'On: payments are recorded by themselves' : lost ? 'Off: notification access was turned off' : 'Record payments automatically'}</strong>
        <div class="small muted">${on
          ? "When a MoMo, Airtel or Zamtel pop-up says money came in from a number saved for a tenant, it is taken off what that tenant owes. Nothing pops up; you see it on the tenant's page."
          : "Landlord Hub does not read your messages. It only looks at the pop-ups from MTN MoMo, Airtel Money and Zamtel. When the number that sent money is one of a tenant's saved lines, the payment is taken off their rent by itself."}</div>
        ${on ? '' : '<div class="small muted mt-s">Tap Turn on, switch on <strong>Landlord Hub</strong> under <strong>Notification access</strong>, then come back.</div>'}
        <button class="btn ${on ? '' : 'primary'} sm mt-s" data-action="${on ? 'smsAutoOff' : 'smsAutoEnable'}">${on ? 'Turn off' : 'Turn on'}</button>
      </div></div>
      ${waiting.length ? `<div class="card pad mt-s"><strong>${waiting.length} payment${waiting.length === 1 ? '' : 's'} from ${waiting.length === 1 ? 'a number' : 'numbers'} not saved for a tenant</strong><div class="small muted">${money(waiting.reduce((x, m) => x + m.amount, 0))} in total. ${waiting.length === 1 ? 'It was' : 'These were'} not taken off anyone's rent.</div>
        <div class="btn-row mt-s"><button class="btn primary sm" data-action="smsReviewWaiting">Choose who paid</button><button class="btn sm" data-action="smsClearWaiting">Clear</button></div></div>` : ''}
    </section>`;
  }

  // One-tap amounts, so most payments need no typing at all.
  function quickAmounts(t, current) {
    if (!t) return '';
    const a = acct(t), per = perWord(t), opts = [];
    if (a.balance > 0) opts.push([a.balance, `All owed ${money(a.balance)}`]);
    if (a.per !== a.balance) opts.push([a.per, `${/^\d/.test(per) ? '' : '1 '}${per} ${money(a.per)}`]);
    if (a.balance > 0 && a.balance > a.per) opts.push([Math.round(a.balance / 2), `Half ${money(Math.round(a.balance / 2))}`]);
    if (per === 'month') opts.push([a.per * 3 + Math.max(0, a.balance), `${a.balance > 0 ? 'Owed + ' : ''}3 months ${money(a.per * 3 + Math.max(0, a.balance))}`]);
    return opts.map(([v, l]) => `<button type="button" class="chip${Number(current) === v ? ' active' : ''}" data-action="quickAmount" data-v="${v}">${l}</button>`).join('');
  }
  function payHelp(t, amount) {
    if (!t) return 'Choose a tenant to see their balance.';
    const a = acct(t), v = Number(amount) || 0;
    if (!v) return `Owes ${money(Math.max(0, a.balance))}.`;
    const after = a.balance - v;
    if (after > 0) return `${money(after)} will still be owed after this payment.`;
    if (after === 0) return 'This clears the balance.';
    const periods = Math.floor(-after / a.per + 0.0001);
    const unitsAhead = a.unit.period === 'term' ? periods : periods * LH.every(t, a.unit), word = a.unit.period === 'term' ? 'term' : 'month';
    return `Clears the balance and leaves ${money(-after)} as advance rent${periods ? ` (${unitsAhead} ${word}${unitsAhead === 1 ? '' : 's'})` : ''}.`;
  }

  function addPayment(p) {
    state.receiptSeq++;
    p.receipt = `LH-${p.date.slice(0, 4)}-${String(state.receiptSeq).padStart(4, '0')}`;
    p.id = p.id || LH.uid('p');
    p.at = Date.now();
    state.payments.push(p);
    save();
    return p;
  }

  /* ---------- Money into "Received" ----------
     When the landlord receives a payment, a clear "K2,000 received" card shows in the middle,
     then glides into the Received card, which glows while its figure counts up. */
  let moneyIn = null;
  function moneyToReceived({ amount, from, to }) {
    const card = document.querySelector('.stat.hero[data-short="Received"]');
    if (!card) return;
    const val = card.querySelector('.value'), cval = card.querySelector('.c-value');
    const end = card.getBoundingClientRect();
    if (end.bottom < 0 || end.top > innerHeight) return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Show the old total until the money arrives, so the rise is visible.
    if (from != null && to != null) { val.textContent = money(from); if (cval) cval.textContent = money(from); }
    // The card's figure rises steadily from the old total to the new one.
    const countUp = () => {
      if (to == null || from == null || from === to) return;
      const t0 = performance.now(), dur = reduce ? 0 : 1100;
      const step = (now) => {
        const k = dur ? Math.min(1, (now - t0) / dur) : 1, e = 1 - Math.pow(1 - k, 3);
        const v = money(Math.round(from + (to - from) * e));
        val.textContent = v; if (cval) cval.textContent = v;
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };
    // On arrival: a soft glow around the card and a "+K2,000" label that rises above it, then fades.
    const arrive = () => {
      card.animate([
        { boxShadow: '0 0 0 0 rgba(29,114,69,0)' },
        { boxShadow: '0 0 0 5px rgba(29,114,69,.45), 0 16px 30px -14px rgba(126,2,35,.6)', offset: 0.25 },
        { boxShadow: '0 0 0 0 rgba(29,114,69,0)' },
      ], { duration: 1400, easing: 'ease-out' });
      const r = card.getBoundingClientRect();
      const tag = document.createElement('div');
      tag.className = 'money-tag'; tag.setAttribute('aria-hidden', 'true');
      tag.textContent = `+${money(amount)}`;
      document.body.appendChild(tag);
      const tx = r.left + r.width / 2 - tag.offsetWidth / 2, ty = r.bottom + 6;
      tag.animate([
        { transform: `translate(${tx}px, ${ty + 10}px)`, opacity: 0 },
        { transform: `translate(${tx}px, ${ty}px)`, opacity: 1, offset: 0.15 },
        { transform: `translate(${tx}px, ${ty}px)`, opacity: 1, offset: 0.75 },
        { transform: `translate(${tx}px, ${ty - 6}px)`, opacity: 0 },
      ], { duration: 2200, easing: 'ease-out', fill: 'both' }).onfinish = () => tag.remove();
      countUp();
    };
    if (reduce) return arrive();
    // 1. A clear card appears in the middle: "K2,000 received" — held long enough to read.
    // 2. It glides smoothly up to the Received card, getting smaller, and settles into it.
    const note = document.createElement('div');
    note.className = 'money-fly'; note.setAttribute('aria-hidden', 'true');
    note.innerHTML = `<span class="mf-tick">${icon('check', 'sm')}</span><span><span class="mf-amt num">${money(amount)}</span><span class="mf-sub">received</span></span>`;
    document.body.appendChild(note);
    const w = note.offsetWidth, h = note.offsetHeight;
    const sx = innerWidth / 2, sy = innerHeight * 0.55;
    const ex = end.left + end.width / 2, ey = end.top + end.height / 2;
    const at = (x, y, s) => `translate(${x - w / 2}px, ${y - h / 2}px) scale(${s})`;
    note.animate([
      { transform: at(sx, sy + 16, 0.92), opacity: 0 },
      { transform: at(sx, sy, 1), opacity: 1, offset: 0.16 },
      { transform: at(sx, sy, 1), opacity: 1, offset: 0.46 },                       // hold to read
      { transform: at((sx + ex) / 2, (sy + ey) / 2 - 24, 0.7), opacity: 1, offset: 0.74 }, // gentle curve
      { transform: at(ex, ey, 0.32), opacity: 0 },
    ], { duration: 2000, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'both' }).onfinish = () => { note.remove(); arrive(); };
  }

  function paidSheet(p, msg) {
    const t = byId(state.tenants, p.tenantId);
    // Landlord only: queue the "money into Received" animation for when this sheet closes.
    if (session.role === 'landlord') {
      const now = T(), d = parse(p.date), thisMonth = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
      const to = monthStats(now.getFullYear(), now.getMonth()).received;
      moneyIn = { amount: p.amount, from: thisMonth ? to - p.amount : null, to: thisMonth ? to : null };
    }
    try { navigator.vibrate && navigator.vibrate(25); } catch (e) {}
    setSheet(`<div class="done">
      <div class="done-mark"><svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg></div>
      <h2>${money(p.amount)}</h2>
      <div style="font-weight:650;margin-top:6px">Paid</div>
      <div class="what">${esc(msg || `${t.name} · ${p.method}`)}</div>
      <div class="small faint mt-s">Receipt ${esc(p.receipt)}</div>
      <div class="btn-row mt" style="margin-top:22px"><button class="btn" data-action="receipt" data-id="${p.id}">${icon('receipt', 'sm')}View receipt</button><button class="btn primary" data-action="closeSheet">Done</button></div>
    </div>`);
    render();
  }

  // "K2,350.50" → "Two thousand three hundred and fifty kwacha and fifty ngwee only"
  function amountInWords(n) {
    const ones = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
    const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
    const under1000 = (x) => {
      const h = Math.floor(x / 100), r = x % 100;
      const rest = r < 20 ? ones[r] : tens[Math.floor(r / 10)] + (r % 10 ? '-' + ones[r % 10] : '');
      return [h ? ones[h] + ' hundred' : '', rest].filter(Boolean).join(h && rest ? ' and ' : '');
    };
    const words = (x) => {
      if (x === 0) return 'zero';
      const parts = [];
      [[1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand'], [1, '']].forEach(([v, name]) => {
        const c = Math.floor(x / v) % 1000;
        if (c) parts.push(under1000(c) + (name ? ' ' + name : ''));
      });
      const last = x % 1000;
      if (parts.length > 1 && last > 0 && last < 100) parts[parts.length - 1] = 'and ' + parts[parts.length - 1];
      return parts.join(' ');
    };
    const k = Math.floor(n), ng = Math.round((n - k) * 100);
    const s = `${words(k)} kwacha${ng ? ' and ' + words(ng) + ' ngwee' : ''} only`;
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // Receipt watermark: the Landlord Hub logo, with its white house and lettering turned into a faint
  // wine tint on transparent paper (the logo's own red background drops away). Made once, then reused.
  let watermarkDone = false;
  function ensureWatermark() {
    if (watermarkDone) return; watermarkDone = true;
    const img = new Image();
    img.onload = () => {
      try {
        const w = 600, h = Math.round((img.naturalHeight / img.naturalWidth) * w);
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const g = c.getContext('2d'); g.drawImage(img, 0, 0, w, h);
        const d = g.getImageData(0, 0, w, h), px = d.data;
        for (let i = 0; i < px.length; i += 4) {
          const lum = (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
          const a = Math.max(0, Math.min(1, (lum - 0.25) / 0.6)); // background ≈ 0, white strokes ≈ 1
          px[i] = 126; px[i + 1] = 2; px[i + 2] = 35; px[i + 3] = Math.round(a * 255);
        }
        g.putImageData(d, 0, 0);
        document.documentElement.style.setProperty('--wm', `url(${c.toDataURL('image/png')})`);
      } catch (e) { /* no watermark if the browser blocks canvas reads */ }
    };
    img.src = 'icons/logo.webp';
  }

  function receiptSheet(id) {
    const p = byId(state.payments, id); if (!p) return;
    const t = byId(state.tenants, p.tenantId), u = unitOf(t);
    const a = acct(t);
    const text = `Receipt ${p.receipt}\n${money(p.amount)} received from ${t.name} for ${u.label}, ${propOf(u).name}.\nPaid ${fmtDate(parse(p.date))} by ${p.method}${p.ref ? ' (ref ' + p.ref + ')' : ''}.\nBalance now ${money(Math.max(0, a.balance))}.\n— ${state.landlord.name}, via Landlord Hub`;
    const L0 = state.landlord, prop = propOf(u);
    ensureWatermark();
    // A one-page, standard receipt: issuer, receipt number and date, payer, amount in figures and words,
    // payment details, balance, a PAID stamp and a signature line, over a faint Landlord Hub watermark.
    openSheet(`${sheetHead('Receipt')}
      <article class="receipt doc" aria-label="Receipt ${esc(p.receipt || '')}">
        <div class="r-watermark" aria-hidden="true"></div>
        <header class="r-head">
          <div class="logo r-logo" role="img" aria-label="Landlord Hub"></div>
          <div class="r-title"><div class="r-kicker">Official receipt</div><div class="r-no num">${esc(p.receipt || '—')}</div><div class="r-date">${fmtDate(parse(p.date))}</div></div>
        </header>
        <div class="r-parties">
          <div><div class="r-cap">Issued by</div><div class="r-strong">${esc(L0.business || L0.name)}</div><div>${esc(L0.name)}</div><div class="num">${LH.prettyPhone(L0.phone)}</div></div>
          <div><div class="r-cap">Received from</div><div class="r-strong">${esc(t.name)}</div><div>${esc(u.label)}, ${esc(prop.name)}</div>${prop.area ? `<div>${esc(prop.area)}</div>` : ''}<div class="num">${LH.prettyPhone(t.phone)}</div></div>
        </div>
        <div class="r-amount-box">
          <div class="r-cap">Amount received</div>
          <div class="r-amount num">${money(p.amount)}</div>
          <div class="r-words">${esc(amountInWords(p.amount))}</div>
          <div class="r-stamp" aria-hidden="true">Paid</div>
        </div>
        <table class="r-table">
          <tr><th scope="row">Payment for</th><td>Rent · ${esc(u.label)}</td></tr>
          <tr><th scope="row">Date paid</th><td>${fmtDate(parse(p.date))}</td></tr>
          <tr><th scope="row">Paid by</th><td>${esc(p.method)}</td></tr>
          ${p.ref ? `<tr><th scope="row">Transaction ref.</th><td class="num">${esc(p.ref)}</td></tr>` : ''}
          <tr><th scope="row">Recorded by</th><td>${esc(p.by === 'tenant' ? 'Tenant, paid in the app' : p.byName)}</td></tr>
          <tr class="r-total"><th scope="row">Account balance today</th><td class="num">${a.balance < 0 ? money(-a.balance) + ' in credit' : a.balance === 0 ? 'Nothing owed' : money(a.balance) + ' owed'}</td></tr>
        </table>
        <footer class="r-foot">
          <div class="r-sign"><div class="r-sign-line">${esc(L0.name)}</div><div class="r-cap">Landlord</div></div>
          <p>Thank you for your payment. Keep this receipt as proof of payment.<br>Made with Landlord Hub · Receipt ${esc(p.receipt || '')}</p>
        </footer>
      </article>
      <div class="btn-row mt"><a class="btn" href="${LH.waLink(session.role === 'tenant' ? state.landlord.phone : t.phone, text)}" target="_blank" rel="noopener">${icon('chat', 'sm')}Share</a><button class="btn" data-action="print">${icon('download', 'sm')}Save PDF</button></div>`);
  }

  function remindSheet(ids) {
    const list = ids.map((id) => byId(state.tenants, id));
    const one = list.length === 1;
    openSheet(`${sheetHead(one ? `Remind ${first(list[0].name)}` : `Remind ${list.length} tenants`)}
      ${one ? `<div class="prose small card pad" style="background:var(--surface-2)">${esc(reminderFor(list[0]))}</div>
        <div class="small faint mt-s">In ${LH.LANGS[list[0].lang || 'en']} · ${LH.prettyPhone(list[0].phone)}</div>
        <div class="btn-row mt"><a class="btn primary" href="${LH.waLink(list[0].phone, reminderFor(list[0]))}" target="_blank" rel="noopener" data-after="reminded" data-id="${list[0].id}">${icon('chat', 'sm')}WhatsApp</a><a class="btn" href="${LH.smsLink(list[0].phone, reminderFor(list[0]))}" data-after="reminded" data-id="${list[0].id}">${icon('sms', 'sm')}SMS</a></div>`
      : `<div class="small muted" style="margin-bottom:12px">Each message is written in the tenant's language with their own amount.</div>
        <div class="list">${list.map((t) => { const a = acct(t); const sent = state.remindedAt[t.id] === iso(T()); return `<div class="row-wrap"><div class="row static"><span class="avatar">${initials(t.name)}</span><div class="grow"><div class="title">${esc(t.name)}</div><div class="meta">${money(a.balance)} · ${LH.LANGS[t.lang || 'en']}</div></div></div><a class="btn sm${sent ? '' : ' primary'}" href="${LH.waLink(t.phone, reminderFor(t))}" target="_blank" rel="noopener" data-after="reminded" data-id="${t.id}">${sent ? 'Sent' : 'Send'}</a></div>`; }).join('')}</div>`}
      <div class="small faint mt">Automatic reminders are ${Object.values(state.reminders).some((v) => v === true) ? 'on' : 'off'}. <a href="#/reminders" data-action="closeSheet">Change schedule</a></div>`);
  }

  function newNoticeSheet(o = {}) {
    const tpl = o.tpl || 'general';
    const tt = o.tenant ? byId(state.tenants, o.tenant) : null;
    const T0 = LH.templates.find((x) => x.id === tpl);
    const fill = (s) => {
      let out = s.replace(/\{landlord\}/g, state.landlord.name);
      if (tt) { const a = acct(tt); out = out.replace(/\{tenant\}/g, first(tt.name)).replace(/\{unit\}/g, unitOf(tt).label).replace(/\{amount\}/g, money(Math.max(0, a.balance))).replace(/\{due\}/g, fmtDate(a.dueDate)); }
      return out.replace(/\{tenant\}/g, '[tenant name]').replace(/\{unit\}/g, '[house or room]').replace(/\{amount\}/g, '[amount]').replace(/\{due\}/g, '[due date]');
    };
    // Who is ticked: everyone by default, or the one tenant the notice was opened for.
    const all = activeTenants();
    const picked = new Set(Array.isArray(o.audience) ? o.audience : tt ? [tt.id] : all.map((t) => t.id));
    const allOn = all.length > 0 && all.every((t) => picked.has(t.id));
    openSheet(`${sheetHead('New notice')}
      <form data-form="sendNotice">
        <div class="field"><span class="label">Start from</span><div class="chips">${LH.templates.map((x) => `<button type="button" class="chip${x.id === tpl ? ' active' : ''}" data-action="pickTemplate" data-tpl="${x.id}" data-tenant="${tt ? tt.id : ''}">${x.name}</button>`).join('')}</div></div>
        <fieldset class="field recipients">
          <legend class="label">Send to</legend>
          <button type="button" class="pick-toggle" data-action="togglePicks" aria-expanded="false" aria-controls="pick-panel">
            <span class="at-icon">${icon('users')}</span>
            <span class="grow"><span class="pick-summary" id="pick-summary">${pickSummary([...picked], all)}</span><span class="pick-sub">Tap to choose who gets it</span></span>
            <span class="pick-caret" aria-hidden="true">${icon('chev')}</span>
          </button>
          <div class="pick-panel" id="pick-panel"><div class="pick-inner">
          <label class="pick-all"><input type="checkbox" data-input="pickAll" ${allOn ? 'checked' : ''}><span class="pick-box" aria-hidden="true">${icon('check', 'sm')}</span><span class="grow"><strong>Select all tenants</strong><span class="pick-sub">${all.length} tenants</span></span></label>
          <div class="pick-props"><span class="pick-hint">Or tick everyone in one building:</span><div class="chips">${state.properties.map((p) => `<button type="button" class="chip" data-action="pickProperty" data-id="${p.id}">${esc(p.name)}</button>`).join('')}</div></div>
          <div class="pick-list">${all.map((t) => `<label class="pick-row"><input type="checkbox" name="to" value="${t.id}" data-input="pickOne" ${picked.has(t.id) ? 'checked' : ''}><span class="pick-box" aria-hidden="true">${icon('check', 'sm')}</span><span class="grow"><span class="pick-name">${esc(t.name)}</span><span class="pick-sub">${esc(where(t))}</span></span></label>`).join('')}</div>
          <div class="pick-count" id="pick-count" aria-live="polite">${pickCountText(picked.size, all.length)}</div>
          <button type="button" class="btn block mt-s" data-action="togglePicks">Done</button>
          </div></div>
        </fieldset>
        <label class="field"><span class="label">Title</span><input class="input" name="title" required value="${esc(fill(T0.title))}" placeholder="e.g. Gate code changing on Friday"></label>
        <label class="field"><span class="label">Message</span><textarea class="input" name="body" required placeholder="Write your notice in plain words.">${esc(fill(T0.body))}</textarea>
          ${/\[/.test(T0.body + T0.title) ? '<div class="help">Replace the words in [brackets] before sending.</div>' : ''}</label>
        <div class="field"><span class="label">Send by</span><div class="seg">
          <label><input type="checkbox" name="ch" value="app" checked><span>App</span></label>
          <label><input type="checkbox" name="ch" value="whatsapp" checked><span>WhatsApp</span></label>
          <label><input type="checkbox" name="ch" value="sms"><span>SMS</span></label>
        </div></div>
        <button class="btn primary block lg" type="submit">${icon('send')}Send notice</button>
      </form>`);
  }
  const pickCountText = (n, total) => (n === 0 ? 'Nobody ticked yet' : n === total ? `All ${total} tenants will get this notice` : `${n} tenant${n === 1 ? '' : 's'} will get this notice`);
  // What the closed drop-down says: "All 11 tenants", "Natasha Phiri", "Natasha Phiri and 2 others".
  function pickSummary(ids, all) {
    if (!ids.length) return 'Nobody chosen yet';
    if (ids.length === all.length) return `All ${all.length} tenants`;
    return audienceName(ids.length === 1 ? ids[0] : ids);
  }
  function syncPicks(form) {
    const boxes = [...form.querySelectorAll('input[name=to]')], on = boxes.filter((b) => b.checked);
    form.querySelector('[data-input=pickAll]').checked = on.length === boxes.length && on.length > 0;
    form.querySelector('#pick-count').textContent = pickCountText(on.length, boxes.length);
    form.querySelector('#pick-summary').textContent = pickSummary(on.map((b) => b.value), activeTenants());
  }

  function addTenantSheet(unitId) { tenantFormSheet(null, unitId); }

  /* One form for adding a tenant and for editing one later: every detail can be changed.
     The house/room list only offers the landlord's own (vacant ones, plus the tenant's current unit). */
  /* Where a tenant can live. Flats and houses are picked one by one; in a boarding house you pick
     the house, and the tenant is given its next free bed space. Value "h:<propertyId>|<house>". */
  const isBoarding = (u) => u && propOf(u).kind === 'boarding';
  const houseValue = (u) => `h:${u.propertyId}|${houseOf(u)}`;
  function placeChoices(t) {
    const groups = [];
    state.properties.forEach((p) => {
      const us = state.units.filter((u) => u.propertyId === p.id);
      const opts = [];
      if (p.kind === 'boarding') {
        [...new Set(us.map(houseOf))].forEach((h) => {
          const inHouse = us.filter((u) => houseOf(u) === h), free = inHouse.filter((u) => !tenantIn(u)).length;
          const mine = t && inHouse.some((u) => u.id === t.unitId);
          if (free || mine) opts.push({ value: `h:${p.id}|${h}`, text: `${h} · ${free} of ${inHouse.length} bed spaces free · ${money(inHouse[0].rent)}/term`, unit: inHouse[0] });
        });
      } else {
        us.filter((u) => !tenantIn(u) || (t && u.id === t.unitId)).forEach((u) => opts.push({ value: u.id, text: `${u.label} · ${money(u.rent)}/${perLabel(u)}`, unit: u }));
      }
      if (opts.length) groups.push({ label: p.name, opts });
    });
    return groups;
  }
  // Turns the choice into an actual bed or flat: keeps the tenant's own bed if they stay in the same house.
  function resolvePlace(value, t) {
    if (!String(value).startsWith('h:')) return value;
    const [pid, house] = value.slice(2).split('|');
    const inHouse = state.units.filter((u) => u.propertyId === pid && houseOf(u) === house);
    if (t && inHouse.some((u) => u.id === t.unitId)) return t.unitId;
    const free = inHouse.filter((u) => !tenantIn(u)).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
    return free.length ? free[0].id : null;
  }
  function placeHelp(value, t) {
    const id = resolvePlace(value, t), u = byId(state.units, id || '');
    const house = value.slice(2).split('|')[1];
    if (!u) return `${house} is full.`;
    return t && t.unitId === id ? `Stays in ${u.label}.` : `They'll get the next free bed space: ${u.label}.`;
  }
  // A unit that stands for the choice (to know its rent and whether it's billed per term).
  const placeUnit = (value) => (String(value).startsWith('h:') ? byId(state.units, resolvePlace(value) || '') || state.units.find((u) => houseValue(u) === value) : unitById(value));

  const lineRow = (p = '') => `<div class="line-row"><div class="input-group grow"><span class="prefix">+260</span><input class="input" name="lines" type="tel" inputmode="tel" placeholder="97 123 4567" value="${p ? esc(LH.cleanPhone(p).slice(1)) : ''}" aria-label="Other phone line"></div><button type="button" class="icon-btn plain" data-action="removeLine" aria-label="Remove this line">${icon('x')}</button></div>`;
  // Cleans the extra lines: valid 10-digit numbers, no repeats, not the main number.
  const readLines = (f, main) => [...new Set(f.getAll('lines').map(LH.cleanPhone).filter((p) => p.length === 10 && p !== main))];

  function tenantFormSheet(t, unitId) {
    const editing = !!t;
    const groups = placeChoices(t);
    const units = groups.flatMap((g) => g.opts);
    const pre = t ? t.unitId : unitId;
    let sel = pre && isBoarding(unitById(pre)) ? houseValue(unitById(pre)) : pre;
    const due = t ? t.dueDay || 1 : 1;
    const every = t ? Math.max(1, Number(t.every) || 1) : 1;
    if (!sel && units.length) sel = units[0].value;
    openSheet(`${sheetHead(editing ? `Edit ${first(t.name)}'s details` : 'Add a tenant')}
      <form data-form="${editing ? 'editTenant' : 'addTenant'}" autocomplete="off">
        ${editing ? `<input type="hidden" name="id" value="${t.id}">` : ''}
        <label class="field"><span class="label">Full name</span><input class="input" name="name" required placeholder="e.g. Mapalo Chirwa" value="${editing ? esc(t.name) : ''}" ${editing ? '' : 'autofocus'}></label>
        <label class="field"><span class="label">Phone number</span><div class="input-group"><span class="prefix">+260</span><input class="input" name="phone" type="tel" inputmode="tel" required placeholder="96 123 4567" data-input="phoneNet" value="${editing ? esc(LH.cleanPhone(t.phone).slice(1)) : ''}"></div><div class="help" id="net-help">${editing ? 'Their app account uses this number to sign in.' : 'After saving, you can send them a link to join you on the app.'}</div></label>
        <div class="field"><span class="label">Other lines they pay from <span class="faint" style="font-weight:400">(optional)</span></span>
          <div class="lines" id="lines">${(editing ? t.lines || [] : []).map(lineRow).join('')}</div>
          <button type="button" class="btn sm block mt-s" data-action="addLine">${icon('plus', 'sm')}Add another line</button>
          <div class="help">Add every MTN, Airtel or Zamtel number they might send rent from. Money from any of these lines is matched to ${editing ? esc(first(t.name)) : 'this tenant'}.</div></div>
        <label class="field"><span class="label">Where will they live?</span><select class="input" name="unit" required data-input="tenantUnit">
          ${units.length ? groups.map((g) => `<optgroup label="${esc(g.label)}">${g.opts.map((o) => `<option value="${esc(o.value)}" ${o.value === sel ? 'selected' : ''}>${esc(o.text)}</option>`).join('')}</optgroup>`).join('') : '<option value="">Nothing empty — add a house or room first</option>'}
        </select><div class="help" id="place-help">${String(sel).startsWith('h:') ? placeHelp(sel, t) : ''}</div></label>
        <label class="field"><span class="label">Moves in</span><input class="input" type="date" name="since" value="${editing ? esc(t.since) : iso(T())}" required></label>
        <div class="field">
          <label class="label" for="due-day">Rent due on (day of the month)</label>
          <div class="due-row"><input class="input due-input num" id="due-day" name="dueDay" type="number" inputmode="numeric" min="1" max="31" step="1" required value="${due}" data-input="dueDay"><span class="due-said" id="due-said">${dueSaid(due)}</span></div>
          <div class="chips mt-s" aria-label="Common due days">${[[1, '1st'], [5, '5th'], [10, '10th'], [15, '15th'], [25, '25th'], [31, 'Last day']].map(([v, l]) => `<button type="button" class="chip${v === due ? ' active' : ''}" data-action="setDueDay" data-v="${v}">${l}</button>`).join('')}</div>
          <div class="help">Type any day from 1 to 31. In shorter months, rent falls due on the last day.</div>
        </div>
        <div class="field" id="every-field" ${placeUnit(sel) && placeUnit(sel).period === 'term' ? 'hidden' : ''}>
          <label class="label" for="every">How often do they pay?</label>
          <div class="due-row"><span class="due-pre">Every</span><input class="input due-input num" id="every" name="every" type="number" inputmode="numeric" min="1" max="24" step="1" required value="${every}" data-input="every"><span class="due-said" id="every-said">${everySaid(every, sel)}</span></div>
          <div class="chips mt-s" aria-label="Common choices">${[[1, 'Monthly'], [2, '2 months'], [3, '3 months'], [6, '6 months'], [12, 'Yearly']].map(([v, l]) => `<button type="button" class="chip${v === every ? ' active' : ''}" data-action="setEvery" data-v="${v}">${l}</button>`).join('')}</div>
          <div class="help">The app charges them on the due day once in each period, and keeps doing so automatically.</div>
        </div>
        <div class="banner" id="term-note" style="margin:0 0 14px" ${placeUnit(sel) && placeUnit(sel).period === 'term' ? '' : 'hidden'}>${icon('info', 'sm')}<span>This bed is paid per term (January, May and September), so it doesn't need a payment period.</span></div>
        <div class="btn-row">
          <label class="field" style="flex:1"><span class="label">Deposit</span><div class="input-group"><span class="prefix">K</span><input class="input" name="deposit" type="number" inputmode="decimal" min="0" value="${editing ? t.deposit || 0 : 0}"></div></label>
          <label class="field" style="flex:1"><span class="label">Reminder language</span><select class="input" name="lang">${Object.entries(LH.LANGS).map(([k, v]) => `<option value="${k}" ${editing && t.lang === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        </div>
        <button class="btn primary block lg" type="submit" ${units.length ? '' : 'disabled'}>${editing ? 'Save changes' : 'Add tenant'}</button>
      </form>`);
  }
  const unitById = (id) => byId(state.units, id);
  const everySaid = (n, unitId) => { n = Math.round(Number(n)); const u = placeUnit(unitId); if (!(n >= 1 && n <= 24)) return 'Choose 1 to 24 months'; const amt = u ? money((u.rent + (u.service || 0)) * n) : ''; return n === 1 ? `month · ${amt} each time` : `months · ${amt} each time`; };
  const dueSaid = (d) => { d = Number(d); return d >= 1 && d <= 31 ? `The ${ordinal(d)} of every month${d > 28 ? ' (or the last day)' : ''}` : 'Choose a day from 1 to 31'; };

  /* ---------- Linking a tenant's own app account to this landlord ----------
     The landlord sends a personal link. It carries the tenant's details, so when the tenant opens it
     on their own phone and confirms their number, their account is joined to this landlord. */
  const b64u = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unb64u = (s) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));
  const isLinked = (t) => !!t.linked || !t.invite; // tenants from before invites existed count as linked
  function inviteData(t) {
    if (!t.invite) { t.invite = { code: Math.random().toString(36).slice(2, 8).toUpperCase(), at: iso(T()) }; save(); }
    const u = unitOf(t), p = propOf(u), L0 = state.landlord;
    return {
      c: t.invite.code,
      t: { id: t.id, name: t.name, phone: t.phone, unitId: t.unitId, since: t.since, dueDay: t.dueDay, every: t.every || 1, deposit: t.deposit || 0, lang: t.lang },
      u: { id: u.id, label: u.label, rent: u.rent, period: u.period, service: u.service || 0, serviceName: u.serviceName || '', propertyId: u.propertyId },
      p: { id: p.id, name: p.name, area: p.area, kind: p.kind },
      l: { name: L0.name, phone: L0.phone, business: L0.business || '' },
    };
  }
  // The long link carries everything itself; used only when the laptop server can't make a short one.
  const longInviteLink = (t) => `${location.origin}${location.pathname}#/join/${b64u(JSON.stringify(inviteData(t)))}`;
  // A random value kept on this phone; the laptop server only lets this phone change the invites it made.
  function inviteSecret() {
    let v = lsGet('landlordhub.invitesecret');
    if (!v || !/^[A-Za-z0-9_-]{16,64}$/.test(v)) {
      const b = new Uint8Array(24); crypto.getRandomValues(b);
      v = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
      lsSet('landlordhub.invitesecret', v);
    }
    return v;
  }
  // Short link, e.g. http://192.168.1.177:5173/j/7KQ2MD — the server keeps the details behind the code.
  async function shortInviteLink(t) {
    try {
      const r = await fetch('api/invites', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: t.id, secret: inviteSecret(), data: inviteData(t) }) });
      if (!r.ok) throw new Error(r.status);
      const { code } = await r.json();
      return `${location.origin}/j/${code}`;
    } catch (e) { return null; }
  }
  // The message: a greeting, a blank line, then the link on a line of its own so it can be tapped.
  const inviteMessage = (t, link) => `Hello ${first(t.name)},\n\nThis is ${state.landlord.name}. I now use Landlord Hub to keep track of rent and receipts.\n\nPlease tap the link below to join me as the tenant of ${unitOf(t).label}, ${propOf(unitOf(t)).name}:\n\n${link}\n\nThank you.`;
  async function inviteSheet(id, justAdded) {
    const t = byId(state.tenants, id); if (!t) return;
    openSheet(`${sheetHead(justAdded ? `${first(t.name)} has been added` : 'Invite to the app')}<div class="empty">${icon('link')}<div class="mt-s">Making ${esc(first(t.name))}'s link…</div></div>`);
    const link = (await shortInviteLink(t)) || longInviteLink(t);
    if (!sheetRoot.classList.contains('open')) return; // closed while waiting
    const msg = inviteMessage(t, link);
    setSheet(`${sheetHead(justAdded ? `${first(t.name)} has been added` : 'Invite to the app')}
      <div class="invite-hero"><span class="at-icon">${icon('link')}</span><div><strong>Send ${esc(first(t.name))} a link to join you</strong><div class="muted small">When ${esc(first(t.name))} opens it on their phone and confirms ${LH.prettyPhone(t.phone)}, their account is linked to yours. They'll see their rent and receipts, and you'll see them as your tenant.</div></div></div>
      <div class="field mt"><span class="label">The message ${esc(first(t.name))} will get</span>
        <div class="invite-msg">${esc(msg).replace(esc(link), `<a href="${esc(link)}" class="invite-url" id="invite-link" target="_blank" rel="noopener">${esc(link)}</a>`)}</div></div>
      ${/^(localhost|127\.|\[::1\])/.test(location.hostname) ? `<div class="banner warn" style="margin:0 0 14px">${icon('info', 'sm')}<span>This link starts with <strong>localhost</strong>, which only works on this computer. Open Landlord Hub from your phone's address (for example 192.168.1.177:5173) and send the invite from there.</span></div>` : ''}
      <div class="stack">
        <a class="btn primary block lg" href="${LH.waLink(t.phone, msg)}" target="_blank" rel="noopener" data-action="inviteSent" data-id="${t.id}">${icon('chat')}Send by WhatsApp</a>
        <a class="btn block" href="sms:+${LH.intl(t.phone)}?body=${encodeURIComponent(msg)}" data-action="inviteSent" data-id="${t.id}">${icon('sms')}Send by SMS</a>
        <button class="btn block" type="button" data-action="copyInvite" data-msg="${esc(msg)}">${icon('copy')}Copy message</button>
      </div>
      <p class="small faint mt">The link only works for ${LH.prettyPhone(t.phone)}. You can send it again from ${esc(first(t.name))}'s page at any time.</p>`);
  }

  // The screen a tenant sees after opening their invite link.
  // Short link (#/j/7KQ2MD): fetch the invite from the server, then show the same join screen.
  const shortJoins = {};
  function shortJoinView(code) {
    const brand = `<div class="logo auth-logo" role="img" aria-label="Landlord Hub"></div>`;
    const got = shortJoins[code];
    if (got && got.data) return joinView(null, got.data);
    if (got && got.failed) {
      return `<div class="auth"><div class="auth-box">${brand}<h1>We couldn't open this invite</h1><p class="lede">Make sure your phone is on the same Wi-Fi as your landlord's Landlord Hub, then tap the link again. If it still doesn't open, ask your landlord to send a new link.</p><button class="btn primary block lg" data-action="retryJoin" data-code="${esc(code)}">Try again</button></div></div>`;
    }
    if (!got) {
      shortJoins[code] = { loading: true };
      fetch(`api/invites/${encodeURIComponent(code)}`).then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
        .then((x) => { shortJoins[code] = { data: x.data }; render(); })
        .catch(() => { shortJoins[code] = { failed: true }; render(); });
    }
    return `<div class="auth"><div class="auth-box">${brand}<h1>Opening your invite…</h1><p class="lede">One moment.</p></div></div>`;
  }

  /* An invite link can be made by anyone, so nothing in it is trusted: every field is checked and
     rebuilt here, and anything that doesn't look right makes the whole link invalid. */
  function cleanInvite(d) {
    if (!d || typeof d !== 'object' || !d.t || !d.u || !d.p || !d.l) return null;
    const { t, u, p, l } = d;
    const ID = /^[A-Za-z0-9_-]{1,40}$/;
    const text = (v, max = 80) => String(v ?? '').replace(/[<>"&`]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
    const num = (v, min, max) => { const x = Number(v); return typeof v !== 'boolean' && v !== '' && v != null && Number.isFinite(x) && x >= min && x <= max ? x : null; };
    if (![t.id, u.id, p.id].every((x) => ID.test(String(x)))) return null;
    const phone = LH.cleanPhone(t.phone), rent = num(u.rent, 0, 10000000), dueDay = num(t.dueDay, 1, 31);
    if (phone.length !== 10 || rent == null || dueDay == null) return null;
    return {
      c: String(d.c || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 12),
      t: { id: t.id, name: text(t.name) || 'Tenant', phone, unitId: u.id, since: /^\d{4}-\d{2}-\d{2}$/.test(t.since) ? t.since : iso(T()), dueDay: Math.round(dueDay), every: Math.round(num(t.every, 1, 12) || 1), deposit: num(t.deposit, 0, 10000000) || 0, lang: ['en', 'bem', 'nya'].includes(t.lang) ? t.lang : 'en' },
      u: { id: u.id, label: text(u.label) || 'Home', rent, period: u.period === 'term' ? 'term' : 'month', service: num(u.service, 0, 10000000) || 0, serviceName: text(u.serviceName), propertyId: p.id },
      p: { id: p.id, name: text(p.name) || 'Property', area: text(p.area), kind: ['flats', 'boarding', 'house'].includes(p.kind) ? p.kind : 'flats' },
      l: { name: text(l.name) || 'Your landlord', phone: LH.cleanPhone(l.phone), business: text(l.business) },
    };
  }

  function joinView(code, pre) {
    let d = pre || null;
    if (!d) { try { d = JSON.parse(unb64u(code)); } catch (e) { d = null; } }
    d = cleanInvite(d);
    const brand = `<div class="logo auth-logo" role="img" aria-label="Landlord Hub"></div>`;
    if (!d || !d.t || !d.l) {
      return `<div class="auth"><div class="auth-box">${brand}<h1>This link doesn't work</h1><p class="lede">It may have been cut off when it was copied. Ask your landlord to send it again.</p><a class="btn primary block lg" href="#/home">Go to Landlord Hub</a></div></div>`;
    }
    ui.join = ui.join && ui.join.code === d.c ? ui.join : { code: d.c, step: 'phone', data: d };
    const j = ui.join, per = d.u.period === 'term' ? 'term' : (d.t.every || 1) > 1 ? `${d.t.every} months` : 'month';
    const card = `<div class="join-card">
        <div class="join-from"><span class="avatar">${initials(d.l.name)}</span><div><div class="r-cap" style="color:var(--muted)">Invitation from</div><strong>${esc(d.l.name)}</strong>${d.l.business ? `<div class="small muted">${esc(d.l.business)}</div>` : ''}</div></div>
        <dl class="kv mt">
          <dt>Tenant</dt><dd>${esc(d.t.name)}</dd>
          <dt>Home</dt><dd>${esc(d.u.label)}, ${esc(d.p.name)}</dd>
          <dt>Rent</dt><dd>${money((d.u.rent + (d.u.service || 0)) * (d.u.period === 'term' ? 1 : d.t.every || 1))} ${per === 'month' || per === 'term' ? `a ${per}` : `every ${per}`}</dd>
          <dt>Due</dt><dd>${per === 'month' || per === 'term' ? `${ordinal(d.t.dueDay)} of each ${per}` : `${ordinal(d.t.dueDay)}, every ${per}`}</dd>
        </dl></div>`;
    if (j.step === 'otp') {
      return `<div class="auth"><div class="auth-box">${brand}
        <h1>Enter your code</h1><p class="lede">In the live app, a 6-digit code is sent by SMS to <strong>${LH.prettyPhone(d.t.phone)}</strong>.</p>
        <div class="banner warn" style="margin:0 0 18px">${icon('info', 'sm')}<span><strong>Demo mode: no SMS is sent.</strong> Use this code: <strong class="num" style="letter-spacing:.12em">${esc(j.otp)}</strong></span></div>
        <form data-form="joinOtp">
          <label class="field"><span class="sr">One-time code</span><input class="input otp" name="otp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required autofocus placeholder="••••••"></label>
          <button class="btn primary block lg" type="submit">Link my account</button>
          <button class="btn ghost block mt-s" type="button" data-action="joinBack">Back</button>
        </form></div></div>`;
    }
    return `<div class="auth"><div class="auth-box">${brand}
      <h1>Join ${esc(first(d.l.name))} on Landlord Hub</h1>
      <p class="lede">See your rent, pay with MTN MoMo or Airtel Money, and keep every receipt in one place.</p>
      ${card}
      <form data-form="joinPhone" class="mt">
        <label class="field"><span class="label">Confirm your phone number</span><div class="input-group"><span class="prefix">+260</span><input class="input" name="phone" type="tel" inputmode="tel" autocomplete="tel" required placeholder="96 123 4567"></div><div class="help">Use the number ${esc(first(d.l.name))} has for you, ending in ${esc(d.t.phone.slice(-3))}.</div></label>
        <button class="btn primary block lg" type="submit">Continue</button>
      </form>
      <p class="small faint" style="margin-top:22px;text-align:center">Not you? Close this page. Nothing is shared until you confirm.</p>
    </div></div>`;
  }
  // Puts the tenant (and their unit and building, if this phone doesn't have them yet) into this phone's records, marked as linked.
  function acceptInvite(d) {
    if (!byId(state.properties, d.p.id)) state.properties.push({ ...d.p });
    if (!byId(state.units, d.u.id)) state.units.push({ ...d.u });
    let t = byId(state.tenants, d.t.id);
    if (!t) { t = { ...d.t }; state.tenants.push(t); }
    t.invite = t.invite || { code: d.c, at: iso(T()) };
    t.linked = { at: iso(T()) };
    state.activity.push({ id: LH.uid('a'), date: iso(T()), who: t.name, text: `${t.name} joined on the app and is now linked to ${d.l.name}`, at: Date.now() });
    save();
    return t;
  }

  function addPropertySheet() {
    openSheet(`${sheetHead('Add a property')}
      <form data-form="addProperty" autocomplete="off">
        <label class="field"><span class="label">Property name</span><input class="input" name="name" required placeholder="e.g. Chelstone Flats" autofocus></label>
        <label class="field"><span class="label">Area and town</span><input class="input" name="area" required placeholder="e.g. Chelstone, Lusaka"></label>
        <div class="field"><span class="label">What kind of property?</span><div class="seg">
          <label><input type="radio" name="kind" value="flats" checked data-input="propKind"><span>Flats or houses</span></label>
          <label><input type="radio" name="kind" value="boarding" data-input="propKind"><span>Boarding house (bed spaces)</span></label>
        </div></div>
        <div id="flats-fields">
          <div class="btn-row">
            <label class="field" style="flex:1"><span class="label">How many flats or houses?</span><input class="input" name="count" type="number" min="1" max="60" value="4"></label>
            <label class="field" style="flex:1"><span class="label">Rent each, per month</span><div class="input-group"><span class="prefix">K</span><input class="input" name="rent" type="number" min="1" value="3500"></div></label>
          </div>
          <label class="field"><span class="label">Service charge each <span class="faint" style="font-weight:400">(optional)</span></span><div class="input-group"><span class="prefix">K</span><input class="input" name="service" type="number" min="0" value="0"></div><div class="help">For example LWSC water, ZESCO share or security.</div></label>
        </div>
        <div id="boarding-fields" hidden>
          <label class="field"><span class="label">How many houses are on this property?</span>
            <div class="due-row"><input class="input due-input num" name="houses" type="number" inputmode="numeric" min="1" max="20" value="2" data-input="houseCount"><span class="due-said">houses, each with its own bed spaces</span></div></label>
          <div class="field"><span class="label">Bed spaces in each house</span><div class="house-list" id="house-list">${houseRows(2)}</div></div>
          <div class="house-total" id="house-total">${houseTotal([6, 6])}</div>
          <div class="btn-row mt">
            <label class="field" style="flex:1"><span class="label">Rent per bed space, per term</span><div class="input-group"><span class="prefix">K</span><input class="input" name="bedRent" type="number" min="1" value="3500"></div></label>
            <label class="field" style="flex:1"><span class="label">Service charge per bed <span class="faint" style="font-weight:400">(optional)</span></span><div class="input-group"><span class="prefix">K</span><input class="input" name="bedService" type="number" min="0" value="0"></div></label>
          </div>
          <div class="help" style="margin:-6px 0 14px">Terms start in January, May and September. You can change the rent of any single bed space later.</div>
        </div>
        <button class="btn primary block lg" type="submit">Add property</button>
      </form>`);
  }
  // One row per house: its name and how many bed spaces it has.
  function houseRows(n, keep = []) {
    let out = '';
    for (let i = 0; i < n; i++) {
      const k = keep[i] || { name: `House ${i + 1}`, beds: 6 };
      out += `<div class="house-row"><span class="house-no num">${i + 1}</span>
        <label class="grow"><span class="sr">Name of house ${i + 1}</span><input class="input" name="houseName" value="${esc(k.name)}" required></label>
        <label class="house-beds"><span class="sr">Bed spaces in house ${i + 1}</span><input class="input num" name="houseBeds" type="number" inputmode="numeric" min="1" max="40" value="${k.beds}" required data-input="houseBeds"></label><span class="house-unit">beds</span></div>`;
    }
    return out;
  }
  const houseTotal = (beds) => { const t = beds.reduce((s, b) => s + (Number(b) || 0), 0); return `${beds.length} house${beds.length === 1 ? '' : 's'} · <strong>${t} bed spaces</strong> in total`; };
  // Which house a bed space belongs to: saved on new ones; older ones are read from the name ("Room 1 · Bed A").
  const houseOf = (u) => u.house || (u.label.includes(' · ') ? u.label.split(' · ')[0] : 'Bed spaces');

  /* Edit a boarding house: its name, bed spaces and rent per bed.
     Tenants are tied to bed spaces, so a house can never have fewer bed spaces than tenants living in it. */
  function editHouseSheet(pid, house) {
    const us = state.units.filter((u) => u.propertyId === pid && houseOf(u) === house);
    const taken = us.filter((u) => tenantIn(u)).length;
    openSheet(`${sheetHead(`Edit ${house}`)}
      <form data-form="editHouse" autocomplete="off"><input type="hidden" name="pid" value="${pid}"><input type="hidden" name="house" value="${esc(house)}">
        <label class="field"><span class="label">Name of the house</span><input class="input" name="name" required value="${esc(house)}"></label>
        <div class="field"><label class="label" for="beds">Bed spaces</label>
          <div class="due-row"><input class="input due-input num" id="beds" name="beds" type="number" inputmode="numeric" min="${Math.max(1, taken)}" max="40" required value="${us.length}"><span class="due-said">${taken} tenant${taken === 1 ? '' : 's'} live here now</span></div>
          <div class="help">${taken ? `Because ${taken} tenant${taken === 1 ? ' lives' : 's live'} here, this house can't have fewer than ${taken} bed space${taken === 1 ? '' : 's'}. Removing bed spaces only removes empty ones.` : 'Removing bed spaces only removes empty ones.'}</div></div>
        <label class="field"><span class="label">Rent per bed, per term</span><div class="input-group"><span class="prefix">K</span><input class="input" name="rent" type="number" min="1" required value="${us[0] ? us[0].rent : ''}"></div><div class="help">Applies to every bed space in this house.</div></label>
        <button class="btn primary block lg" type="submit">Save house</button>
      </form>`);
  }

  function addUnitSheet(pid) {
    const p = byId(state.properties, pid);
    if (p.kind === 'boarding') {
      const houses = [...new Set(state.units.filter((u) => u.propertyId === pid).map(houseOf))];
      const rent = (state.units.find((u) => u.propertyId === pid) || {}).rent || '';
      return openSheet(`${sheetHead(`Add bed spaces to ${p.name}`)}
        <form data-form="addBeds" autocomplete="off"><input type="hidden" name="pid" value="${pid}">
          <label class="field"><span class="label">Which house?</span><select class="input" name="house" data-input="pickHouse">
            ${houses.map((h) => `<option value="${esc(h)}">${esc(h)}</option>`).join('')}<option value="__new">A new house…</option></select></label>
          <label class="field" id="new-house" ${houses.length ? 'hidden' : ''}><span class="label">Name of the new house</span><input class="input" name="newHouse" placeholder="e.g. House ${houses.length + 1}" value="House ${houses.length + 1}"></label>
          <div class="btn-row">
            <label class="field" style="flex:1"><span class="label">How many bed spaces?</span><input class="input" name="beds" type="number" inputmode="numeric" min="1" max="40" value="1" required></label>
            <label class="field" style="flex:1"><span class="label">Rent per bed, per term</span><div class="input-group"><span class="prefix">K</span><input class="input" name="rent" type="number" min="1" value="${rent}" required></div></label>
          </div>
          <button class="btn primary block lg" type="submit">Add bed spaces</button>
        </form>`);
    }
    openSheet(`${sheetHead(`Add a house or flat to ${p.name}`)}
      <form data-form="addUnit" autocomplete="off"><input type="hidden" name="pid" value="${pid}">
        <label class="field"><span class="label">Name or number</span><input class="input" name="label" required placeholder="e.g. Flat 7 or House 3" autofocus></label>
        <div class="btn-row">
          <label class="field" style="flex:1"><span class="label">Rent</span><div class="input-group"><span class="prefix">K</span><input class="input" name="rent" type="number" min="1" required></div></label>
          <label class="field" style="flex:1"><span class="label">Charged per</span><select class="input" name="period"><option value="month" selected>Month</option><option value="term">Term</option></select></label>
        </div>
        <label class="field"><span class="label">Service charge <span class="faint" style="font-weight:400">(optional)</span></span><div class="input-group"><span class="prefix">K</span><input class="input" name="service" type="number" min="0" value="0"></div></label>
        <button class="btn primary block lg" type="submit">Add</button>
      </form>`);
  }

  function inviteCaretakerSheet() {
    openSheet(`${sheetHead('Invite a caretaker')}
      <form data-form="inviteCaretaker" autocomplete="off">
        <label class="field"><span class="label">Name</span><input class="input" name="name" required autofocus></label>
        <label class="field"><span class="label">Phone number</span><div class="input-group"><span class="prefix">+260</span><input class="input" name="phone" type="tel" inputmode="tel" required placeholder="97 123 4567"></div></label>
        <div class="field"><span class="label">Properties they look after</span><div class="stack">${state.properties.map((p) => `<label class="check"><input type="checkbox" name="props" value="${p.id}"><span>${esc(p.name)}</span></label>`).join('')}</div></div>
        <button class="btn primary block lg" type="submit">Send invite</button>
      </form>`);
  }

  /* Tenant pay flow: detect network → send prompt → approve on phone → confirmed */
  function paySheet() {
    const t = myTenant(), a = acct(t);
    const net = LH.network(t.phone);
    const amt = a.balance > 0 ? a.balance : a.per;
    if (net === 'Zamtel' || !net) return manualPaySheet(amt);
    openSheet(`${sheetHead('Pay rent')}
      <form data-form="pay">
        <label class="field"><span class="label">Amount</span><div class="input-group"><span class="prefix">K</span><input class="input big" name="amount" type="number" inputmode="decimal" min="1" step="0.01" value="${amt}" required></div>
          ${a.balance > 0 ? `<div class="help">You can pay part now and the rest later.</div>` : `<div class="help">Paying ahead is fine — it's taken off your next rent.</div>`}</label>
        <div class="card pad" style="background:var(--surface-2);display:flex;align-items:center;gap:12px">
          <span class="tile">${icon('wallet')}</span><div class="grow"><div style="font-weight:600">${LH.wallet(net)}</div><div class="small muted">${LH.prettyPhone(t.phone)}</div></div><span class="net ${net}">${net}</span>
        </div>
        <dl class="kv mt"><dt>Fee</dt><dd>K0</dd></dl>
        <button class="btn primary block lg mt" type="submit">Send payment request</button>
        <button class="btn ghost block mt-s" type="button" data-action="manualPay">I paid ${esc(first(state.landlord.name))} another way</button>
      </form>`);
  }
  function manualPaySheet(amt) {
    const t = myTenant(), net = LH.network(t.phone);
    const html = `${sheetHead('Tell us you paid')}
      ${net === 'Zamtel' ? `<div class="banner" style="margin:0 0 16px">${icon('info', 'sm')}<span>Zamtel Kwacha can't be paid inside the app yet. Send the money to ${esc(state.landlord.name)} on <strong>${LH.prettyPhone(state.landlord.phone)}</strong>, then fill this in.</span></div>` : ''}
      <form data-form="manualPay">
        <label class="field"><span class="label">Amount you sent</span><div class="input-group"><span class="prefix">K</span><input class="input big" name="amount" type="number" inputmode="decimal" min="1" step="0.01" value="${amt || ''}" required></div></label>
        <div class="field"><span class="label">How</span><div class="seg">${['Zamtel Kwacha', 'MTN MoMo', 'Airtel Money', 'Cash', 'Bank transfer'].map((m) => `<label><input type="radio" name="method" value="${m}" ${(net === 'Zamtel' ? m === 'Zamtel Kwacha' : m === 'Cash') ? 'checked' : ''}><span>${m}</span></label>`).join('')}</div></div>
        <label class="field"><span class="label">Transaction reference <span class="faint" style="font-weight:400">(optional)</span></span><input class="input" name="ref" placeholder="From your confirmation SMS"></label>
        <label class="field"><span class="label">Proof of payment <span class="faint" style="font-weight:400">(optional)</span></span><input class="input" type="file" name="proof" accept="image/*" style="padding:10px"></label>
        <label class="field"><span class="label">Note <span class="faint" style="font-weight:400">(optional)</span></span><input class="input" name="note" placeholder="e.g. Balance on Friday"></label>
        <button class="btn primary block lg" type="submit">Send to ${esc(first(state.landlord.name))} to confirm</button>
      </form>`;
    sheetRoot.classList.contains('open') ? setSheet(html) : openSheet(html);
  }

  function switchRoleSheet() {
    const ten = byId(state.tenants, 'T2') || activeTenants()[0];
    const care = state.caretakers[0];
    openSheet(`${sheetHead('View the app as…')}
      <div class="list">
        <button class="row" data-action="asRole" data-role="landlord"><span class="avatar">${initials(state.landlord.name)}</span><div class="grow"><div class="title">${esc(state.landlord.name)}</div><div class="meta">Landlord — everything</div></div>${session && session.role === 'landlord' ? '<span class="pill accent">Current</span>' : icon('chev', 'chev')}</button>
        ${ten ? `<button class="row" data-action="asRole" data-role="tenant" data-id="${ten.id}"><span class="avatar">${initials(ten.name)}</span><div class="grow"><div class="title">${esc(ten.name)}</div><div class="meta">Tenant — ${esc(where(ten))}</div></div>${session && session.role === 'tenant' ? '<span class="pill accent">Current</span>' : icon('chev', 'chev')}</button>` : ''}
        ${care ? `<button class="row" data-action="asRole" data-role="caretaker" data-id="${care.id}"><span class="avatar">${initials(care.name)}</span><div class="grow"><div class="title">${esc(care.name)}</div><div class="meta">Caretaker — records cash</div></div>${session && session.role === 'caretaker' ? '<span class="pill accent">Current</span>' : icon('chev', 'chev')}</button>` : ''}
      </div>`);
  }

  function privacySheet() {
    openSheet(`${sheetHead('Privacy notice')}
      <div class="prose small">Landlord Hub keeps only what is needed to manage rent.

<strong>What we collect</strong>
• Landlords: name, phone, optional email, the mobile money number rent is paid to, and an optional business name.
• Tenants: name, phone and house or room, added by your landlord.
• Caretakers: name and phone.
• Payment records and receipts.

We never ask for an NRC, passport, TPIN or any other ID number.

<strong>How we protect it</strong>
Your records are kept on your phone. When online sync is switched on, they are also stored with Google Firebase in Johannesburg, South Africa. Each person only sees what their role allows, and every change is logged.

<strong>Your rights</strong>
You can view, download or delete your data at any time from Account & privacy. If a data breach happens we report it to the Data Protection Commissioner within 24 hours.

We never sell your data or use it for adverts.</div>
      <div class="small faint mt">Draft wording — to be reviewed by a Zambian lawyer before launch.</div>`);
  }

  /* =====================================================================
     LOGIN — phone + one-time code, then a PIN for this phone
     ===================================================================== */
  function loginView() {
    const s = ui.login;
    const brand = `<div class="logo auth-logo" role="img" aria-label="Landlord Hub"></div>`;
    if (s.step === 'otp') {
      return `<div class="auth"><div class="auth-box">${brand}
        ${s.cloud
          ? `<h1>Enter your code</h1><p class="lede">We sent a 6-digit code by SMS to <strong>+260 ${esc(LH.prettyPhone(s.phone).slice(1))}</strong>. It can take a minute to arrive.</p>`
          : `<h1>Enter your code</h1><p class="lede">In the live app, a 6-digit code is sent by SMS to <strong>+260 ${esc(LH.prettyPhone(s.phone).slice(1))}</strong>.</p>
        <div class="banner warn" style="margin:0 0 18px">${icon('info', 'sm')}<span><strong>Demo mode: no SMS is sent.</strong> Use this code: <strong class="num" style="letter-spacing:.12em">${esc(s.code)}</strong></span></div>`}
        <form data-form="otp">
          <label class="field"><span class="sr">One-time code</span><input class="input otp" name="otp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required autofocus placeholder="••••••"></label>
          <label class="check" style="margin:4px 0 18px"><input type="checkbox" name="consent" required><span class="small">I agree to Landlord Hub keeping my name, phone and rent records to manage my tenancy, as set out in the <a href="#" data-action="showPrivacy">privacy notice</a>.</span></label>
          <button class="btn primary block lg" type="submit"${s.busy ? ' disabled' : ''}>${s.busy ? 'Checking…' : 'Continue'}</button>
          <button class="btn ghost block mt-s" type="button" data-action="loginBack">Use a different number</button>
        </form></div></div>`;
    }
    if (s.step === 'pin') {
      return `<div class="auth"><div class="auth-box">${brand}
        <h1>Set a PIN for this phone</h1><p class="lede">Next time, open the app with your PIN or fingerprint. No code needed.</p>
        <form data-form="pin">
          <label class="field"><span class="sr">4-digit PIN</span><input class="input otp" name="pin" type="password" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" required autofocus placeholder="••••"></label>
          <button class="btn primary block lg" type="submit">Save PIN</button>
          <button class="btn ghost block mt-s" type="button" data-action="skipPin">Use fingerprint instead</button>
        </form></div></div>`;
    }
    return `<div class="auth"><div class="auth-box">${brand}
      <h1>Rent, sorted.</h1>
      <p class="lede">Track every house, tenant and kwacha. Tenants pay with MTN MoMo or Airtel Money and get a receipt straight away.</p>
      <form data-form="phone">
        <label class="field"><span class="label">Your phone number</span><div class="input-group"><span class="prefix">+260</span><input class="input" name="phone" type="tel" inputmode="tel" autocomplete="tel" required placeholder="96 123 4567" value="${esc(s.phone ? LH.cleanPhone(s.phone).slice(1) : '')}"></div></label>
        <button class="btn primary block lg" type="submit"${s.busy ? ' disabled' : ''}>${s.busy ? 'Sending your code…' : 'Send me a code'}</button>
        ${s.busy ? '<p class="small muted mt-s" role="status">Google may ask you to pick some pictures to check you\'re not a robot. Finish that and tap <strong>Verify</strong>, and your code will be sent.</p>' : ''}
      </form>
      <div class="divider">or explore the demo as</div>
      <div class="demo-roles">
        <button class="btn" data-action="asRole" data-role="landlord">${icon('building')}Landlord</button>
        <button class="btn" data-action="asRole" data-role="tenant" data-id="T2">${icon('user')}Tenant</button>
        <button class="btn" data-action="asRole" data-role="caretaker" data-id="C1">${icon('key')}Caretaker</button>
      </div>
      <p class="small faint" style="margin-top:28px;text-align:center">Made in Zambia · Works offline</p>
    </div></div>`;
  }

  /* =====================================================================
     ACTIONS
     ===================================================================== */
  const actions = {
    closeSheet: () => closeSheet(),
    notifications: () => notificationsSheet(),
    addDeduction: () => deductionSheet(),
    removeDeduction: (d) => {
      const x = byId(state.deductions, d.id);
      if (!x) return;
      state.deductions = state.deductions.filter((v) => v.id !== d.id);
      save(); render();
      toast(`${money(x.amount)} deduction removed`, () => { state.deductions.push(x); save(); render(); toast('Deduction put back'); });
    },
    textSize: (d) => {
      try { localStorage.setItem(TS_KEY, d.v); } catch (e) {}
      applyTextSize(d.v); render();
      toast(`Text size: ${(TEXT_SIZES.find(([v]) => v === d.v) || [, ''])[1]}`);
    },
    undo: () => { const f = undoFn; undoFn = null; toastEl.classList.remove('show'); if (f) f(); },
    quickAmount: (d, el) => {
      const form = el.closest('form'), amt = form.querySelector('[name=amount]');
      amt.value = d.v;
      form.querySelectorAll('.quick .chip').forEach((c) => c.classList.toggle('active', c === el));
      document.getElementById('pay-help').textContent = payHelp(byId(state.tenants, form.querySelector('[name=tenant]').value), d.v);
    },
    // Shortcuts: glide down to a section on the home screen.
    jump: (d) => {
      const el = document.getElementById(d.to);
      if (!el) return;
      el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
    },
    recordPayment: (d) => recordPaymentSheet(d.id),
    receipt: (d) => receiptSheet(d.id),
    remind: (d) => remindSheet([d.id]),
    remindAll: () => remindSheet(activeTenants().filter((t) => { const a = acct(t); return a.status === 'overdue' || (a.status === 'partial' && a.daysLate > 0); }).map((t) => t.id)),
    tenantFilter: (d) => { ui.tenantFilter = d.f; render(); },
    addTenant: (d) => addTenantSheet(d.unit),
    addProperty: () => addPropertySheet(),
    addUnit: (d) => addUnitSheet(d.id),
    inviteCaretaker: () => inviteCaretakerSheet(),
    newNotice: () => newNoticeSheet(),
    noticeTo: (d) => newNoticeSheet({ tpl: 'late', tenant: d.id }),
    // Changing the template keeps whoever is already ticked.
    pickTemplate: (d) => { const ids = [...sheetRoot.querySelectorAll('input[name=to]:checked')].map((b) => b.value); newNoticeSheet({ tpl: d.tpl, tenant: d.tenant || null, audience: ids }); },
    // Opens or closes the "Send to" drop-down.
    togglePicks: (d, el) => {
      const box = el.closest('.recipients'), open = !box.classList.contains('open');
      box.classList.toggle('open', open);
      box.querySelector('.pick-toggle').setAttribute('aria-expanded', open);
      if (!open) box.querySelector('.pick-toggle').focus({ preventScroll: true });
    },
    // Ticks everyone in one building (on top of anyone already ticked).
    pickProperty: (d, el) => {
      const form = el.closest('form');
      form.querySelectorAll('input[name=to]').forEach((b) => { const t = byId(state.tenants, b.value); if (t && unitOf(t).propertyId === d.id) b.checked = true; });
      syncPicks(form);
    },
    viewNotice: (d) => {
      const n = byId(state.notices, d.id);
      const tenantSide = session.role === 'tenant';
      const replies = messages().filter((m) => m.about === n.id && (!tenantSide || m.tenantId === session.id)).sort((a, b) => a.at - b.at);
      const fromTenants = replies.filter((m) => m.from === 'tenant').length;
      const repliesHTML = replies.length && session.role !== 'caretaker'
        ? `<div class="section-head" style="margin-top:20px"><h2>${tenantSide ? 'Your replies' : `Replies (${fromTenants})`}</h2></div><div class="thread">${replies.map((m) => bubble(m, tenantSide ? 'tenant' : 'landlord', !tenantSide)).join('')}</div>`
        : '';
      openSheet(`${sheetHead(n.title)}<div class="small muted" style="margin:-8px 0 14px">${fmtDate(parse(n.date))}${session.role === 'landlord' ? ' · ' + esc(audienceName(n.audience)) + ' · ' + n.channels.map(channelName).join(', ') : ' · from ' + esc(state.landlord.name)}</div><div class="prose">${esc(n.body)}</div>${repliesHTML}${tenantSide ? `<button class="btn primary block mt" data-action="replyNotice" data-id="${n.id}">${icon('chat', 'sm')}Reply to ${esc(first(state.landlord.name))}</button>` : ''}`);
    },
    confirmPending: (d) => {
      const p = byId(state.payments, d.id);
      p.status = 'confirmed'; state.receiptSeq++; p.receipt = `LH-${p.date.slice(0, 4)}-${String(state.receiptSeq).padStart(4, '0')}`; p.at = Date.now();
      log(`Confirmed ${money(p.amount)} from ${byId(state.tenants, p.tenantId).name}`);
      save(); openSheet(''); paidSheet(p, `${byId(state.tenants, p.tenantId).name} · receipt sent`);
    },
    rejectPending: (d) => {
      const p = byId(state.payments, d.id); p.status = 'rejected';
      const t = byId(state.tenants, p.tenantId);
      log(`Marked ${money(p.amount)} from ${t.name} as not received`);
      save(); render(); toast(`${first(t.name)} will be asked to check the payment`);
    },
    requestStatus: (d) => {
      const r = byId(state.requests, d.id);
      openSheet(`${sheetHead('Update repair')}<div class="prose small" style="margin-bottom:14px">${esc(r.text)}</div>
        <div class="list">${[['open', 'New'], ['progress', 'In progress'], ['done', 'Done']].map(([k, l]) => `<button class="row" data-action="setRequest" data-id="${r.id}" data-s="${k}"><div class="grow"><div class="title">${l}</div></div>${r.status === k ? `<span style="color:var(--accent)">${icon('check')}</span>` : ''}</button>`).join('')}</div>
        <div class="small faint mt">${esc(byId(state.tenants, r.tenantId).name)} is told when the status changes.</div>`);
    },
    setRequest: (d) => {
      const r = byId(state.requests, d.id); r.status = d.s;
      log(`Marked "${r.text.slice(0, 40)}${r.text.length > 40 ? '…' : ''}" as ${({ open: 'new', progress: 'in progress', done: 'done' })[d.s]}`);
      save(); closeSheet(); render(); toast('Repair updated');
    },
    endTenancy: (d) => {
      const t = byId(state.tenants, d.id), a = acct(t);
      openSheet(`${sheetHead(`End ${first(t.name)}'s tenancy?`)}
        <p class="muted" style="margin-bottom:14px">${esc(unitOf(t).label)} will show as vacant. Their payment history and receipts are kept.</p>
        ${a.balance > 0 ? `<div class="banner warn" style="margin:0 0 14px">${icon('info', 'sm')}<span>${esc(first(t.name))} still owes ${money(a.balance)}. Deposit held: ${money(t.deposit || 0)}.</span></div>` : ''}
        <div class="btn-row"><button class="btn" data-action="closeSheet">Cancel</button><button class="btn primary" data-action="confirmEnd" data-id="${t.id}">End tenancy</button></div>`);
    },
    confirmEnd: (d) => {
      const t = byId(state.tenants, d.id); t.ended = iso(T());
      log(`Ended tenancy for ${t.name} (${unitOf(t).label})`);
      save(); closeSheet(); go('tenants'); toast(`${unitOf(t).label} is now vacant`);
    },
    toggleReminder: (d, el) => { state.reminders[d.k] = el.checked; save(); toast(el.checked ? 'Reminder turned on' : 'Reminder turned off'); },
    reminderChannel: (d, el) => { state.reminders.channel = el.value; save(); },
    exportCsv: () => {
      const y = String(T().getFullYear());
      const rows = [['Receipt', 'Date', 'Tenant', 'House or room', 'Property', 'Amount (K)', 'Method', 'Reference', 'Recorded by']];
      state.payments.filter((p) => p.status === 'confirmed' && p.date.startsWith(y)).sort((a, b) => (a.date < b.date ? -1 : 1)).forEach((p) => {
        const t = byId(state.tenants, p.tenantId), u = unitOf(t);
        rows.push([p.receipt, p.date, t.name, u.label, propOf(u).name, p.amount, p.method, p.ref || '', p.by === 'tenant' ? 'In app' : p.byName]);
      });
      download(`landlord-hub-payments-${y}.csv`, rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n'), 'text/csv');
      toast('Payments downloaded');
    },
    exportMine: () => {
      const w = me();
      const data = session.role === 'tenant'
        ? { you: w, unit: unitOf(w), payments: state.payments.filter((p) => p.tenantId === w.id), requests: state.requests.filter((r) => r.tenantId === w.id), notices: myNotices(w) }
        : session.role === 'caretaker' ? { you: w, recorded: state.payments.filter((p) => p.byName === w.name) } : state;
      download('landlord-hub-my-data.json', JSON.stringify(data, null, 2), 'application/json');
      toast('Your data has been downloaded');
    },
    deleteMe: () => {
      openSheet(`${sheetHead('Delete your account?')}<p class="muted">In the real app this permanently erases your profile within 30 days. Rent records that the law requires us to keep are kept for that period only.</p>
        <p class="muted mt">In this demo, it resets all sample data and logs you out.</p>
        <div class="btn-row mt"><button class="btn" data-action="closeSheet">Cancel</button><button class="btn danger" data-action="confirmReset">Delete</button></div>`);
    },
    showPrivacy: () => privacySheet(),
    switchRole: () => switchRoleSheet(),
    asRole: (d) => {
      session = { role: d.role, id: d.role === 'landlord' ? 'L1' : d.id };
      saveSession(); closeSheet(); lastRoute = ''; location.hash = '#/home'; render();
    },
    resetDemo: () => {
      openSheet(`${sheetHead('Reset demo data?')}<p class="muted">Everything you've added in this demo will be replaced with the sample properties and tenants.</p>
        <div class="btn-row mt"><button class="btn" data-action="closeSheet">Cancel</button><button class="btn primary" data-action="confirmReset" data-keep="1">Reset</button></div>`);
    },
    confirmReset: (d) => {
      state = LH.seed(T()); save();
      if (!d.keep) { session = null; saveSession(); ui.login = { step: 'phone', phone: '' }; }
      closeSheet(); render(); toast('Demo data reset');
    },
    logout: () => { if (session && session.uid && window.LHCloud && window.LHCloud.ready) window.LHCloud.signOut(); session = null; saveSession(); ui.login = { step: 'phone', phone: '' }; location.hash = ''; render(); },
    loginBack: () => { ui.login.step = 'phone'; render(); },
    skipPin: () => finishLogin(),
    pay: () => paySheet(),
    manualPay: () => { const t = myTenant(), a = acct(t); manualPaySheet(a.balance > 0 ? a.balance : a.per); },
    replyRent: () => messageSheet(session.id, 'rent'),
    replyNotice: (d) => messageSheet(session.id, d.id),
    writeLandlord: () => messageSheet(session.id, acct(myTenant()).balance > 0 ? 'rent' : null),
    messageTenant: (d) => messageSheet(d.id, null),
    conversation: (d) => {
      const t = byId(state.tenants, d.id); if (!t) return;
      const viewer = session.role === 'tenant' ? 'tenant' : 'landlord';
      if (viewer === 'tenant' && t.id !== session.id) return;
      let changed = false;
      messages().forEach((m) => { if (m.tenantId === t.id && m.from !== viewer && !m.read) { m.read = true; changed = true; } });
      if (changed) { save(); render(); }
      openSheet(`${sheetHead(viewer === 'tenant' ? `Messages with ${esc(first(state.landlord.name))}` : `Messages with ${esc(first(t.name))}`)}${threadHTML(t.id, viewer)}
        <button class="btn primary block mt" data-action="${viewer === 'tenant' ? 'writeLandlord' : 'messageTenant'}" data-id="${t.id}">${icon('chat', 'sm')}Write a message</button>`);
    },
    pickPromise: (d, el) => {
      const form = el.closest('form'); if (!form) return;
      const t = byId(state.tenants, form.tenant.value), when = parse(d.date);
      form.promise.value = d.date;
      if (form.promiseDate) form.promiseDate.value = d.date;
      form.text.value = `I'll pay ${money(acct(t).balance)} on ${LH.fmtLong(when)}.`;
      form.querySelectorAll('[data-action="pickPromise"]').forEach((c) => c.classList.toggle('active', c === el));
    },
    quickText: (d, el) => {
      const form = el.closest('form'); if (!form) return;
      if (form.promise.value && !/pay/i.test(d.text)) { form.promise.value = ''; if (form.promiseDate) form.promiseDate.value = ''; form.querySelectorAll('[data-action="pickPromise"]').forEach((c) => c.classList.remove('active')); }
      form.text.value = d.text;
      form.text.focus();
      form.text.setSelectionRange(form.text.value.length, form.text.value.length);
    },
    messageWhatsApp: (d, el) => {
      const form = el.closest('form');
      const text = (form && form.text.value.trim()) || 'Hello, ';
      window.open(LH.waLink(d.phone, text), '_blank', 'noopener');
    },
    shareReference: (d) => { const t = byId(state.tenants, d.id); if (t) window.open(LH.waLink('', referenceText(t)), '_blank', 'noopener'); },
    copyReference: (d) => {
      const t = byId(state.tenants, d.id); if (!t) return;
      const text = referenceText(t);
      (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => toast('Rent reference copied'), () => toast("Couldn't copy. Use Share on WhatsApp instead."));
    },
    newRequest: () => {
      openSheet(`${sheetHead('Report a repair')}
        <form data-form="newRequest">
          <div class="field"><span class="label">What kind?</span><div class="seg">${['Plumbing', 'Electrical', 'Security', 'Doors & windows', 'Other'].map((c, i) => `<label><input type="radio" name="category" value="${c}" ${i === 0 ? 'checked' : ''}><span>${c}</span></label>`).join('')}</div></div>
          <label class="field"><span class="label">What's wrong?</span><textarea class="input" name="text" required style="min-height:110px" placeholder="e.g. The bathroom tap won't stop dripping"></textarea></label>
          <label class="field"><span class="label">Photo <span class="faint" style="font-weight:400">(optional)</span></span><input class="input" type="file" name="photo" accept="image/*" capture="environment" style="padding:10px"></label>
          <button class="btn primary block lg" type="submit">Send to ${esc(first(state.landlord.name))}</button>
        </form>`);
    },
    print: () => window.print(),
    editTenant: (d) => tenantFormSheet(byId(state.tenants, d.id)),
    editHouse: (d) => editHouseSheet(d.pid, d.house),
    smsPay: () => smsSheet(),
    smsAutoEnable: async () => {
      if (!window.LHNative) return;
      // Opens the phone's Notification access screen; nativeSmsSync finishes when they come back.
      smsWantsOn = true;
      const r = await window.LHNative.enable().catch(() => ({ granted: false }));
      if (r.granted) nativeSmsSync();
    },
    smsAutoOff: () => { lsSet(SMS_AUTO, null); render(); toast('Automatic payments turned off'); },
    smsReviewWaiting: () => { const w = smsWaiting(); if (w.length) { openSheet(''); smsResults(w, false); } },
    smsClearWaiting: () => { state.smsWaiting = []; save(); render(); toast('List cleared'); },
    smsAgain: () => smsSheet(),
    addLine: (d, el) => {
      const list = el.closest('.field').querySelector('.lines');
      list.insertAdjacentHTML('beforeend', lineRow());
      list.lastElementChild.querySelector('input').focus();
    },
    removeLine: (d, el) => el.closest('.line-row').remove(),
    invite: (d) => inviteSheet(d.id),
    inviteSent: (d) => { const t = byId(state.tenants, d.id); if (t) { t.invite.sentAt = iso(T()); log(`Sent ${t.name} a link to join on the app`); save(); } },
    copyInvite: (d) => {
      const el = document.querySelector('.invite-msg'), text = d.msg || el.textContent;
      const done = () => toast('Message copied. Paste it in a chat to your tenant.');
      const fallback = () => { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast('Message selected. Press copy on your phone.'); };
      try { navigator.clipboard.writeText(text).then(done, fallback); } catch (e) { fallback(); }
    },
    setEvery: (d, el) => {
      const inp = el.closest('form').querySelector('[name=every]');
      inp.value = d.v; inputs.every(inp);
    },
    setDueDay: (d, el) => {
      const form = el.closest('form'), inp = form.querySelector('[name=dueDay]');
      inp.value = d.v; inputs.dueDay(inp);
    },
    joinBack: () => { if (ui.join) { ui.join.step = 'phone'; render(); } },
    retryJoin: (d) => { delete shortJoins[d.code]; render(); },
  };

  function log(text) {
    state.activity.push({ id: LH.uid('a'), date: iso(T()), who: me().name, text, at: Date.now() });
  }

  function finishLogin() {
    const ph = LH.cleanPhone(ui.login.phone);
    const t = state.tenants.find((x) => x.phone === ph && !x.ended);
    const c = state.caretakers.find((x) => x.phone === ph);
    session = t ? { role: 'tenant', id: t.id } : c ? { role: 'caretaker', id: c.id } : { role: 'landlord', id: 'L1' };
    if (ui.login.uid) { session.uid = ui.login.uid; session.phone = ph; } // signed in online (Firebase)
    saveSession(); ui.login = { step: 'phone', phone: '' }; location.hash = '#/home'; render();
    toast(`Signed in as ${me().name.split(' ')[0]}`);
  }

  /* ---------- Forms ---------- */
  const forms = {
    phone: async (f) => {
      const ph = LH.cleanPhone(f.get('phone'));
      if (ph.length !== 10) return toast('Enter a 9-digit Zambian number, like 96 123 4567');
      if (ui.login.busy) return;
      // Without Firebase (it failed to load), fall back to the on-screen demo code.
      if (!window.LHCloud || !window.LHCloud.ready) {
        ui.login = { step: 'otp', phone: ph, code: String(Math.floor(100000 + Math.random() * 900000)) }; return render();
      }
      ui.login = { step: 'phone', phone: ph, busy: true }; render();
      try {
        await window.LHCloud.sendCode(ph);
        ui.login = { step: 'otp', phone: ph, cloud: true }; render();
      } catch (e) {
        ui.login = { step: 'phone', phone: ph }; render(); toast(e.message);
      }
    },
    otp: async (f) => {
      const code = String(f.get('otp')).trim();
      if (!ui.login.cloud) {
        if (code !== ui.login.code) return toast("That code doesn't match. Check it and try again.");
        ui.login.step = 'pin'; return render();
      }
      if (ui.login.busy) return;
      ui.login.busy = true; render();
      try {
        const u = await window.LHCloud.confirmCode(code);
        ui.login = { ...ui.login, busy: false, step: 'pin', uid: u.uid }; render();
      } catch (e) {
        ui.login.busy = false; render(); toast(e.message);
      }
    },
    pin: () => finishLogin(),
    sendMessage: (f) => {
      if (session.role === 'caretaker') return;
      const tenantSide = session.role === 'tenant';
      const t = byId(state.tenants, f.get('tenant')); if (!t) return;
      if (tenantSide && t.id !== session.id) return;
      const text = String(f.get('text') || '').trim();
      if (!text) return toast('Write a message first');
      if (text.length > 500) return toast('Keep it under 500 characters');
      let promise = String(f.get('promise') || '');
      if (!tenantSide || !/^\d{4}-\d{2}-\d{2}$/.test(promise) || promise <= iso(T())) promise = null;
      const about = f.get('about') || null;
      messages().push({ id: LH.uid('m'), tenantId: t.id, propertyId: unitOf(t).propertyId, from: tenantSide ? 'tenant' : 'landlord', about, promise, text, date: iso(T()), at: Date.now(), read: false });
      if (tenantSide) log(promise ? `${t.name} said they'll pay on ${fmtDay(parse(promise))}` : `${t.name} sent ${first(state.landlord.name)} a message`);
      save(); closeSheet(); render();
      toast(`Sent to ${tenantSide ? first(state.landlord.name) : first(t.name)}`);
    },
    recordPayment: (f) => {
      const t = byId(state.tenants, f.get('tenant'));
      const amount = Math.round(Number(f.get('amount')) * 100) / 100;
      if (!t || !(amount > 0)) return toast('Choose a tenant and an amount');
      const isCare = session.role === 'caretaker';
      const p = addPayment({ tenantId: t.id, amount, date: f.get('date') || iso(T()), method: f.get('method') || 'Cash', ref: (f.get('ref') || '').trim(), by: isCare ? 'caretaker' : 'landlord', byName: me().name, status: 'confirmed' });
      paidSheet(p, isCare ? `Receipt sent to ${first(t.name)} and ${first(state.landlord.name)}` : `${t.name} · ${p.method} · receipt sent`);
    },
    pay: (f) => {
      const t = myTenant(), net = LH.network(t.phone);
      const amount = Math.round(Number(f.get('amount')) * 100) / 100;
      if (!(amount > 0)) return toast('Enter an amount');
      setSheet(`<div class="waiting"><div class="pulse">${icon('phone', 'lg')}</div>
        <h2 style="font:650 20px/1.25 var(--font-display)">Check your phone</h2>
        <p class="muted mt-s">Approve <strong>${money(amount)}</strong> with your ${LH.wallet(net)} PIN.<br>The prompt was sent to ${LH.prettyPhone(t.phone)}.</p>
        <div class="small faint mt">Waiting for ${net}…</div>
        <button class="btn ghost block mt" data-action="closeSheet">Cancel</button></div>`);
      const pending = setTimeout(() => {
        if (!sheetRoot.querySelector('.waiting')) return; // cancelled
        const p = addPayment({ tenantId: t.id, amount, date: iso(T()), method: LH.wallet(net), ref: (net === 'MTN' ? 'MP' : 'CI') + Math.floor(1e9 + Math.random() * 9e9), by: 'tenant', byName: t.name, status: 'confirmed' });
        paidSheet(p, `${LH.wallet(net)} · receipt sent to you and ${first(state.landlord.name)}`);
      }, 3200);
      sheetRoot.addEventListener('click', function once(e) { if (e.target.closest('[data-action=closeSheet]')) { clearTimeout(pending); sheetRoot.removeEventListener('click', once); } });
    },
    manualPay: (f) => {
      const t = myTenant();
      const amount = Math.round(Number(f.get('amount')) * 100) / 100;
      if (!(amount > 0)) return toast('Enter the amount you sent');
      const file = f.get('proof');
      state.payments.push({ id: LH.uid('p'), tenantId: t.id, amount, date: iso(T()), method: f.get('method'), ref: (f.get('ref') || '').trim(), by: 'tenant', byName: t.name, status: 'pending', proof: file && file.name ? file.name : '', note: (f.get('note') || '').trim(), at: Date.now() });
      save(); closeSheet(); render();
      toast(`Sent. ${first(state.landlord.name)} will confirm it.`);
    },
    sendNotice: (f) => {
      const title = f.get('title').trim(), body = f.get('body').trim();
      if (/\[[^\]]+\]/.test(title + body)) return toast('Fill in the [bracketed] parts first');
      const ch = f.getAll('ch');
      if (!ch.length) return toast('Choose at least one way to send');
      const ids = f.getAll('to');
      if (!ids.length) return toast('Tick at least one tenant to send to');
      // Store it in the simplest form: everyone, one building, one tenant, or a list.
      const everyone = activeTenants().map((t) => t.id);
      const prop = state.properties.find((p) => { const inP = everyone.filter((id) => unitOf(byId(state.tenants, id)).propertyId === p.id); return inP.length && inP.length === ids.length && inP.every((id) => ids.includes(id)); });
      const aud = ids.length === everyone.length ? 'all' : prop ? prop.id : ids.length === 1 ? ids[0] : ids;
      const n = { id: LH.uid('n'), title, body, audience: aud, channels: ch, date: iso(T()) };
      state.notices.push(n);
      const count = audienceTenants(aud).length;
      log(`Sent "${title}" to ${audienceName(aud)}`);
      save(); closeSheet(); go('notices'); render();
      toast(`Sent to ${count} tenant${count === 1 ? '' : 's'}`);
    },
    addTenant: (f) => {
      const phone = LH.cleanPhone(f.get('phone'));
      if (phone.length !== 10) return toast('Check the phone number');
      const dueDay = Math.round(Number(f.get('dueDay')));
      if (!(dueDay >= 1 && dueDay <= 31)) return toast('Rent due day must be from 1 to 31');
      const every = Math.round(Number(f.get('every')) || 1);
      if (!(every >= 1 && every <= 24)) return toast('Payment period must be from 1 to 24 months');
      const unitId = resolvePlace(f.get('unit'));
      if (!unitId) return toast('That house is full. Choose another house or add bed spaces.');
      const t = { id: LH.uid('t'), name: f.get('name').trim(), phone, lines: readLines(f, phone), unitId, since: f.get('since'), dueDay, every, deposit: Number(f.get('deposit')) || 0, lang: f.get('lang') };
      state.tenants.push(t);
      inviteData(t); // creates their personal invite
      log(`Added ${t.name} to ${unitOf(t).label}, ${propOf(unitOf(t)).name}`);
      save(); closeSheet(); go('tenant/' + t.id);
      setTimeout(() => inviteSheet(t.id, true), 450); // after the page has slid in
    },
    editTenant: (f) => {
      const t = byId(state.tenants, f.get('id')); if (!t) return;
      const phone = LH.cleanPhone(f.get('phone'));
      if (phone.length !== 10) return toast('Check the phone number');
      const dueDay = Math.round(Number(f.get('dueDay')));
      if (!(dueDay >= 1 && dueDay <= 31)) return toast('Rent due day must be from 1 to 31');
      const unitId = resolvePlace(f.get('unit'), t);
      if (!unitId) return toast('That house is full. Choose another house or add bed spaces.');
      const moved = t.unitId !== unitId;
      const every = Math.round(Number(f.get('every')) || 1);
      if (!(every >= 1 && every <= 24)) return toast('Payment period must be from 1 to 24 months');
      Object.assign(t, { name: f.get('name').trim(), phone, lines: readLines(f, phone), unitId, since: f.get('since'), dueDay, every, deposit: Number(f.get('deposit')) || 0, lang: f.get('lang') });
      log(`Updated ${t.name}'s details${moved ? `, now in ${unitOf(t).label}` : ''}`);
      save(); closeSheet(); render(); toast('Changes saved');
    },
    joinPhone: (f) => {
      const j = ui.join; if (!j) return;
      const phone = LH.cleanPhone(f.get('phone'));
      if (phone !== LH.cleanPhone(j.data.t.phone)) return toast(`That number doesn't match the invite. Use the one ending in ${j.data.t.phone.slice(-3)}.`);
      j.step = 'otp'; j.otp = String(Math.floor(100000 + Math.random() * 900000)); render();
    },
    joinOtp: (f) => {
      const j = ui.join; if (!j) return;
      if (String(f.get('otp')).trim() !== j.otp) return toast('That code is not right. Check it and try again.');
      const t = acceptInvite(j.data);
      ui.join = null;
      session = { role: 'tenant', id: t.id }; saveSession();
      lastRoute = ''; location.hash = '#/home'; render();
      toast(`You're linked to ${first(j.data.l.name)}`);
    },
    deduction: (f) => {
      const amount = Math.round(Number(f.get('amount')) * 100) / 100;
      if (!(amount > 0)) return toast('Enter an amount');
      const x = { id: LH.uid('d'), amount, reason: f.get('reason'), propertyId: f.get('property') || '', date: f.get('date') || iso(T()), note: (f.get('note') || '').trim() };
      state.deductions.push(x);
      log(`Recorded a ${money(amount)} deduction (${x.reason})`);
      save(); closeSheet(); go('collections/' + x.date.slice(0, 4)); render(); toast(`${money(amount)} deduction saved`);
    },
    addProperty: (f) => {
      const p = { id: LH.uid('P'), name: f.get('name').trim(), area: f.get('area').trim(), kind: f.get('kind') };
      if (p.kind === 'boarding') {
        // Houses, each with its own bed spaces: "House 1 · Bed 1", "House 1 · Bed 2" …
        const names = f.getAll('houseName').map((s) => s.trim()), beds = f.getAll('houseBeds').map((b) => Math.round(Number(b)));
        const rent = Number(f.get('bedRent'));
        if (!names.length || names.some((s) => !s)) return toast('Give each house a name');
        if (beds.some((b) => !(b >= 1 && b <= 40))) return toast('Each house needs 1 to 40 bed spaces');
        if (!(rent > 0)) return toast('Enter the rent per bed space');
        state.properties.push(p);
        names.forEach((h, i) => { for (let b = 1; b <= beds[i]; b++) state.units.push({ id: LH.uid('U'), propertyId: p.id, house: h, label: `${h} · Bed ${b}`, rent, service: Number(f.get('bedService')) || 0, serviceName: 'Service charge', period: 'term' }); });
        const total = beds.reduce((s, b) => s + b, 0);
        log(`Added ${p.name}: ${names.length} house${names.length === 1 ? '' : 's'} with ${total} bed spaces`);
        save(); closeSheet(); go('property/' + p.id); toast(`${p.name} added with ${total} bed spaces`);
        return;
      }
      const n = Math.min(60, Math.max(1, Number(f.get('count')) || 1)), rent = Number(f.get('rent'));
      if (!(rent > 0)) return toast('Enter the rent for each one');
      state.properties.push(p);
      for (let i = 1; i <= n; i++) {
        state.units.push({ id: LH.uid('U'), propertyId: p.id, label: `House ${i}`, rent, service: Number(f.get('service')) || 0, serviceName: 'Service charge', period: 'month' });
      }
      log(`Added ${p.name} with ${n} house${n === 1 ? '' : 's'}`);
      save(); closeSheet(); go('property/' + p.id); toast(`${p.name} added`);
    },
    readSms: (f) => smsResults(LH.parseMoneySms(f.get('sms'))),
    // A message from an unknown number: record it for the chosen tenant and remember the number.
    smsAssign: (f, form) => {
      const x = (ui.smsAsk || [])[Number(f.get('i'))], t = byId(state.tenants, f.get('tenant'));
      if (!x || !t) return toast('Choose who paid');
      const m = x.m;
      if (alreadyRecorded(m)) return toast('That payment is already recorded');
      const p = addPayment({ tenantId: t.id, amount: m.amount, date: m.date && m.date <= iso(T()) ? m.date : iso(T()), method: LH.wallet(m.net || LH.network(state.landlord.phone)), ref: m.ref || '', by: 'landlord', byName: me().name, status: 'confirmed', smsKey: smsKey(m), fromSms: true });
      if (m.phone && m.phone !== LH.cleanPhone(t.phone) && !(t.lines || []).includes(m.phone)) t.lines = [...(t.lines || []), m.phone];
      log(`Recorded ${money(m.amount)} from ${t.name} using a mobile money message${m.phone ? ` (line ${LH.prettyPhone(m.phone)} saved)` : ''}`);
      save(); render();
      form.outerHTML = `<div class="card pad sms-ask done"><span class="tile">${icon('check')}</span><div><div class="title" style="font-weight:700">${money(m.amount)} recorded for ${esc(t.name)}</div><div class="meta">Receipt ${esc(p.receipt)}${m.phone ? ` · ${LH.prettyPhone(m.phone)} saved to their lines` : ''}</div></div></div>`;
      toast(`${money(m.amount)} recorded for ${first(t.name)}`);
    },
    editHouse: (f) => {
      const pid = f.get('pid'), old = f.get('house'), name = f.get('name').trim();
      const want = Math.round(Number(f.get('beds'))), rent = Number(f.get('rent'));
      const us = state.units.filter((u) => u.propertyId === pid && houseOf(u) === old);
      const taken = us.filter((u) => tenantIn(u)).length;
      if (!name) return toast('Give the house a name');
      if (name !== old && state.units.some((u) => u.propertyId === pid && houseOf(u) === name)) return toast(`There is already a house called ${name}`);
      if (!(want >= 1 && want <= 40)) return toast('A house needs 1 to 40 bed spaces');
      if (want < taken) return toast(`${taken} tenants live here, so it needs at least ${taken} bed spaces`);
      if (!(rent > 0)) return toast('Enter the rent per bed space');
      const bedNo = (u) => Number((u.label.match(/(\d+)\s*$/) || [])[1]) || 0;
      // Rename and set the rent on every bed space in the house.
      us.forEach((u) => { u.house = name; u.label = u.label.includes(' · ') ? `${name} · ${u.label.split(' · ').slice(1).join(' · ')}` : `${name} · ${u.label}`; u.rent = rent; });
      if (want > us.length) {
        let next = Math.max(us.length, ...us.map(bedNo));
        for (let i = us.length; i < want; i++) state.units.push({ id: LH.uid('U'), propertyId: pid, house: name, label: `${name} · Bed ${++next}`, rent, service: us[0] ? us[0].service || 0 : 0, serviceName: 'Service charge', period: 'term' });
      } else if (want < us.length) {
        // Remove empty bed spaces only, highest numbers first.
        const drop = us.filter((u) => !tenantIn(u)).sort((a, b) => bedNo(b) - bedNo(a)).slice(0, us.length - want).map((u) => u.id);
        state.units = state.units.filter((u) => !drop.includes(u.id));
      }
      log(`Updated ${name}: ${want} bed spaces at ${money(rent)} per term`);
      save(); closeSheet(); render(); toast(`${name} saved · ${want} bed spaces`);
    },
    addBeds: (f) => {
      const pid = f.get('pid'), pick = f.get('house');
      const house = (pick === '__new' ? f.get('newHouse') : pick || '').trim();
      const n = Math.round(Number(f.get('beds'))), rent = Number(f.get('rent'));
      if (!house) return toast('Give the house a name');
      if (!(n >= 1 && n <= 40)) return toast('Add 1 to 40 bed spaces');
      if (!(rent > 0)) return toast('Enter the rent per bed space');
      const have = state.units.filter((u) => u.propertyId === pid && houseOf(u) === house).length;
      for (let b = 1; b <= n; b++) state.units.push({ id: LH.uid('U'), propertyId: pid, house, label: `${house} · Bed ${have + b}`, rent, service: 0, serviceName: 'Service charge', period: 'term' });
      log(`Added ${n} bed space${n === 1 ? '' : 's'} to ${house}`);
      save(); closeSheet(); render(); toast(`${n} bed space${n === 1 ? '' : 's'} added to ${house}`);
    },
    addUnit: (f) => {
      const u = { id: LH.uid('U'), propertyId: f.get('pid'), label: f.get('label').trim(), rent: Number(f.get('rent')), service: Number(f.get('service')) || 0, serviceName: 'Service charge', period: f.get('period') };
      state.units.push(u); save(); closeSheet(); render(); toast(`${u.label} added`);
    },
    inviteCaretaker: (f) => {
      const phone = LH.cleanPhone(f.get('phone'));
      const props = f.getAll('props');
      if (phone.length !== 10) return toast('Check the phone number');
      if (!props.length) return toast('Choose at least one property');
      const c = { id: LH.uid('C'), name: f.get('name').trim(), phone, propertyIds: props, since: iso(T()) };
      state.caretakers.push(c); log(`Invited ${c.name} as caretaker`);
      save(); closeSheet(); render(); toast(`Invite sent to ${LH.prettyPhone(phone)}`);
    },
    newRequest: (f) => {
      state.requests.push({ id: LH.uid('r'), tenantId: session.id, category: f.get('category'), text: f.get('text').trim(), status: 'open', date: iso(T()) });
      save(); closeSheet(); render(); toast(`Sent to ${first(state.landlord.name)}`);
    },
  };

  /* ---------- Live inputs ---------- */
  const inputs = {
    promiseDate: (el) => {
      const form = el.closest('form'); if (!form || !el.value) return;
      const t = byId(state.tenants, form.tenant.value);
      form.promise.value = el.value;
      form.text.value = `I'll pay ${money(acct(t).balance)} on ${LH.fmtLong(parse(el.value))}.`;
      form.querySelectorAll('[data-action="pickPromise"]').forEach((c) => c.classList.remove('active'));
    },
    pickAll: (el) => { const form = el.closest('form'); form.querySelectorAll('input[name=to]').forEach((b) => { b.checked = el.checked; }); syncPicks(form); },
    pickOne: (el) => syncPicks(el.closest('form')),
    // Add property: show the fields for the kind chosen.
    propKind: (el) => {
      const form = el.closest('form'), boarding = form.querySelector('[name=kind]:checked').value === 'boarding';
      form.querySelector('#flats-fields').hidden = boarding; form.querySelector('#boarding-fields').hidden = !boarding;
    },
    // Number of houses changed: add or remove rows, keeping what was already typed.
    houseCount: (el) => {
      const n = Math.round(Number(el.value)); if (!(n >= 1 && n <= 20)) return;
      const form = el.closest('form'), list = form.querySelector('#house-list');
      const keep = [...list.querySelectorAll('.house-row')].map((r) => ({ name: r.querySelector('[name=houseName]').value, beds: r.querySelector('[name=houseBeds]').value }));
      list.innerHTML = houseRows(n, keep);
      inputs.houseBeds(el);
    },
    houseBeds: (el) => {
      const form = el.closest('form');
      form.querySelector('#house-total').innerHTML = houseTotal([...form.querySelectorAll('[name=houseBeds]')].map((b) => b.value));
    },
    pickHouse: (el) => { el.closest('form').querySelector('#new-house').hidden = el.value !== '__new'; },
    every: (el) => {
      const form = el.closest('form');
      form.querySelector('#every-said').textContent = everySaid(el.value, form.querySelector('[name=unit]').value);
      form.querySelectorAll('[data-action=setEvery]').forEach((c) => c.classList.toggle('active', c.dataset.v === String(Number(el.value))));
    },
    tenantUnit: (el) => {
      const form = el.closest('form'), u = placeUnit(el.value), term = u && u.period === 'term';
      form.querySelector('#every-field').hidden = term; form.querySelector('#term-note').hidden = !term;
      const idEl = form.querySelector('[name=id]'), t = idEl ? byId(state.tenants, idEl.value) : null;
      form.querySelector('#place-help').textContent = String(el.value).startsWith('h:') ? placeHelp(el.value, t) : '';
      inputs.every(form.querySelector('[name=every]'));
    },
    dueDay: (el) => {
      const form = el.closest('form');
      form.querySelector('#due-said').textContent = dueSaid(el.value);
      form.querySelectorAll('[data-action=setDueDay]').forEach((c) => c.classList.toggle('active', c.dataset.v === String(Number(el.value))));
    },
    tenantSearch: (el) => {
      ui.tenantQuery = el.value;
      const all = activeTenants().map((t) => ({ t, a: acct(t) }));
      const f = ui.tenantFilter;
      const list = f === 'all' ? all : all.filter((s) => f === 'late' ? (s.a.status === 'overdue' || (s.a.status === 'partial' && s.a.daysLate > 0)) : s.a.status === f);
      document.getElementById('tenant-list').innerHTML = tenantListHTML(list);
    },
    payTenant: (el) => {
      const t = byId(state.tenants, el.value);
      const amt = el.form.querySelector('[name=amount]');
      if (t) { const a = acct(t); amt.value = a.balance > 0 ? a.balance : a.per; }
      document.getElementById('pay-quick').innerHTML = quickAmounts(t, amt.value);
      document.getElementById('pay-help').textContent = payHelp(t, amt.value);
    },
    payAmount: (el) => {
      const t = byId(state.tenants, el.form.querySelector('[name=tenant]').value);
      el.form.querySelectorAll('.quick .chip').forEach((c) => c.classList.toggle('active', Number(c.dataset.v) === Number(el.value)));
      document.getElementById('pay-help').textContent = payHelp(t, el.value);
    },
    phoneNet: (el) => {
      const n = LH.network(el.value);
      const h = document.getElementById('net-help');
      h.innerHTML = n ? `<span class="net ${n}">${n}</span> — ${n === 'Zamtel' ? 'they can pay you directly and you confirm it' : 'they can pay in the app with ' + LH.wallet(n)}` : "We'll send them an invite by SMS. They confirm with a one-time code.";
    },
  };

  /* ---------- Event wiring ---------- */
  document.addEventListener('click', (e) => {
    const after = e.target.closest('[data-after]');
    if (after && after.dataset.after === 'reminded') {
      state.remindedAt[after.dataset.id] = iso(T());
      const t = byId(state.tenants, after.dataset.id);
      log(`Sent a rent reminder to ${t.name}`); save();
      after.textContent = 'Sent'; after.classList.remove('primary');
      return;
    }
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const fn = actions[el.dataset.action];
    if (!fn) return;
    if (el.type !== 'checkbox' && el.type !== 'radio' && !(el.tagName === 'A' && el.getAttribute('href') && el.getAttribute('href') !== '#')) e.preventDefault();
    fn(el.dataset, el, e);
  });
  document.addEventListener('submit', (e) => {
    const f = e.target.closest('form[data-form]');
    if (!f) return;
    e.preventDefault();
    const fn = forms[f.dataset.form];
    if (fn) fn(new FormData(f), f);
  });
  document.addEventListener('input', (e) => {
    const el = e.target.closest('[data-input]');
    if (el && inputs[el.dataset.input]) inputs[el.dataset.input](el, e);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheetRoot.classList.contains('open')) closeSheet(); });
  window.addEventListener('hashchange', () => { if (sheetRoot.classList.contains('open')) closeSheet(); render(); });
  window.addEventListener('online', render);
  window.addEventListener('offline', render);

  load();
  render();

  // Android app: record any MoMo / Airtel payments that came in while the app was closed.
  setTimeout(() => nativeSmsSync(), 600);

  // Shared from another app (Android: Share → Landlord Hub on a MoMo/Airtel SMS): open the reader with it.
  try {
    const q = new URLSearchParams(location.search), shared = [q.get('title'), q.get('text')].filter(Boolean).join('\n');
    if (shared) {
      history.replaceState(null, '', location.pathname + (location.hash || '#/home'));
      if (session && session.role === 'landlord') setTimeout(() => smsSheet(shared), 300);
      else toast('Sign in as the landlord to record this payment');
    }
  } catch (e) {}

  // Offline support where the browser allows it (not inside sandboxed hosts).
  try {
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      window.addEventListener('load', () => { try { navigator.serviceWorker.register('sw.js').catch(() => {}); } catch (e) {} });
    }
  } catch (e) {}
})();
