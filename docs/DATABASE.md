# Landlord Hub — online database (Firestore)

Firebase project `landlord-hub-volta`, Firestore database `(default)` in **africa-south1 (Johannesburg)**.

Who can do what is decided by [`firestore.rules`](../firestore.rules), which Google's servers enforce.
The rules are tested on this laptop with Firebase's emulator, never against the real database:

```bash
npm run test:rules
```

The emulator needs Java. On this laptop, use Android Studio's: set `JAVA_HOME` to `D:\Android\Android Studio\jbr` first.

## Layout

Everything a landlord owns sits under one record named after their sign-in account (`uid`).
That is also how the rules know whose records they are.

```
landlords/{landlordUid}                 name, phone (+260…), business, email, payout
  members/{+260phone}                   who else may sign in to these records
  properties/{id}                       name, area, kind (flats | boarding | shops | house)
  rooms/{id}                            propertyId, name
  units/{id}                            a space in a room: propertyId, roomId, spaceNo, label, rent, service,
                                        serviceName, period, rates: [{ from, rent, service }] (rent changes and when)
  tenants/{id}                          the person: name, phone, lines, lang — plus a copy of their current
                                        tenancy (tenancyId, unitId, propertyId, since, dueDay, every, deposit, ended)
  tenancies/{id}                        one person in one space: tenantId, name, phone, propertyId, roomId, unitId,
                                        spaceNo, moveIn, moveOut (null while they live there), chargeFrom/chargeTo
                                        (which rent periods it pays for, when they differ), dueDay, every, deposit,
                                        space (a copy of the space's name and rent, so history survives deletions)
  caretakers/{id}                       name, phone, propertyIds
  payments/{id}                         tenantId, tenancyId, propertyId (of that tenancy), amount, date, method, ref,
                                        status, by, byName, receipt, smsKey
  notices/{id}                          title, body, audience ('all' or a propertyId), channels, date
  requests/{id}                         tenantId, propertyId, category, text, status (open | progress | done), date
  messages/{id}                         tenantId, propertyId, from (tenant | landlord), about ('rent', a notice id or null),
                                        promise (a date the tenant says they'll pay, or null), text (max 500), date, at, read
  activity/{id}                         date, who, byPhone, text
  deductions/{id}                       amount, reason, propertyId, date, note
  private/settings                      reminders, remindedAt
  counters/receipts                     next (the next receipt number)
```

Ids are the same ones the app already uses (`P1`, `T1`, `pay…`), so moving records online keeps every link.

### Properties, rooms, spaces and tenancies

- A property has **rooms**; a room has one or more **spaces** (`units`). A flat or shop is a room with one
  space; a boarding room has a space per bed. Adding a property asks for its name, location and type, then
  how many rooms and how many people each takes.
- A **tenancy** is one person in one space for a stretch of time. Rent is charged per tenancy, at that
  space's rent at the time, and every payment is tied to the tenancy it was paid during.
- **Moving** ends the old tenancy and starts a new one; the new space is theirs straight away and its rent
  starts at the next rent period, so nothing is charged twice and past months keep their old rent.
- **Leaving** ends the tenancy (the month they leave is charged, as before). **Coming back** is a new tenancy
  on the same person, starting at the first period not already charged; all their history stays with them.
- A person's balance is worked out across all their tenancies, oldest first, so arrears from an old room
  aren't lost when they move.
- Older saved records are moved over automatically (`LH.migrate` in `core.js`): every tenant gets one
  tenancy, payments get its id, boarding houses' houses become rooms, and each flat or shop becomes a room.

### Fields the app must add when saving (they are not in the device records today)

- `tenants.propertyId`, `payments.propertyId` and `requests.propertyId`: copied from the tenant's unit.
  The rules use them to show a caretaker only their own properties.
- `members/{phone}`: one per tenant or caretaker who may sign in.
  - Tenant: `{ phone, role: 'tenant', refId: tenantId, propertyId, unitId }`
  - Caretaker: `{ phone, role: 'caretaker', refId: caretakerId, propertyIds: [...] }`

  The landlord's app writes these whenever a tenant or caretaker is added, moved or removed.

### No ID numbers, anywhere

Landlord Hub keeps **names and phone numbers only**. It never asks for, shows or stores an NRC, passport or TPIN,
on the phone or online. Older versions of the app could save them, so the app wipes any it finds when it opens.
As a backstop, the rules refuse any record that contains `nrc`, `nrcVerified`, `passport` or `tpin`.

## Who can do what

| | Landlord | Caretaker | Tenant |
|---|---|---|---|
| Landlord profile | read, change | read | read |
| Properties, units | everything | read their assigned properties | read their own home |
| Rooms | everything | read at their properties | nothing |
| Tenancies | everything | read at their properties | read all of their own (including past ones) |
| Tenants | everything | read tenants in their properties | read their own record |
| Payments | everything | read for their properties; **add cash only**, confirmed, with a receipt | read their own; **report** a payment as *waiting for confirmation* |
| Notices | everything | read for their properties and "all" | read for their property and "all" |
| Repairs | everything | read for their properties; change **only the status** | read their own; report a new one |
| Messages | read all, write to any tenant, mark tenants' messages read | nothing | read their own conversation, write to their landlord, mark the landlord's messages read |
| Activity log | everything | add entries under their own number | add entries under their own number |
| Deductions, settings | everything | nothing | nothing |
| Receipt counter | read, +1 | read, +1 | nothing |
| Members | everything | see their own | see their own |

A person who isn't signed in, or is signed in but isn't the landlord or one of their members, gets nothing.

## Signing in and finding your records

1. Sign in with a phone number (Firebase phone sign-in, Zambian numbers only).
2. **Landlord:** their records are at `landlords/{their uid}`.
3. **Tenant or caretaker:** the app asks for `members` documents whose `phone` is their own number
   (a collection-group query, which needs the index in [`firestore.indexes.json`](../firestore.indexes.json)).
   Each one tells it which landlord, and which tenancy or properties. With more than one (a tenant of two
   landlords, or a landlord who is also someone's tenant), they choose which records to open.
4. If the number isn't on any landlord's list, they're treated as a landlord with their own records.

## Tenants and caretakers on their own phones (Phase 4)

- **Who may sign in** is published by the landlord's app as `members/{+260…}`, worked out from their
  tenants and caretakers every time it syncs. Ending a tenancy or removing a caretaker removes the entry,
  so that number loses access.
- **What a tenant's phone reads:** the landlord's profile, their own tenant record, home (unit and
  property), their payments, repairs and messages, and notices for everyone, their property, or them
  (alone or in a list).
- **What a caretaker's phone reads:** the landlord's profile, their caretaker record, and for each
  property they look after: the property, its units, tenants, payments, repairs and notices.
- **What they send:** a tenant reports payments (waiting for the landlord to confirm), repairs and
  messages, and marks the landlord's messages read. A caretaker records **cash** payments with their own
  receipt series (their initials, e.g. `LH-2026-EMQH-0001`) and changes a repair's status from their **Repairs** tab. Both add activity entries under their
  own number. Nothing else is sent, and the rules would refuse it anyway.
- **Paying from the tenant app:** until the MTN MoMo / Airtel Money payment systems are connected, "Pay"
  shows the landlord's number and the \*303# / \*778# steps; the landlord's Android app records the
  payment from the MoMo message.
- **Invites:** once the landlord's records are online, the invite is a plain link to the app with
  "sign in with your number". The older invite links still work for a landlord who isn't syncing.
- **Logging out** removes the share and Firebase's offline copy from the tenant's or caretaker's phone.

## How syncing works (Phase 3, `sync.js`)

- The app keeps working from its own copy of the records on the device. When a landlord signed in with
  their phone number turns syncing on (More → Your records online), every save sends only what changed,
  and changes from their other devices arrive and appear by themselves.
- **First device:** "Move these records online" copies everything up (or "Start online with no records").
  **Another device:** signing in with the same number offers "Load my online records".
- **Offline:** Firebase keeps changes on the device and sends them when the signal returns.
- **When a device opens, the online records win.** Every change a device makes is handed to Firebase
  straight away and kept on the device until sent, so nothing is lost. A record missing online is only
  removed from the device once Firebase's server (not just the offline copy) confirms it is gone.
- **Logging out** removes the records and Firebase's offline copy from the device; they stay online.
- Every record gets `_o` (its place in the list) so lists come back in the same order on every device.
- A message a tenant wrote is created from the tenant's own phone; the landlord's devices can only mark it read.
- The demo never syncs.

## Still to settle

- **Receipt numbers (done):** each of the landlord's devices reserves a block of 20 numbers from
  `counters/receipts` in a transaction while online and uses them offline, so two devices never give out
  the same number (numbers may skip). A device that runs out while offline adds a short device tag
  (`LH-2026-0125-WNK`). Caretakers use their own series. A landlord who isn't syncing keeps one running
  number on their device.
- **Rent references:** a reference is worked out from the landlord's own payment records, so a tenant can't type
  it in. Today a future landlord checks it by calling the landlord named on it and quoting its code (`R-…`).
  Once records are online, a read-only `references/{code}` record could let them check it by link instead.
- **Tenants on several phones:** members are found by the tenant's main phone number only; the extra
  lines a landlord saves for MoMo matching don't give sign-in access.
