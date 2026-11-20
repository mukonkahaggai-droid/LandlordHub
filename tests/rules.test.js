// Tests for firestore.rules, run against Firebase's emulator on this laptop (never the real database).
//   npm run test:rules
// Each test signs in as someone (a landlord, a tenant, a caretaker, a stranger) and checks what
// they can and can't read or write.
const { test, before, after, beforeEach } = require('node:test');
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');

const LANDLORD = 'landlordA', OTHER_LANDLORD = 'landlordB';
const PH = {
  landlord: '+260966123456', otherLandlord: '+260955000111',
  tenant1: '+260965123344', tenant2: '+260971882301', caretaker: '+260977345120', stranger: '+260961111111',
};

let env;
const L = `landlords/${LANDLORD}`;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-landlord-hub',
    firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8'), host: '127.0.0.1', port: 8085 },
  });
});
after(async () => { await env.cleanup(); });

// Fresh sample data before every test, written with the rules switched off.
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const set = (p, d) => db.doc(p).set(d);
    await set(L, { name: 'Haggai Mukonka', phone: PH.landlord, business: 'Mukonka Properties' });
    await set(`landlords/${OTHER_LANDLORD}`, { name: 'Other Landlord', phone: PH.otherLandlord });
    await set(`landlords/${OTHER_LANDLORD}/tenants/X1`, { name: 'Someone else', propertyId: 'Q1' });

    await set(`${L}/properties/P1`, { name: 'Kabulonga Flats' });
    await set(`${L}/properties/P3`, { name: 'Parklands House' });
    await set(`${L}/units/U1`, { propertyId: 'P1', label: 'Flat 1', rent: 5500 });
    await set(`${L}/units/U2`, { propertyId: 'P1', label: 'Flat 2', rent: 5500 });
    await set(`${L}/units/U13`, { propertyId: 'P3', label: 'Main house', rent: 7500 });
    await set(`${L}/tenants/T1`, { name: 'Chanda Mulenga', phone: PH.tenant1, unitId: 'U1', propertyId: 'P1' });
    await set(`${L}/tenants/T2`, { name: 'Natasha Phiri', phone: PH.tenant2, unitId: 'U2', propertyId: 'P1' });
    await set(`${L}/tenants/T11`, { name: 'Kelvin Chileshe', unitId: 'U13', propertyId: 'P3' });
    await set(`${L}/caretakers/C1`, { name: 'Esther Mumba', phone: PH.caretaker, propertyIds: ['P1'] });

    await set(`${L}/members/${PH.tenant1}`, { phone: PH.tenant1, role: 'tenant', refId: 'T1', propertyId: 'P1', unitId: 'U1' });
    await set(`${L}/members/${PH.tenant2}`, { phone: PH.tenant2, role: 'tenant', refId: 'T2', propertyId: 'P1', unitId: 'U2' });
    await set(`${L}/members/${PH.caretaker}`, { phone: PH.caretaker, role: 'caretaker', refId: 'C1', propertyIds: ['P1'] });

    await set(`${L}/payments/pay1`, { tenantId: 'T1', propertyId: 'P1', amount: 5500, status: 'confirmed', by: 'landlord', receipt: 'LH-2026-0001' });
    await set(`${L}/payments/pay2`, { tenantId: 'T2', propertyId: 'P1', amount: 3000, status: 'confirmed', by: 'landlord', receipt: 'LH-2026-0002' });
    await set(`${L}/payments/pay11`, { tenantId: 'T11', propertyId: 'P3', amount: 7500, status: 'confirmed', by: 'landlord', receipt: 'LH-2026-0003' });
    await set(`${L}/notices/N1`, { title: 'Water off Saturday', audience: 'P1' });
    await set(`${L}/notices/N2`, { title: 'Exams quiet hours', audience: 'P2' });
    await set(`${L}/notices/N3`, { title: 'Office closed Friday', audience: 'all' });
    await set(`${L}/requests/R1`, { tenantId: 'T2', propertyId: 'P1', text: 'Tap leaking', status: 'open' });
    await set(`${L}/requests/R11`, { tenantId: 'T11', propertyId: 'P3', text: 'Gate light', status: 'open' });
    await set(`${L}/activity/A1`, { text: 'Sent a notice', byPhone: PH.landlord });
    await set(`${L}/deductions/D1`, { amount: 400, reason: 'Repairs' });
    await set(`${L}/private/settings`, { reminders: { weekly: true } });
    await set(`${L}/counters/receipts`, { next: 4 });
  });
});

const as = {
  landlord: () => env.authenticatedContext(LANDLORD, { phone_number: PH.landlord }).firestore(),
  otherLandlord: () => env.authenticatedContext(OTHER_LANDLORD, { phone_number: PH.otherLandlord }).firestore(),
  tenant1: () => env.authenticatedContext('uidT1', { phone_number: PH.tenant1 }).firestore(),
  caretaker: () => env.authenticatedContext('uidC1', { phone_number: PH.caretaker }).firestore(),
  stranger: () => env.authenticatedContext('uidX', { phone_number: PH.stranger }).firestore(),
  nobody: () => env.unauthenticatedContext().firestore(),
};

/* ---------- Landlord ---------- */
test('landlord can read and change everything of their own', async () => {
  const db = as.landlord();
  await assertSucceeds(db.doc(L).get());
  await assertSucceeds(db.collection(`${L}/tenants`).get());
  await assertSucceeds(db.collection(`${L}/payments`).get());
  await assertSucceeds(db.doc(`${L}/tenants/T1`).update({ dueDay: 5 }));
  await assertSucceeds(db.doc(`${L}/payments/pay1`).update({ status: 'rejected' }));
  await assertSucceeds(db.doc(`${L}/private/settings`).get());
  await assertSucceeds(db.doc(`${L}/deductions/D1`).delete());
});

test('landlord profile must use their own phone and never hold NRC or TPIN', async () => {
  const db = as.landlord();
  await assertSucceeds(db.doc(L).set({ name: 'Haggai', phone: PH.landlord }));
  await assertFails(db.doc(L).set({ name: 'Haggai', phone: PH.landlord, nrc: '204518/10/1' }));
  await assertFails(db.doc(L).set({ name: 'Haggai', phone: PH.landlord, tpin: '1001234567' }));
  await assertFails(db.doc(L).set({ name: 'Haggai', phone: PH.landlord, passport: 'ZN123456' }));
  await assertFails(db.doc(L).set({ name: 'Haggai', phone: '+260970000000' }));
  await assertFails(db.doc(`${L}/tenants/T1`).update({ nrc: '1234/56/7' }));
});

test("a landlord can't see or touch another landlord's records", async () => {
  const db = as.otherLandlord();
  await assertFails(db.doc(L).get());
  await assertFails(db.doc(`${L}/tenants/T1`).get());
  await assertFails(db.collection(`${L}/payments`).get());
  await assertFails(db.doc(`${L}/tenants/T1`).update({ name: 'Hacked' }));
  await assertFails(db.doc(`landlords/${LANDLORD}`).set({ name: 'Take over', phone: PH.otherLandlord }));
});

/* ---------- Not signed in, or signed in but nobody's tenant ---------- */
test('someone not signed in can read and write nothing', async () => {
  const db = as.nobody();
  await assertFails(db.doc(L).get());
  await assertFails(db.doc(`${L}/tenants/T1`).get());
  await assertFails(db.doc(`${L}/payments/new`).set({ tenantId: 'T1', propertyId: 'P1', amount: 10, status: 'pending', by: 'tenant' }));
});

test("a signed-in stranger can't see a landlord's records", async () => {
  const db = as.stranger();
  await assertFails(db.doc(L).get());
  await assertFails(db.doc(`${L}/tenants/T1`).get());
  await assertFails(db.collection(`${L}/notices`).where('audience', '==', 'all').get());
  // …and can't make themselves a tenant.
  await assertFails(db.doc(`${L}/members/${PH.stranger}`).set({ phone: PH.stranger, role: 'tenant', refId: 'T1', propertyId: 'P1', unitId: 'U1' }));
});

/* ---------- Tenant ---------- */
test('a tenant finds their landlord by their own phone number', async () => {
  const db = as.tenant1();
  const snap = await assertSucceeds(db.collectionGroup('members').where('phone', '==', PH.tenant1).get());
  if (snap.size !== 1) throw new Error('expected one membership, got ' + snap.size);
  await assertFails(db.collectionGroup('members').where('phone', '==', PH.tenant2).get());
  await assertSucceeds(db.doc(L).get()); // landlord's name and phone
});

test('a tenant sees only their own tenancy, home and payments', async () => {
  const db = as.tenant1();
  await assertSucceeds(db.doc(`${L}/tenants/T1`).get());
  await assertFails(db.doc(`${L}/tenants/T2`).get());
  await assertSucceeds(db.doc(`${L}/units/U1`).get());
  await assertFails(db.doc(`${L}/units/U2`).get());
  await assertSucceeds(db.doc(`${L}/properties/P1`).get());
  await assertFails(db.doc(`${L}/properties/P3`).get());
  await assertSucceeds(db.collection(`${L}/payments`).where('tenantId', '==', 'T1').get());
  await assertFails(db.collection(`${L}/payments`).get());
  await assertFails(db.doc(`${L}/payments/pay2`).get());
  await assertFails(db.collection(`${L}/caretakers`).get());
  await assertFails(db.doc(`${L}/private/settings`).get());
  await assertFails(db.collection(`${L}/deductions`).get());
  await assertFails(db.collection(`${L}/activity`).get());
});

test('a tenant sees notices for their property and for everyone, not other properties', async () => {
  const db = as.tenant1();
  await assertSucceeds(db.collection(`${L}/notices`).where('audience', 'in', ['all', 'P1']).get());
  await assertSucceeds(db.doc(`${L}/notices/N1`).get());
  await assertSucceeds(db.doc(`${L}/notices/N3`).get());
  await assertFails(db.doc(`${L}/notices/N2`).get());
});

test('a tenant can report their own payment as waiting for confirmation, nothing more', async () => {
  const db = as.tenant1();
  const ok = { tenantId: 'T1', propertyId: 'P1', amount: 2000, status: 'pending', by: 'tenant', method: 'Zamtel Kwacha' };
  await assertSucceeds(db.collection(`${L}/payments`).add(ok));
  await assertFails(db.collection(`${L}/payments`).add({ ...ok, status: 'confirmed' }));
  await assertFails(db.collection(`${L}/payments`).add({ ...ok, tenantId: 'T2' }));
  await assertFails(db.collection(`${L}/payments`).add({ ...ok, receipt: 'LH-2026-9999' }));
  await assertFails(db.collection(`${L}/payments`).add({ ...ok, amount: -500 }));
  await assertFails(db.collection(`${L}/payments`).add({ ...ok, amount: '2000' }));
  await assertFails(db.doc(`${L}/payments/pay1`).update({ amount: 99999 }));
  await assertFails(db.doc(`${L}/payments/pay1`).delete());
});

test('a tenant can report a repair for their own home but not change repairs', async () => {
  const db = as.tenant1();
  const ok = { tenantId: 'T1', propertyId: 'P1', text: 'Door lock broken', status: 'open' };
  await assertSucceeds(db.collection(`${L}/requests`).add(ok));
  await assertFails(db.collection(`${L}/requests`).add({ ...ok, tenantId: 'T2' }));
  await assertFails(db.collection(`${L}/requests`).add({ ...ok, status: 'done' }));
  await assertFails(db.doc(`${L}/requests/R1`).get()); // T2's request
  await assertFails(db.doc(`${L}/requests/R1`).update({ status: 'done' }));
});

test("a tenant can't change their own tenancy or membership", async () => {
  const db = as.tenant1();
  await assertFails(db.doc(`${L}/tenants/T1`).update({ deposit: 0 }));
  await assertFails(db.doc(`${L}/members/${PH.tenant1}`).update({ refId: 'T2' }));
  await assertFails(db.doc(`${L}/counters/receipts`).update({ next: 5 }));
});

test('a tenant can add to the activity log under their own number only', async () => {
  const db = as.tenant1();
  await assertSucceeds(db.collection(`${L}/activity`).add({ text: 'Reported a payment', byPhone: PH.tenant1 }));
  await assertFails(db.collection(`${L}/activity`).add({ text: 'Pretending', byPhone: PH.landlord }));
});

/* ---------- Caretaker ---------- */
test('a caretaker sees only their assigned properties', async () => {
  const db = as.caretaker();
  await assertSucceeds(db.doc(`${L}/properties/P1`).get());
  await assertFails(db.doc(`${L}/properties/P3`).get());
  await assertSucceeds(db.doc(`${L}/tenants/T1`).get());
  await assertFails(db.doc(`${L}/tenants/T11`).get());
  await assertSucceeds(db.collection(`${L}/tenants`).where('propertyId', '==', 'P1').get());
  await assertFails(db.collection(`${L}/tenants`).get());
  await assertSucceeds(db.collection(`${L}/payments`).where('propertyId', '==', 'P1').get());
  await assertFails(db.doc(`${L}/payments/pay11`).get());
  await assertSucceeds(db.doc(`${L}/notices/N1`).get());
  await assertSucceeds(db.doc(`${L}/notices/N3`).get());
  await assertFails(db.doc(`${L}/notices/N2`).get());
  await assertFails(db.doc(`${L}/private/settings`).get());
  await assertFails(db.collection(`${L}/deductions`).get());
  await assertFails(db.collection(`${L}/activity`).get());
});

test('a caretaker can record cash only, for tenants in their properties', async () => {
  const db = as.caretaker();
  const ok = { tenantId: 'T1', propertyId: 'P1', amount: 500, status: 'confirmed', by: 'caretaker', method: 'Cash', receipt: 'LH-2026-0004' };
  await assertSucceeds(db.collection(`${L}/payments`).add(ok));
  await assertFails(db.collection(`${L}/payments`).add({ ...ok, method: 'MTN MoMo' }));
  await assertFails(db.collection(`${L}/payments`).add({ ...ok, tenantId: 'T11', propertyId: 'P3' }));
  await assertFails(db.collection(`${L}/payments`).add({ ...ok, tenantId: 'T11' })); // T11 isn't in P1
  await assertFails(db.doc(`${L}/payments/pay1`).update({ amount: 1 }));
  await assertFails(db.doc(`${L}/payments/pay1`).delete());
});

test('a caretaker can move a repair along but not rewrite it', async () => {
  const db = as.caretaker();
  await assertSucceeds(db.doc(`${L}/requests/R1`).update({ status: 'progress', updatedBy: 'Esther Mumba' }));
  await assertFails(db.doc(`${L}/requests/R1`).update({ text: 'Nothing wrong' }));
  await assertFails(db.doc(`${L}/requests/R1`).update({ status: 'deleted' }));
  await assertFails(db.doc(`${L}/requests/R11`).update({ status: 'done' })); // not their property
});

test('receipt numbers only ever go up by one', async () => {
  const db = as.caretaker();
  await assertSucceeds(db.doc(`${L}/counters/receipts`).update({ next: 5 }));
  await assertFails(db.doc(`${L}/counters/receipts`).update({ next: 4 }));
  await assertFails(db.doc(`${L}/counters/receipts`).update({ next: 50 }));
  await assertFails(as.tenant1().doc(`${L}/counters/receipts`).get());
});

test("a caretaker can't add members or change tenants", async () => {
  const db = as.caretaker();
  await assertFails(db.doc(`${L}/members/${PH.stranger}`).set({ phone: PH.stranger, role: 'tenant', refId: 'T1', propertyId: 'P1', unitId: 'U1' }));
  await assertFails(db.doc(`${L}/tenants/T1`).update({ name: 'Changed' }));
  await assertFails(db.doc(`${L}/caretakers/C1`).update({ propertyIds: ['P1', 'P3'] }));
});

/* ---------- Everything else ---------- */
test('collections that are not in the rules are closed', async () => {
  await assertFails(as.landlord().doc('anything/else').set({ x: 1 }));
  await assertFails(as.landlord().doc('anything/else').get());
});
