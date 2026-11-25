/* Tests for the landlord's rent reminders (LH.planRentReminders in core.js).
   Run: node tests/reminders.test.js */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
global.window = {};
new Function(fs.readFileSync(path.join(__dirname, '..', 'core.js'), 'utf8'))();
const LH = global.window.LH;

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}
const money = (n) => 'K' + n.toLocaleString('en');
const ALL = { before3: true, dueDay: true, late3: true, weekly: false };
const now = new Date(2026, 10, 20, 14, 0); // 20 November 2026, 2 pm
const d = (y, m, day) => new Date(y, m, day);
const ten = (id, name, amount, due) => ({ id, name, place: 'Flat 1, Kabulonga Flats', amount, due });
const when = (x) => `${LH.iso(x.at)} ${x.at.getHours()}:${String(x.at.getMinutes()).padStart(2, '0')}`;

console.log('Which days');
check('due in 11 days: 3 days before, on the day and 3 days late, all at 9:00', () => {
  const p = LH.planRentReminders([ten('T1', 'Chanda Mulenga', 5500, d(2026, 11, 1))], ALL, now, money);
  assert.deepStrictEqual(p.map((x) => x.kind), ['before3', 'dueDay', 'late3']);
  assert.deepStrictEqual(p.map(when), ['2026-11-28 9:00', '2026-12-01 9:00', '2026-12-04 9:00']);
});
check('due tomorrow: "3 days before" has passed, so only the due day and 3 days late', () => {
  const p = LH.planRentReminders([ten('T1', 'Chanda', 5500, d(2026, 10, 21))], ALL, now, money);
  assert.deepStrictEqual(p.map((x) => x.kind), ['dueDay', 'late3']);
});
check('due today after 9:00: only 3 days late is left', () => {
  const p = LH.planRentReminders([ten('T1', 'Chanda', 5500, d(2026, 10, 20))], ALL, now, money);
  assert.deepStrictEqual(p.map((x) => x.kind), ['late3']);
});
check('already 5 days late: nothing left unless weekly is on', () => {
  assert.deepStrictEqual(LH.planRentReminders([ten('T1', 'Chanda', 5500, d(2026, 10, 15))], ALL, now, money), []);
  const w = LH.planRentReminders([ten('T1', 'Chanda', 5500, d(2026, 10, 15))], { ...ALL, weekly: true }, now, money);
  assert.ok(w.length > 0 && w.every((x) => x.kind === 'weekly'));
  assert.strictEqual(when(w[0]), '2026-11-25 9:00'); // 10 days after the due date
});
check('switched-off days are left out', () => {
  const p = LH.planRentReminders([ten('T1', 'Chanda', 5500, d(2026, 11, 1))], { before3: false, dueDay: true, late3: false }, now, money);
  assert.deepStrictEqual(p.map((x) => x.kind), ['dueDay']);
});
check('nothing owed: no reminders', () => {
  assert.deepStrictEqual(LH.planRentReminders([ten('T1', 'Chanda', 0, d(2026, 11, 1))], ALL, now, money), []);
});
check('nothing more than 60 days ahead', () => {
  assert.deepStrictEqual(LH.planRentReminders([ten('T1', 'Chanda', 5500, d(2027, 3, 1))], ALL, now, money), []);
});

console.log('Wording and grouping');
check('one tenant: names them, the amount and the place', () => {
  const [p] = LH.planRentReminders([ten('T1', 'Chanda Mulenga', 5500, d(2026, 11, 1))], ALL, now, money);
  assert.strictEqual(p.title, 'Rent due in 3 days: Chanda Mulenga');
  assert.strictEqual(p.body, 'K5,500 for Flat 1, Kabulonga Flats is due on 1 December 2026. Tap to review and send a reminder.');
  assert.deepStrictEqual(p.ids, ['T1']);
});
check('tenants due the same day share one reminder', () => {
  const list = [ten('T1', 'Chanda', 5500, d(2026, 11, 1)), ten('T2', 'Natasha', 3000, d(2026, 11, 1)), ten('T3', 'Bwalya', 4800, d(2026, 11, 1)), ten('T4', 'Joseph', 6500, d(2026, 11, 1))];
  const p = LH.planRentReminders(list, ALL, now, money);
  assert.strictEqual(p.length, 3);
  assert.strictEqual(p[0].title, 'Rent due in 3 days: 4 tenants');
  assert.strictEqual(p[0].body, 'Chanda, Natasha and 2 more: K19,800 in total due on 1 December 2026. Tap to review and send reminders.');
  assert.deepStrictEqual(p[0].ids, ['T1', 'T2', 'T3', 'T4']);
  assert.strictEqual(p[2].title, 'Rent 3 days late: 4 tenants');
});
check('different due days stay separate; every reminder has its own number', () => {
  const p = LH.planRentReminders([ten('T1', 'Chanda', 5500, d(2026, 11, 1)), ten('T2', 'Natasha', 3000, d(2026, 11, 5))], ALL, now, money);
  assert.strictEqual(p.length, 6);
  assert.strictEqual(new Set(p.map((x) => x.id)).size, 6);
  assert.ok(p.every((x) => Number.isInteger(x.id) && x.id > 0 && x.id <= 2000000000));
});
check('the same reminder keeps the same number next time (so it can be replaced)', () => {
  const a = LH.planRentReminders([ten('T1', 'Chanda', 5500, d(2026, 11, 1))], ALL, now, money);
  const b = LH.planRentReminders([ten('T1', 'Chanda', 5000, d(2026, 11, 1))], ALL, new Date(2026, 10, 21), money);
  assert.deepStrictEqual(a.map((x) => x.id), b.map((x) => x.id));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
