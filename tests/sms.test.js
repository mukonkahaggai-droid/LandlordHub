/* Tests for reading MoMo / Airtel / Zamtel "money received" messages (LH.parseMoneySms in core.js).
   Run: node tests/sms.test.js
   The sample messages follow the shapes these networks use; the names and numbers are made up. */
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
const one = (text) => { const r = LH.parseMoneySms(text); assert.strictEqual(r.length, 1, 'expected 1 payment, got ' + r.length + ' ' + JSON.stringify(r)); return r[0]; };
const none = (text) => assert.deepStrictEqual(LH.parseMoneySms(text), []);

console.log('Money received: read correctly');
check('MTN MoMo, 260 number then name', () => {
  const m = one('You have received ZMW 1,500.00 from 260966123456 BWALYA MWANSA on 2026-11-20 14:32:10. Your new balance is ZMW 3,250.00. Financial Transaction Id: 7845123690.');
  assert.strictEqual(m.amount, 1500); assert.strictEqual(m.phone, '0966123456'); assert.strictEqual(m.name, 'BWALYA MWANSA');
  assert.strictEqual(m.ref, '7845123690'); assert.strictEqual(m.date, '2026-11-20');
});
check('MTN MoMo, K amount, number in brackets after name', () => {
  const m = one("Y'ello. You have received K1500.00 from BWALYA MWANSA (0966123456). Transaction ID: 123456789. Balance K3,250.00");
  assert.strictEqual(m.amount, 1500); assert.strictEqual(m.phone, '0966123456'); assert.strictEqual(m.ref, '123456789');
});
check('Airtel Money, "Money Received. Amount ZMW"', () => {
  const m = one('Money Received. Amount ZMW 800.00 from 0977123456 JOHN BANDA. Trans ID: PP261120.1432.A12345. Bal: ZMW 900.00');
  assert.strictEqual(m.amount, 800); assert.strictEqual(m.phone, '0977123456');
  assert.strictEqual(m.ref, 'PP261120.1432.A12345');
});
check('Airtel Money, 9-digit number after the name', () => {
  const m = one('You have received ZMW800.00 from JOHN BANDA, 977123456. Txn ID: CI261120.1432.B54321. Your Airtel Money balance is ZMW 900.00.');
  assert.strictEqual(m.amount, 800); assert.strictEqual(m.phone, '0977123456');
});
check('Zamtel Kwacha', () => {
  const m = one('You have received K500.00 from 0955123456 MARY PHIRI. Ref: ZK12345678. New balance K700.00');
  assert.strictEqual(m.amount, 500); assert.strictEqual(m.phone, '0955123456'); assert.strictEqual(m.ref, 'ZK12345678');
});
check('+260 number written with spaces', () => {
  const m = one('You have received ZMW 2,000.00 from +260 96 612 3456 BWALYA MWANSA. Transaction ID: 99887766.');
  assert.strictEqual(m.phone, '0966123456');
});
check('balance mentioned before the amount is not taken as the payment', () => {
  const m = one('Your balance is ZMW 5,000.00. You have received ZMW 300.00 from 0966123456 BWALYA MWANSA. Transaction ID: 55667788.');
  assert.strictEqual(m.amount, 300);
});
check('two messages pasted together', () => {
  const r = LH.parseMoneySms('You have received ZMW 100.00 from 0966123456 A B. Transaction ID: 111111.\n\nYou have received ZMW 200.00 from 0977123456 C D. Transaction ID: 222222.');
  assert.strictEqual(r.length, 2); assert.deepStrictEqual(r.map((x) => x.amount), [100, 200]);
});
check('a transaction ID that looks like a number is not taken as the sender', () => {
  const m = one('You have received ZMW 300.00 from JOHN BANDA. Transaction ID: 966123456.');
  assert.strictEqual(m.phone, null);
});

console.log('Not money received: ignored');
check('money sent', () => none('You have sent ZMW 200.00 to 0966123456 BWALYA MWANSA. Transaction ID: 123. New balance ZMW 50.00'));
check('cash out', () => none('Withdraw of ZMW 500.00 successful. Fee ZMW 10.00. New balance ZMW 20.00'));
check('airtime', () => none('You have received airtime of K10.00. Your balance is K12.00'));
check('bundle', () => none('Your data bundle of 1GB has been received. Valid for 7 days. K30'));
check('balance only', () => none('Your balance is ZMW 1,000.00.'));
check('received but no amount', () => none('Your request has been received and will be processed.'));

console.log('Your checklist: pop-ups from the networks (LH.readPaymentPopup)');
const pop = (from, body) => LH.readPaymentPopup(from, body);
const AIRTEL = 'You have received ZMW 126.00 from 770328917 MWANSA SINKALA.Dial *115# to check your new Bal. TID: PP261116.1211.B43380.';
const MTN_TO_AIRTEL = 'You have received K5 from Ireen Mooka. Txn. ID: CI261123.1847.B42289. Reason';
const NFS = 'Money received ZMW 600.00 from 0245971 NFS SETTLEMENT ACCOUNT. Dial *115# to check balance. Deposits are free. TID: CI261117.1413.J42436';
check('1. Airtel to Airtel: amount, 9-digit number, name, TID, Airtel Money', () => {
  const r = pop('AirtelMoney', AIRTEL); assert.strictEqual(r.length, 1); const m = r[0];
  assert.strictEqual(m.amount, 126); assert.strictEqual(m.phone, '0770328917'); assert.strictEqual(m.name, 'MWANSA SINKALA');
  assert.strictEqual(m.ref, 'PP261116.1211.B43380'); assert.strictEqual(m.net, 'Airtel');
});
check('1. every spelling of Airtel Money is accepted', () => {
  for (const f of ['AirtelMoney', 'Airtel Money', 'airtel money', 'airtelmoney', 'AIRTEL MONEY', 'AIRTELMONEY']) assert.strictEqual(pop(f, AIRTEL).length, 1, f);
});
check('2. MTN to Airtel: no number, name Ireen Mooka, Txn. ID read', () => {
  const m = pop('Airtel Money', MTN_TO_AIRTEL)[0];
  assert.strictEqual(m.amount, 5); assert.strictEqual(m.phone, null); assert.strictEqual(m.name, 'Ireen Mooka');
  assert.strictEqual(m.ref, 'CI261123.1847.B42289'); assert.strictEqual(m.net, 'Airtel');
});
check('2. the NFS SETTLEMENT ACCOUNT message is ignored', () => assert.deepStrictEqual(pop('AirtelMoney', NFS), []));
check('Airtel: a message that does not start "You have received" is ignored', () => assert.deepStrictEqual(pop('AirtelMoney', 'Money received ZMW 50.00 from 0977123456 JOHN BANDA. TID: PP1234567'), []));
check("3. MoMo: starts with Y'ello, then You have received", () => {
  for (const g of ["Y'ello.", 'Yello.', 'Yellow', 'Y’ello!', "Y'ello,"]) {
    const r = pop('MoMo', g + ' You have received K5 from Ireen Mooka. Txn. ID: CI261123.1847.B42289. Reason');
    assert.strictEqual(r.length, 1, g); assert.strictEqual(r[0].name, 'Ireen Mooka'); assert.strictEqual(r[0].net, 'MTN');
  }
});
check('3. MoMo to MoMo with a number', () => {
  const m = pop('MoMo', "Y'ello. You have received ZMW 1,500.00 from 260966123456 BWALYA MWANSA. Financial Transaction Id: 7845123690.")[0];
  assert.strictEqual(m.amount, 1500); assert.strictEqual(m.phone, '0966123456'); assert.strictEqual(m.net, 'MTN');
});
check("3. MoMo without Y'ello is ignored", () => assert.deepStrictEqual(pop('MoMo', 'You have received K5 from Ireen Mooka. Txn. ID: CI261123.1847.B42289.'), []));
check('a pop-up from a phone number is never read', () => assert.deepStrictEqual(pop('0977123456', AIRTEL), []));
check('a pop-up from another sender is never read', () => assert.deepStrictEqual(pop('Mum', AIRTEL), []));
check('Zamtel still read', () => assert.strictEqual(pop('Zamtel', 'You have received K500.00 from 0955123456 MARY PHIRI. Ref: ZK12345678.')[0].amount, 500));
check('names match in any order and capitals, and only whole names', () => {
  assert.ok(LH.sameName('Ireen Mooka', 'IREEN MOOKA')); assert.ok(LH.sameName('Mooka Ireen', 'Ireen Mooka'));
  assert.ok(!LH.sameName('Ireen', 'Ireen Mooka')); assert.ok(!LH.sameName('', ''));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
