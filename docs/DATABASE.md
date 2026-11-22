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
  properties/{id}                       name, area, kind
  units/{id}                            propertyId, label, rent, service, serviceName, period
  tenants/{id}                          name, phone, unitId, propertyId, since, dueDay, every, deposit, lang, lines
  caretakers/{id}                       name, phone, propertyIds
  payments/{id}                         tenantId, propertyId, amount, date, method, ref, status, by, byName, receipt, smsKey
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
   (a collection-group query). Each one tells it which landlord, and which tenancy or properties.

## Things to settle in Phase 3

- **Changing phones:** a landlord's records are tied to their sign-in account. Signing in with the same
  number on a new phone gives the same account, so the records follow them.
- **Receipt numbers:** take the next number from `counters/receipts` in a transaction when online.
  Offline, the app needs a temporary receipt number that is swapped for a real one when it syncs.
- **Rent references:** a reference is worked out from the landlord's own payment records, so a tenant can't type
  it in. Today a future landlord checks it by calling the landlord named on it and quoting its code (`R-…`).
  Once records are online, a read-only `references/{code}` record could let them check it by link instead.
- **One phone, several landlords:** a tenant who rents from two landlords has two `members` records.
  The app needs a "choose landlord" step for that case.
