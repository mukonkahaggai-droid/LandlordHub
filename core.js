/* Landlord Hub — core: dates, money, phone networks, ledger maths, messages, demo data.
   No framework, no build step. Everything here is pure and testable. */
(function () {
  const LH = (window.LH = {});

  /* ---------- Dates ---------- */
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  LH.MONTHS = MONTHS;
  LH.MONTHS_LONG = MONTHS_LONG;
  LH.iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  LH.parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  LH.today = () => { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()); };
  LH.addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  LH.fmtDate = (d) => `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  LH.fmtDay = (d) => `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  LH.fmtLong = (d) => `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS_LONG[d.getMonth()]}`;
  LH.monthLabel = (d) => `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  LH.termLabel = (d) => `Term ${Math.floor(d.getMonth() / 4) + 1}, ${d.getFullYear()}`;
  LH.daysBetween = (a, b) => Math.round((b - a) / 864e5);

  /* ---------- Money ---------- */
  LH.money = (n) => {
    const v = Math.round((n || 0) * 100) / 100;
    const frac = Math.abs(v % 1) > 0.001;
    const s = Math.abs(v).toLocaleString('en-GB', { minimumFractionDigits: frac ? 2 : 0, maximumFractionDigits: 2 });
    return (v < 0 ? '−' : '') + 'K' + s;
  };

  /* ---------- Phones & networks ---------- */
  LH.cleanPhone = (p) => {
    let d = String(p || '').replace(/\D/g, '');
    if (d.startsWith('260')) d = '0' + d.slice(3);
    if (d.length === 9) d = '0' + d;
    return d;
  };
  LH.network = (p) => {
    const pre = LH.cleanPhone(p).slice(0, 3);
    if (['096', '076'].includes(pre)) return 'MTN';
    if (['097', '077', '057'].includes(pre)) return 'Airtel';
    if (['095', '075'].includes(pre)) return 'Zamtel';
    return null;
  };
  LH.wallet = (net) => ({ MTN: 'MTN MoMo', Airtel: 'Airtel Money', Zamtel: 'Zamtel Kwacha' }[net] || 'Mobile money');
  // Only digits ever come out, so it is safe to put straight into the page.
  LH.prettyPhone = (p) => { const d = LH.cleanPhone(p); return d.length === 10 ? `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` : d; };
  LH.intl = (p) => '260' + LH.cleanPhone(p).slice(1);
  LH.waLink = (p, text) => (p ? `https://wa.me/${LH.intl(p)}` : 'https://wa.me/') + `?text=${encodeURIComponent(text)}`;
  LH.smsLink = (p, text) => `sms:+${LH.intl(p)}?body=${encodeURIComponent(text)}`;

  LH.uid = (prefix) => prefix + Date.now().toString(36).slice(-4) + Math.random().toString(36).slice(2, 6);

  /* ---------- Ledger ----------
     Monthly units are charged every month on the tenant's due day.
     Boarding beds are charged per term (terms start January, May and September).
     Payments are applied oldest charge first. */
  // How many months one payment covers: 4 for boarding terms, otherwise the tenant's own choice
  // (1 = every month, 3 = every 3 months, 12 = once a year …).
  LH.every = (t, u) => (u.period === 'term' ? 4 : Math.max(1, Math.min(24, Math.round(Number(t.every) || 1))));
  LH.periods = function (t, u, today) {
    const out = [];
    const s = LH.parse(t.since);
    let y = s.getFullYear(), m = s.getMonth();
    const term = u.period === 'term';
    const every = LH.every(t, u);
    if (term) m -= m % 4;
    const end = t.ended && LH.parse(t.ended) < today ? LH.parse(t.ended) : today;
    const ey = end.getFullYear(), em = end.getMonth();
    let i = 0;
    while (y < ey || (y === ey && m <= em)) {
      if (term ? m % 4 === 0 : i % every === 0) {
        const first = new Date(y, m, 1), last = new Date(y, m + every - 1, 1);
        const n = term ? 1 : every; // a term's rent is already per term
        const r = LH.rateAt(u, first); // the rent in force when this period starts
        out.push({
          start: first, months: term ? 4 : every,
          due: LH.dueOn(y, m, t.dueDay),
          rent: r.rent * n,
          service: r.service * n,
          amount: (r.rent + r.service) * n,
          label: term ? LH.termLabel(first) : every === 1 ? LH.monthLabel(first) : `${LH.monthLabel(first)} – ${LH.monthLabel(last)}`,
        });
      }
      i++; m++; if (m > 11) { m = 0; y++; }
    }
    return out;
  };

  /* ---------- Rent changes ----------
     A unit's rent can change over time (a rent increase from 1 January, say). u.rent and u.service
     are what it started at; u.rates lists each change and the day it starts: [{ from, rent, service }].
     Every rent period uses the rate in force on its first day, so a change never rewrites past months. */
  LH.rateAt = function (u, date) {
    const d = typeof date === 'string' ? date : LH.iso(date);
    let r = { rent: Number(u.rent) || 0, service: Number(u.service) || 0 };
    for (const c of u.rates || []) if (c.from <= d) r = { rent: Number(c.rent) || 0, service: Number(c.service) || 0 };
    return r;
  };
  // The next change still to come, if one is booked.
  LH.nextRate = (u, today) => (u.rates || []).find((c) => c.from > LH.iso(today)) || null;
  // Book a new rent from a day. A newer decision replaces any change booked for that day or later.
  LH.setRate = function (u, from, rent, service) {
    const before = LH.rateAt(u, LH.addDays(LH.parse(from), -1));
    u.rates = (u.rates || []).filter((c) => c.from < from);
    if (before.rent === rent && before.service === service) return false; // nothing actually changes
    u.rates.push({ from, rent, service });
    return true;
  };
  // Days a rent change can start: the 1st of a month, or the first day of a term for bed spaces.
  LH.startChoices = function (term, today) {
    const out = [];
    const y = today.getFullYear(), m = today.getMonth();
    if (term) {
      for (let k = 0; out.length < 4; k++) {
        const d = new Date(y, m - (m % 4) + 4 * k, 1);
        out.push({ value: LH.iso(d), label: `${LH.termLabel(d)} (from ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()})`, past: d < today });
      }
    } else {
      for (let k = 0; k <= 12; k++) {
        const d = new Date(y, m + k, 1);
        out.push({ value: LH.iso(d), label: `1 ${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}${k === 0 ? ' (this month)' : ''}`, past: k === 0 });
      }
    }
    return out;
  };

  // Rent due on any day 1–31; in shorter months it falls on the last day (e.g. 31st → 30 April, 28 February).
  LH.dueOn = function (y, m, day) {
    const d = new Date(y, m, 1), last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    return new Date(d.getFullYear(), d.getMonth(), Math.min(Math.max(1, Number(day) || 1), last));
  };

  /* ---------- Tenancies ----------
     A tenant (the person) can have several tenancies over time: one per space they rented, from the
     day they moved in to the day they left. Rent is charged per tenancy, using that space's rent at
     the time, so moving rooms or leaving and coming back never changes what was charged before.
     A tenancy has:
       moveIn / moveOut       when the person lived there (moveOut empty while they still do)
       chargeFrom / chargeTo  which rent periods it pays for (default: moveIn / moveOut). A move takes
                              effect at the next rent period, so the old one is charged to the end of
                              the current period and the new one from the start of the next.
       space                  a copy of the space's name and rent, so old history survives even if the
                              space or property is later deleted. */
  LH.tenanciesOf = (state, t) => (state.tenancies || []).filter((x) => x.tenantId === t.id)
    .sort((a, b) => (a.moveIn < b.moveIn ? -1 : a.moveIn > b.moveIn ? 1 : 0));
  // The space a tenancy is for: the live one if it still exists, otherwise its saved copy.
  LH.spaceOf = (state, tn) => (state.units || []).find((u) => u.id === tn.unitId) || tn.space || null;
  LH.spaceCopy = (u) => (u ? { label: u.label, rent: u.rent, service: u.service || 0, serviceName: u.serviceName || '', period: u.period, rates: (u.rates || []).slice(), propertyId: u.propertyId } : null);
  // Every rent period the person has been charged for, across all their tenancies, oldest first.
  LH.tenantPeriods = function (state, t, today) {
    const tns = LH.tenanciesOf(state, t);
    if (!tns.length) { const u = (state.units || []).find((x) => x.id === t.unitId); return u ? LH.periods(t, u, today) : []; }
    const out = [];
    tns.forEach((tn) => {
      const u = LH.spaceOf(state, tn); if (!u) return;
      const from = tn.chargeFrom || tn.moveIn, to = tn.chargeTo || tn.moveOut || null;
      if (to && to < from) return; // moved on before it was ever charged
      LH.periods({ since: from, ended: to, dueDay: tn.dueDay, every: tn.every }, u, today)
        .forEach((p) => { p.tenancyId = tn.id; p.space = u.label; out.push(p); });
    });
    return out;
  };
  // The tenancy a person has now (or had last), and its space.
  LH.currentTenancy = (state, t) => { const tns = LH.tenanciesOf(state, t); return tns.find((x) => !x.moveOut) || tns[tns.length - 1] || null; };
  // Where the next rent period starts for a tenancy (used when someone moves): { next, lastDay }.
  LH.nextPeriodStart = function (state, tn, today) {
    const u = LH.spaceOf(state, tn);
    const ps = LH.periods({ since: tn.chargeFrom || tn.moveIn, ended: null, dueDay: tn.dueDay, every: tn.every }, u, today);
    const cur = ps[ps.length - 1];
    if (!cur) { const d = LH.parse(tn.chargeFrom || tn.moveIn); return { next: d, lastDay: LH.addDays(d, -1) }; }
    const next = new Date(cur.start.getFullYear(), cur.start.getMonth() + cur.months, 1);
    return { next, lastDay: LH.addDays(next, -1) };
  };

  /* ---------- Starting, moving and ending tenancies ----------
     The person record keeps a copy of their current tenancy (space, move-in date, due day, deposit,
     and "ended" when they have no current home) so screens can show it quickly. */
  LH.mirrorTenancy = function (state, t) {
    const tn = LH.currentTenancy(state, t); if (!tn) return;
    t.tenancyId = tn.id; t.unitId = tn.unitId; t.since = tn.moveIn;
    t.dueDay = tn.dueDay; t.every = tn.every; t.deposit = tn.deposit;
    t.ended = tn.moveOut || null;
    if (!t.ended) delete t.ended;
  };
  // A new tenancy in a space, from a move-in day. plan: { dueDay, every, deposit, chargeFrom }
  LH.startTenancy = function (state, t, unitId, moveIn, plan) {
    const u = (state.units || []).find((x) => x.id === unitId); if (!u) return null;
    state.tenancies = state.tenancies || [];
    const tn = { id: LH.uid('tn'), tenantId: t.id, name: t.name, phone: t.phone, propertyId: u.propertyId, roomId: u.roomId || '', unitId, spaceNo: u.spaceNo || 1,
      moveIn, moveOut: null, dueDay: plan.dueDay, every: u.period === 'term' ? 1 : (plan.every || 1), deposit: plan.deposit || 0, space: LH.spaceCopy(u) };
    // Someone coming back soon after leaving is never charged twice for a period they already paid
    // for: the new tenancy starts at the first period not yet charged.
    let from = plan.chargeFrom || moveIn;
    const before = LH.tenanciesOf(state, t).filter((x) => x.moveOut);
    if (before.length) {
      let paidTo = null;
      before.forEach((x) => {
        const sp = LH.spaceOf(state, x); if (!sp) return;
        const end = LH.parse(x.chargeTo || x.moveOut);
        LH.periods({ since: x.chargeFrom || x.moveIn, ended: x.chargeTo || x.moveOut, dueDay: x.dueDay, every: x.every }, sp, LH.addDays(end, 1))
          .forEach((p) => { const next = new Date(p.start.getFullYear(), p.start.getMonth() + p.months, 1); if (!paidTo || next > paidTo) paidTo = next; });
      });
      if (paidTo && LH.parse(from) < paidTo) {
        let d = paidTo;
        if (u.period === 'term') d = new Date(d.getFullYear(), d.getMonth() + ((4 - (d.getMonth() % 4)) % 4), 1);
        from = LH.iso(d);
      }
    }
    if (from !== moveIn) tn.chargeFrom = from;
    state.tenancies.push(tn);
    LH.mirrorTenancy(state, t);
    return tn;
  };
  // Leaving: the current period is still charged, as it always was.
  LH.endTenancy = function (state, t, day) {
    const tn = LH.currentTenancy(state, t); if (!tn || tn.moveOut) return null;
    tn.moveOut = day; tn.space = LH.spaceCopy(LH.spaceOf(state, tn)) || tn.space;
    LH.mirrorTenancy(state, t);
    return tn;
  };
  // Moving to another space: the new space is theirs straight away; rent switches at the next period.
  LH.moveTenancy = function (state, t, unitId, today) {
    const old = LH.currentTenancy(state, t); if (!old || old.moveOut || old.unitId === unitId) return null;
    const u = (state.units || []).find((x) => x.id === unitId); if (!u) return null;
    const np = LH.nextPeriodStart(state, old, today);
    let from = np.next;
    // Bed spaces are charged per term: start at the first term that begins on or after that day.
    if (u.period === 'term') { from = new Date(from.getFullYear(), from.getMonth() + ((4 - (from.getMonth() % 4)) % 4), 1); }
    old.moveOut = LH.iso(today); old.chargeTo = LH.iso(LH.addDays(from, -1)); old.space = LH.spaceCopy(LH.spaceOf(state, old)) || old.space;
    return LH.startTenancy(state, t, unitId, LH.iso(today), { dueDay: old.dueDay, every: old.every, deposit: old.deposit, chargeFrom: LH.iso(from) });
  };

  /* Brings older records up to date: rooms (spaces grouped into rooms; a flat or shop is a room with
     one space), one tenancy per tenant, and each payment linked to its tenancy. Safe to run again. */
  LH.migrate = function (state) {
    let changed = false;
    state.rooms = state.rooms || [];
    state.tenancies = state.tenancies || [];
    const props = {}; (state.properties || []).forEach((p) => { props[p.id] = p; });
    const houseOf = (u) => u.house || (u.label.includes(' · ') ? u.label.split(' · ')[0] : u.label);
    // Rooms
    (state.units || []).forEach((u) => {
      if (u.roomId && state.rooms.some((r) => r.id === u.roomId)) return;
      const shared = (props[u.propertyId] || {}).kind === 'boarding';
      const name = shared ? houseOf(u) : u.label;
      let room = shared && state.rooms.find((r) => r.propertyId === u.propertyId && r.name === name);
      if (!room) { room = { id: LH.uid('rm'), propertyId: u.propertyId, name }; state.rooms.push(room); }
      u.roomId = room.id; changed = true;
    });
    // Space numbers within each room, in list order.
    const seen = {};
    (state.units || []).forEach((u) => {
      seen[u.roomId] = (seen[u.roomId] || 0) + 1;
      if (u.spaceNo !== seen[u.roomId]) { u.spaceNo = seen[u.roomId]; changed = true; }
    });
    // Tenancies
    (state.tenants || []).forEach((t) => {
      if (t.tenancyId && state.tenancies.some((x) => x.id === t.tenancyId)) return;
      if (state.tenancies.some((x) => x.tenantId === t.id)) { t.tenancyId = LH.currentTenancy(state, t).id; changed = true; return; }
      const u = (state.units || []).find((x) => x.id === t.unitId);
      const tn = { id: LH.uid('tn'), tenantId: t.id, name: t.name, phone: t.phone, propertyId: u ? u.propertyId : '', roomId: u ? u.roomId : '', unitId: t.unitId, spaceNo: u ? u.spaceNo : 1,
        moveIn: t.since, moveOut: t.ended || null, dueDay: t.dueDay, every: t.every || 1, deposit: t.deposit || 0, space: LH.spaceCopy(u) };
      state.tenancies.push(tn); t.tenancyId = tn.id; changed = true;
    });
    // Payments belong to the tenancy they were paid during (or the person's latest one).
    (state.payments || []).forEach((p) => {
      if (p.tenancyId && state.tenancies.some((x) => x.id === p.tenancyId)) return;
      const tns = state.tenancies.filter((x) => x.tenantId === p.tenantId).sort((a, b) => (a.moveIn < b.moveIn ? -1 : 1));
      if (!tns.length) return;
      const during = tns.filter((x) => x.moveIn <= p.date).pop() || tns[0];
      p.tenancyId = during.id; changed = true;
    });
    return changed;
  };

  LH.account = function (state, t, today) {
    const ctn = LH.currentTenancy(state, t);
    const u = (ctn && LH.spaceOf(state, ctn)) || state.units.find((x) => x.id === t.unitId);
    const plan = ctn || t; // due day and how often they pay come from the current tenancy
    const step = LH.every(plan, u);
    const now = LH.rateAt(u, today);
    const per = (now.rent + now.service) * (u.period === 'term' ? 1 : step);
    const ps = LH.tenantPeriods(state, t, today);
    const pays = state.payments
      .filter((p) => p.tenantId === t.id && p.status === 'confirmed')
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const charged = ps.reduce((s, p) => s + p.amount, 0);
    const paid = pays.reduce((s, p) => s + p.amount, 0);
    const balance = Math.round((charged - paid) * 100) / 100;

    let rem = paid, oldest = null;
    for (const p of ps) {
      if (rem >= p.amount - 0.001) { p.paidAmt = p.amount; rem -= p.amount; p.state = 'paid'; }
      else { p.paidAmt = rem; rem = 0; p.state = p.paidAmt > 0 ? 'partial' : 'unpaid'; if (!oldest) oldest = p; }
    }
    const cur = ps[ps.length - 1];
    const res = { unit: u, periods: ps, payments: pays, charged, paid, balance, per, current: cur, daysLate: 0, aheadUntil: null };

    if (!cur) { const from = LH.parse((ctn && (ctn.chargeFrom || ctn.moveIn)) || t.since); res.status = 'paid'; res.dueDate = LH.dueOn(from.getFullYear(), from.getMonth(), plan.dueDay); return res; }

    if (balance <= 0) {
      res.status = 'paid';
      const extra = Math.floor(-balance / per + 0.0001);
      const base = cur.due;
      res.dueDate = LH.dueOn(base.getFullYear(), base.getMonth() + step * (extra + 1), plan.dueDay);
      if (extra >= 1) {
        const until = new Date(base.getFullYear(), base.getMonth() + step * extra + (u.period === 'term' ? 0 : step - 1), 1);
        res.aheadUntil = u.period === 'term' ? LH.termLabel(until) : LH.monthLabel(until);
      }
    } else {
      res.dueDate = oldest.due;
      if (oldest.due < today) {
        res.daysLate = LH.daysBetween(oldest.due, today);
        res.status = oldest.paidAmt > 0 && balance <= per ? 'partial' : 'overdue';
      } else {
        res.status = oldest.paidAmt > 0 ? 'partial' : 'due';
      }
    }
    return res;
  };

  /* ---------- Reading mobile money messages ----------
     Finds payments in the "money received" SMS that MTN MoMo, Airtel Money and Zamtel Kwacha send.
     Wording differs between networks and changes over time, so this looks for the parts every such
     message has: an amount, the sender's number, often their name and a transaction ID.
     Messages about money sent, airtime, bundles or balances only are ignored. */
  LH.parseMoneySms = function (text) {
    const out = [];
    // Split pasted text into separate messages: blank lines, or a new "You have received"/"Money received" start.
    const parts = String(text || '').replace(/\r/g, '').split(/\n\s*\n|(?=\b(?:You have received|Money received|Received ZMW|Received K)\b)/i).map((s) => s.trim()).filter(Boolean);
    for (const raw of parts) {
      const s = raw.replace(/\s+/g, ' ');
      if (!/receiv|credited|deposit/i.test(s)) continue;              // only money coming in
      if (/\b(you have sent|sent to|you paid|payment to|withdraw|airtime|bundle)\b/i.test(s)) continue;
      // Amount: the first ZMW/K figure that isn't a balance or a fee.
      let amount = null;
      const re = /(?:ZMW|ZK|K)\s?([0-9][0-9,]*(?:\.[0-9]{1,2})?)/gi; let m;
      while ((m = re.exec(s))) {
        const before = s.slice(Math.max(0, m.index - 22), m.index).toLowerCase();
        if (/bal|balance|fee|charge|levy/.test(before)) continue;
        amount = Number(m[1].replace(/,/g, '')); break;
      }
      if (!(amount > 0)) continue;
      // The sender's number: looked for first in the "from …" part (before the transaction ID or balance),
      // where networks write it as 0966…, 260966…, +260 96 612 3456 or just 966123456.
      const FULL = /(?:\+?260|\b0)[\s-]?(?:9[5-7]|7[5-7]|57)(?:[\s-]?\d){7}(?!\d)/;
      const BARE = /\b(?:9[5-7]|7[5-7]|57)\d{7}\b/;
      const fromPart = (s.match(/\bfrom\b(.*?)(?=\b(?:Txn|Trans|Transaction|Financial|TID|Ref|Reference|Bal|Balance|New balance|Your)\b|$)/i) || [])[1] || '';
      const ph = fromPart.match(FULL) || fromPart.match(BARE) || s.match(FULL);
      const phone = ph ? LH.cleanPhone(ph[0]) : null;
      const nm = s.match(/from\s+(?:[+0-9 ()]{9,}\s*)?([A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){0,3})/);
      const name = nm ? nm[1].replace(/(\s+(On|At|Ref|Txn|Transaction|Your|New|Amount|ZMW))+$/i, '').trim() : null;
      const id = s.match(/(?:Transaction\s*ID|Trans\.?\s*ID|Txn\.?\s*ID|TID|Financial Transaction Id|Ref(?:erence)?)[:.\s#]*([A-Z0-9][A-Z0-9.\-]{4,})/i);
      const dt = s.match(/(\d{4})-(\d{2})-(\d{2})|(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
      let date = null;
      if (dt) {
        if (dt[1]) date = `${dt[1]}-${dt[2]}-${dt[3]}`;
        else { const y = dt[6].length === 2 ? '20' + dt[6] : dt[6]; date = `${y}-${String(dt[5]).padStart(2, '0')}-${String(dt[4]).padStart(2, '0')}`; }
      }
      // Which wallet received it: named in the message, otherwise the app uses the landlord's own network.
      const net = /airtel/i.test(s) ? 'Airtel' : /zamtel|kwacha/i.test(s) ? 'Zamtel' : /mtn|momo/i.test(s) ? 'MTN' : null;
      out.push({ raw, amount, phone, name, ref: id ? id[1].replace(/\.$/, '') : null, date, net });
    }
    return out;
  };

  /* ---------- Checklist for pop-ups from the networks (Android app) ----------
     A pop-up is only read as a payment when it passes every check for the network that sent it:
     - Sender: named Airtel Money (any spelling or capitals), MoMo / MTN, or Zamtel. Never a phone number.
     - Airtel Money: the message starts "You have received". This covers Airtel → Airtel ("… from 770328917
       MWANSA SINKALA …", matched by the number) and MTN → Airtel ("… from Ireen Mooka. Txn. ID …", matched
       by the name). The second message of an MTN → Airtel transfer ("Money received … from 0245971 NFS
       SETTLEMENT ACCOUNT …") is ignored, so the money is counted once.
     - MTN MoMo: the message starts "Y'ello" (or Yello / Yellow), then "You have received".
     - Zamtel: a "received" message with an amount.
     - Settlement accounts and anything about money sent, airtime, bundles or balances are ignored.
     The wallet recorded is the network that sent the pop-up. */
  LH.senderNet = function (from) {
    const f = String(from || '');
    if (!/[a-z]/i.test(f)) return null; // a phone number can be anyone
    if (/airtel/i.test(f)) return 'Airtel';
    if (/zamtel|kwacha/i.test(f)) return 'Zamtel';
    if (/momo|mtn/i.test(f)) return 'MTN';
    return null;
  };
  LH.readPaymentPopup = function (from, body) {
    const net = LH.senderNet(from);
    const s = String(body || '').replace(/\s+/g, ' ').trim();
    if (!net || !s) return [];
    if (/settlement/i.test(s)) return [];
    if (net === 'Airtel' && !/^you have received\b/i.test(s)) return [];
    if (net === 'MTN' && !/^y\s?['’`]?\s?ello(w)?\b[\s.,!:;-]*you have received\b/i.test(s)) return [];
    // One pop-up is one payment: drop the "Y'ello." greeting so the parser sees one message.
    const r = LH.parseMoneySms(s.replace(/^y\s?['’`]?\s?ello(w)?\b[\s.,!:;-]*/i, ''));
    return r.slice(0, 1).map((m) => Object.assign(m, { net }));
  };
  // A name in a message matches a tenant when it is the same words (any order, any capitals).
  LH.sameName = function (a, b) {
    const w = (x) => String(x || '').toLowerCase().replace(/[^a-z' -]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
    return !!w(a) && w(a) === w(b);
  };

  /* ---------- Messages ----------
     Bemba and Nyanja are first drafts: have a native speaker review before launch. */
  LH.LANGS = { en: 'English', bem: 'Bemba', nya: 'Nyanja' };
  LH.reminderText = function (lang, o) {
    const d = LH.fmtDay(o.due);
    if (lang === 'nya')
      return `Moni ${o.first}. Tikukumbutsani kuti lendi yanu ya ${o.amount} ya ${o.unit} ${o.late ? `yachedwa kuyambira pa ${d}` : `iyenera kulipilidwa pa ${d}`}. Lipilani pa MTN MoMo kapena Airtel Money mu Landlord Hub, kapena ku ${o.phone}. Zikomo, ${o.landlord}.`;
    if (lang === 'bem')
      return `Mwapoleni ${o.first}. Tulemicinkulako ukuti ubukode bwenu bwa ${o.amount} ubwa ${o.unit} ${o.late ? `bwachelwa ukutula pa ${d}` : `bulefwaikwa pa ${d}`}. Lipileni pa MTN MoMo nangu Airtel Money muli Landlord Hub, nangu kuli ${o.phone}. Natotela, ${o.landlord}.`;
    return `Hello ${o.first}, a reminder that your rent of ${o.amount} for ${o.unit} ${o.late ? `was due on ${d}` : `is due on ${d}`}. You can pay with MTN MoMo or Airtel Money in Landlord Hub, or to ${o.phone}. Thank you, ${o.landlord}.`;
  };

  LH.templates = [
    { id: 'general', name: 'General', title: '', body: '' },
    {
      id: 'service', name: 'Water / power',
      title: 'Water interruption on [day]',
      body: 'Dear tenants,\n\nLWSC has told us that water will be off on [day] from [start time] to [end time]. Please store enough water the evening before.\n\nThank you for your patience.\n{landlord}',
    },
    {
      id: 'increase', name: 'Rent increase',
      title: 'Rent change from [date]',
      body: 'Dear tenant,\n\nThis is to let you know that your monthly rent will change from [current rent] to [new rent] from [date]. This notice is given in line with your lease agreement.\n\nIf you have any questions, please call or WhatsApp me.\n\nRegards,\n{landlord}',
    },
    {
      id: 'late', name: 'Late payment',
      title: 'Rent overdue',
      body: 'Dear {tenant},\n\nOur records show that {amount} for {unit} has been overdue since {due}. Please pay by [date], or contact me so we can agree a payment plan.\n\nRegards,\n{landlord}',
    },
    {
      id: 'vacate', name: 'Notice to vacate',
      title: 'Notice to vacate',
      body: 'Dear {tenant},\n\nThis letter is formal notice to vacate {unit} by [date].\n\nReason: [reason]\n\nPlease arrange a handover inspection before you move out so that your deposit can be settled.\n\nRegards,\n{landlord}',
    },
  ];

  /* ---------- Demo data (built relative to today so it always looks current) ---------- */
  LH.seed = function (today) {
    const y = today.getFullYear(), m = today.getMonth();
    const mo = (k, day = 1) => LH.iso(new Date(y, m - k, day));
    const tsm = m - (m % 4);
    const termStart = (k) => LH.iso(new Date(y, tsm - 4 * k, 1));

    const state = {
      version: 1,
      landlord: {
        id: 'L1', name: 'Haggai Mukonka', phone: '0966123456', email: 'haggai.mukonka@example.com',
        business: 'Mukonka Properties',
        payout: '0966123456', joined: mo(30),
      },
      caretakers: [
        { id: 'C1', name: 'Esther Mumba', phone: '0977345120', propertyIds: ['P1', 'P2'], since: mo(10) },
      ],
      properties: [
        { id: 'P1', name: 'Kabulonga Flats', area: 'Kabulonga, Lusaka', kind: 'flats' },
        { id: 'P2', name: 'Mutende Student Lodge', area: 'Kalingalinga, Lusaka', kind: 'boarding' },
        { id: 'P3', name: 'Parklands House', area: 'Parklands, Kitwe', kind: 'house' },
        { id: 'P4', name: 'Cairo Road Shops', area: 'Cairo Road, Lusaka', kind: 'shops' },
      ],
      units: [
        { id: 'U1', propertyId: 'P1', label: 'Flat 1', rent: 5500, service: 350, serviceName: 'Water & security', period: 'month' },
        { id: 'U2', propertyId: 'P1', label: 'Flat 2', rent: 5500, service: 350, serviceName: 'Water & security', period: 'month' },
        { id: 'U3', propertyId: 'P1', label: 'Flat 3', rent: 4800, service: 350, serviceName: 'Water & security', period: 'month' },
        { id: 'U4', propertyId: 'P1', label: 'Flat 4', rent: 4800, service: 350, serviceName: 'Water & security', period: 'month' },
        { id: 'U5', propertyId: 'P1', label: 'Flat 5', rent: 6500, service: 350, serviceName: 'Water & security', period: 'month' },
        { id: 'U6', propertyId: 'P1', label: 'Flat 6', rent: 6500, service: 350, serviceName: 'Water & security', period: 'month' },
        { id: 'U7', propertyId: 'P2', label: 'Room 1 · Bed A', rent: 3200, service: 0, period: 'term' },
        { id: 'U8', propertyId: 'P2', label: 'Room 1 · Bed B', rent: 3200, service: 0, period: 'term' },
        { id: 'U9', propertyId: 'P2', label: 'Room 2 · Bed A', rent: 3200, service: 0, period: 'term' },
        { id: 'U10', propertyId: 'P2', label: 'Room 2 · Bed B', rent: 3200, service: 0, period: 'term' },
        { id: 'U11', propertyId: 'P2', label: 'Room 3 · Bed A', rent: 3500, service: 0, period: 'term' },
        { id: 'U12', propertyId: 'P2', label: 'Room 3 · Bed B', rent: 3500, service: 0, period: 'term' },
        { id: 'U13', propertyId: 'P3', label: 'Main house', rent: 7500, service: 0, period: 'month' },
        { id: 'U14', propertyId: 'P4', label: 'Shop 1', rent: 9000, service: 500, serviceName: 'Security & cleaning', period: 'month' },
        { id: 'U15', propertyId: 'P4', label: 'Shop 2', rent: 9000, service: 500, serviceName: 'Security & cleaning', period: 'month' },
        { id: 'U16', propertyId: 'P4', label: 'Shop 3', rent: 7500, service: 500, serviceName: 'Security & cleaning', period: 'month' },
      ],
      tenants: [
        { id: 'T1', name: 'Chanda Mulenga', phone: '0965123344', unitId: 'U1', since: mo(14), dueDay: 1, deposit: 5500, lang: 'bem', p: 'ontime' },
        { id: 'T2', name: 'Natasha Phiri', phone: '0971882301', unitId: 'U2', since: mo(9), dueDay: 1, deposit: 5500, lang: 'en', p: 'partial' },
        { id: 'T3', name: 'Bwalya Mwansa', phone: '0954410987', unitId: 'U3', since: mo(20), dueDay: 1, deposit: 4800, lang: 'bem', p: 'late' },
        { id: 'T4', name: 'Mutinta Hamoonga', phone: '0762231190', unitId: 'U4', since: mo(6), dueDay: 5, deposit: 4800, lang: 'en', p: 'ontime' },
        { id: 'T5', name: 'Joseph Tembo', phone: '0979021876', unitId: 'U5', since: mo(2), dueDay: 1, deposit: 6500, lang: 'nya', p: 'ahead' },
        { id: 'T6', name: 'Lubinda Akapelwa', phone: '0977112093', unitId: 'U6', since: mo(16), dueDay: 1, deposit: 6500, lang: 'en', p: 'arrears' },
        { id: 'T7', name: 'Kondwani Lungu', phone: '0961200455', unitId: 'U7', since: termStart(1), dueDay: 7, deposit: 0, lang: 'nya', p: 'ontime' },
        { id: 'T8', name: 'Mwape Kasonde', phone: '0778834521', unitId: 'U8', since: termStart(1), dueDay: 7, deposit: 0, lang: 'bem', p: 'partial' },
        { id: 'T9', name: 'Precious Nkhoma', phone: '0965509871', unitId: 'U9', since: termStart(2), dueDay: 7, deposit: 0, lang: 'nya', p: 'ontime' },
        { id: 'T10', name: 'Daliso Mbewe', phone: '0975567012', unitId: 'U10', since: termStart(1), dueDay: 7, deposit: 0, lang: 'nya', p: 'late' },
        { id: 'T11', name: 'Kelvin Chileshe', phone: '0963378800', unitId: 'U13', since: mo(30), dueDay: 25, deposit: 7500, lang: 'en', p: 'ontime' },
        { id: 'T12', name: 'Mutale Banda', phone: '0966540781', unitId: 'U14', since: mo(11), dueDay: 1, deposit: 18000, lang: 'en', p: 'ontime' },
        { id: 'T13', name: 'Grace Zulu', phone: '0973301288', unitId: 'U15', since: mo(5), dueDay: 5, deposit: 9000, lang: 'bem', p: 'partial' },
      ],
      payments: [],
      notices: [
        { id: 'N1', title: 'Water interruption on Saturday', body: 'LWSC will work on the Kabulonga line this Saturday from 09:00 to 14:00. Please store enough water on Friday evening.\n\nThank you for your patience.\nHaggai Mukonka', audience: 'P1', channels: ['app', 'whatsapp'], date: LH.iso(LH.addDays(today, -3)) },
        { id: 'N2', title: 'Quiet hours during exams', body: 'From Monday, quiet hours are 21:00 to 06:00 every day until exams end. Please keep music low and use the study room for group work.\n\nGood luck with your exams.\nHaggai Mukonka', audience: 'P2', channels: ['app', 'sms'], date: LH.iso(LH.addDays(today, -9)) },
        { id: 'N3', title: 'Backup power for the borehole', body: 'The new solar backup is installed. During load-shedding the borehole pump and gate motor will keep running. Please switch off geysers when power returns to avoid tripping.\n\nHaggai Mukonka', audience: 'P1', channels: ['app', 'whatsapp'], date: LH.iso(LH.addDays(today, -24)) },
      ],
      requests: [
        { id: 'R1', tenantId: 'T2', category: 'Plumbing', text: 'Kitchen tap is leaking and the sink cupboard is getting wet.', status: 'open', date: LH.iso(LH.addDays(today, -4)) },
        { id: 'R2', tenantId: 'T7', category: 'Security', text: 'Window latch in Room 1 is broken and does not lock.', status: 'progress', date: LH.iso(LH.addDays(today, -6)) },
        { id: 'R3', tenantId: 'T1', category: 'Electrical', text: 'Security light at the gate is not working.', status: 'done', date: LH.iso(LH.addDays(today, -19)) },
      ],
      activity: [
        { id: 'A1', date: LH.iso(LH.addDays(today, -3)), who: 'Haggai Mukonka', text: 'Sent "Water interruption on Saturday" to Kabulonga Flats' },
        { id: 'A2', date: LH.iso(LH.addDays(today, -6)), who: 'Esther Mumba', text: 'Marked "Window latch in Room 1" as in progress' },
      ],
      reminders: { before5: true, dueDay: true, late3: true, weekly: true, channel: 'whatsapp' },
      remindedAt: {},
      receiptSeq: 0,
    };

    const methodFor = (t) => {
      const n = LH.network(t.phone);
      if (n === 'Zamtel') return { method: 'Cash', by: 'caretaker', byName: 'Esther Mumba' };
      return { method: LH.wallet(n), by: 'tenant', byName: t.name };
    };
    const ref = (method) => method === 'MTN MoMo' ? 'MP' + String(Math.floor(1e9 + Math.random() * 9e9))
      : method === 'Airtel Money' ? 'CI' + String(Math.floor(1e8 + Math.random() * 9e8)) : '';

    const pays = [];
    for (const t of state.tenants) {
      const u = state.units.find((x) => x.id === t.unitId);
      const ps = LH.periods(t, u, today);
      const n = ps.length;
      const pay = (amount, date) => {
        if (date > today) return;
        const mf = methodFor(t);
        pays.push({ id: LH.uid('p'), tenantId: t.id, amount, date: LH.iso(date), method: mf.method, by: mf.by, byName: mf.byName, ref: ref(mf.method), status: 'confirmed' });
      };
      ps.forEach((p, i) => {
        const k = n - 1 - i;
        switch (t.p) {
          case 'ontime': pay(p.amount, p.due); break;
          case 'late': if (k >= 1) pay(p.amount, LH.addDays(p.due, 7)); break;
          case 'partial': if (k >= 1) pay(p.amount, LH.addDays(p.due, -1)); else pay(Math.round(p.amount / 2), LH.addDays(p.due, 3)); break;
          case 'ahead': if (i === 0) pay(p.amount * 6, LH.parse(t.since)); break;
          case 'arrears': if (k >= 3) pay(p.amount, LH.addDays(p.due, 2)); else if (k === 2) pay(Math.round(p.amount / 2), LH.addDays(p.due, 10)); break;
        }
      });
      delete t.p;
    }
    pays.sort((a, b) => (a.date < b.date ? -1 : 1));
    pays.forEach((p) => { state.receiptSeq++; p.receipt = `LH-${p.date.slice(0, 4)}-${pad(state.receiptSeq, 4)}`; });
    state.payments = pays;

    // A Zamtel tenant paid the landlord's own number and is waiting for confirmation.
    state.payments.push({
      id: 'pPending1', tenantId: 'T3', amount: 2000, date: LH.iso(LH.addDays(today, -1)), method: 'Zamtel Kwacha',
      by: 'tenant', byName: 'Bwalya Mwansa', ref: 'ZK48211907', status: 'pending', proof: 'zamtel-confirmation.jpg',
      note: 'Sent to your 096 number. Balance next week.',
    });
    state.deductions = LH.seedDeductions(state, today);
    LH.migrate(state); // rooms and tenancies for the sample data
    return state;
  };

  /* ---------- Deductions: money taken out of collected rent ---------- */
  LH.DEDUCTION_REASONS = ['Repairs', 'Caretaker pay', 'Mobile money fees', 'Utilities', 'Rent discount', 'Agent commission', 'Other'];

  // Sample history: caretaker pay each month, mobile-money fees on wallet payments, and the odd repair.
  LH.seedDeductions = function (state, today) {
    const out = [];
    const first = state.payments.reduce((d, p) => (p.date < d ? p.date : d), LH.iso(today));
    const start = LH.parse(first);
    const repairs = [
      ['P1', 850, 'Replaced gate motor fuse'], ['P3', 2400, 'Fixed roof leak in the main bedroom'], ['P1', 1200, 'Plumber: blocked drain, Flat 4'],
      ['P2', 600, 'New locks, Room 2'], ['P1', 3100, 'Borehole pump service'], ['P3', 950, 'Repainted the front wall'],
    ];
    let i = 0;
    for (let d = new Date(start.getFullYear(), start.getMonth(), 1); d <= today; d = new Date(d.getFullYear(), d.getMonth() + 1, 1), i++) {
      const y = d.getFullYear(), m = d.getMonth();
      const day = (n) => { const x = new Date(y, m, n); return x > today ? today : x; };
      for (const c of state.caretakers) {
        if (LH.iso(d) >= c.since.slice(0, 8) + '01') out.push({ id: LH.uid('d'), propertyId: c.propertyIds[0], amount: 1500, reason: 'Caretaker pay', note: c.name, date: LH.iso(day(28)) });
      }
      const wallet = state.payments.filter((p) => p.status === 'confirmed' && /MoMo|Airtel/.test(p.method) && LH.parse(p.date).getFullYear() === y && LH.parse(p.date).getMonth() === m);
      const fee = Math.round(wallet.reduce((s, p) => s + p.amount, 0) * 0.01);
      if (fee > 0) out.push({ id: LH.uid('d'), propertyId: '', amount: fee, reason: 'Mobile money fees', note: `1% on ${wallet.length} payment${wallet.length === 1 ? '' : 's'}`, date: LH.iso(day(new Date(y, m + 1, 0).getDate())) });
      if (i % 3 === 1) { const [pid, amount, note] = repairs[Math.floor(i / 3) % repairs.length]; out.push({ id: LH.uid('d'), propertyId: pid, amount, reason: 'Repairs', note, date: LH.iso(day(14)) }); }
    }
    return out.filter((x) => x.date <= LH.iso(today));
  };

  /* ---------- Rent record, for a tenant's rent reference ----------
     Looks at every rent period that has already fallen due and, spending the tenant's confirmed
     payments oldest first, finds the day each one was paid in full. "On time" means paid in full
     by the due date, with a few days' grace, because mobile money and bank transfers can take a
     day or two to show. Only payments the landlord recorded or confirmed count. */
  LH.REF_GRACE_DAYS = 3;
  LH.rentRecord = function (state, t, today) {
    const ctn = LH.currentTenancy(state, t);
    const u = (ctn && LH.spaceOf(state, ctn)) || state.units.find((x) => x.id === t.unitId);
    const due = LH.tenantPeriods(state, t, today).filter((p) => p.due <= today);
    const pays = state.payments.filter((p) => p.tenantId === t.id && p.status === 'confirmed')
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    let i = 0, left = 0, lastDate = null;
    const periods = due.map((per) => {
      let need = per.amount;
      while (need > 0.001) {
        if (left <= 0.001) {
          if (i >= pays.length) break;
          left = pays[i].amount; lastDate = LH.parse(pays[i].date); i++;
        }
        const take = Math.min(need, left);
        need -= take; left -= take;
      }
      const paid = need <= 0.001;
      const onTime = paid && lastDate <= LH.addDays(per.due, LH.REF_GRACE_DAYS);
      return { label: per.label, due: per.due, amount: per.amount, paid, paidOn: paid ? lastDate : null, onTime,
        state: onTime ? 'ontime' : paid ? 'late' : 'unpaid' };
    });
    let streak = 0, best = 0;
    periods.forEach((p) => { streak = p.onTime ? streak + 1 : 0; best = Math.max(best, streak); });
    const word = u.period === 'term' ? 'term' : LH.every(ctn || t, u) === 1 ? 'month' : 'payment';
    return {
      periods, word,
      total: periods.length,
      onTime: periods.filter((p) => p.state === 'ontime').length,
      late: periods.filter((p) => p.state === 'late').length,
      unpaid: periods.filter((p) => p.state === 'unpaid').length,
      bestStreak: best,
      currentStreak: streak,
      totalPaid: pays.reduce((s, p) => s + p.amount, 0),
      since: LH.parse(((LH.tenanciesOf(state, t)[0] || {}).moveIn) || t.since),
    };
  };
  // A short code to quote when checking a reference, e.g. "R-7KQ2MD". The same tenant on the same
  // day always gets the same code.
  LH.referenceCode = function (t, today) {
    const s = `${t.id}|${t.since}|${LH.iso(today)}`;
    let h = 2166136261;
    for (let k = 0; k < s.length; k++) { h ^= s.charCodeAt(k); h = Math.imul(h, 16777619) >>> 0; }
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = '';
    for (let k = 0; k < 6; k++) { out += A[h % A.length]; h = Math.floor(h / A.length) || (h ^ 0x9e3779b9) >>> 0; }
    return 'R-' + out;
  };

  /* ---------- Sample messages for the demo ----------
     A late tenant saying when they'll pay, and a reply to a notice with the landlord's answer. */
  LH.seedMessages = function (state, today) {
    const out = [];
    const t3 = state.tenants.find((t) => t.id === 'T3'), t2 = state.tenants.find((t) => t.id === 'T2');
    const unitP = (t) => (state.units.find((u) => u.id === t.unitId) || {}).propertyId || '';
    const at = (days, h) => { const d = LH.addDays(today, days); d.setHours(h, 0, 0, 0); return d.getTime(); };
    if (t3) {
      let fri = LH.addDays(today, 1);
      while (fri.getDay() !== 5) fri = LH.addDays(fri, 1);
      out.push({ id: 'M1', tenantId: t3.id, propertyId: unitP(t3), from: 'tenant', about: 'rent', promise: LH.iso(fri),
        text: `Sorry for the delay with the rent. I get paid this week, so I'll pay on ${LH.fmtLong(fri)}.`, date: LH.iso(today), at: at(0, 8), read: false });
    }
    const n1 = state.notices.find((n) => n.id === 'N1');
    if (t2 && n1) {
      out.push({ id: 'M2', tenantId: t2.id, propertyId: unitP(t2), from: 'tenant', about: n1.id, promise: null,
        text: 'Thank you for letting us know. Will the water be back by Saturday evening?', date: LH.iso(LH.addDays(today, -2)), at: at(-2, 18), read: true });
      out.push({ id: 'M3', tenantId: t2.id, propertyId: unitP(t2), from: 'landlord', about: n1.id, promise: null,
        text: 'Yes, LWSC says it should be back by 15:00.', date: LH.iso(LH.addDays(today, -2)), at: at(-2, 19), read: true });
    }
    return out;
  };
})();
