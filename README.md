# Landlord Hub

Rent management for Zambian landlords, caretakers and tenants. Mobile-first PWA, light on data, works offline.

**Live:** https://mukonkahaggai-droid.github.io/LandlordHub/

## Run it

```bash
node server.js
```

Then open http://localhost:5173. On the sign-in screen, pick **Landlord**, **Tenant** or **Caretaker** to explore with sample data, or enter any Zambian number and any 6-digit code.

No build step and no dependencies: plain HTML, CSS and JavaScript.

## Android app

The Android version reads the "money received" pop-ups from MTN MoMo, Airtel Money and Zamtel (no SMS permission) and takes each payment off the matching tenant's rent by itself. See [ANDROID.md](ANDROID.md) to build and install it.

## What's in this prototype

**Landlord**
- Dashboard: expected / received / outstanding / overdue, collection progress, 6-month chart
- Payments tenants reported (e.g. Zamtel) waiting for confirmation
- Needs attention: late tenants with one-tap WhatsApp/SMS reminders in English, Bemba or Nyanja
- Tenants: search, filters, full ledger per tenant, record payment (cash, MoMo, Airtel, Zamtel, bank), partial and advance rent
- Properties and units, including boarding houses billed per bed per term, service charges (water, ZESCO, security)
- Notices with templates: water/power, rent increase, late payment, notice to vacate
- Repairs, caretakers (limited permissions), automatic reminder schedule, activity log
- Reports: income by month and property, ZRA rental income estimate, CSV export, weekly WhatsApp summary
- Account & privacy: payout wallet, export or delete data. No NRC, passport or TPIN is ever asked for or stored

**Tenant**: balance and due date, Pay button (detects MTN / Airtel from the number and simulates the PIN prompt), "I paid another way" with proof, receipts, notices, repair requests.

**Caretaker**: record cash payments with instant receipts, see balances for assigned properties only.

## Files

| File | What it does |
|---|---|
| `core.js` | Dates, money, phone network detection, ledger maths, reminder text, sample data |
| `app.js` | Screens for each role, sheets, actions, routing |
| `styles.css` | Design system: one accent colour, neutral greys, status colours only for meaning |
| `sw.js` | Offline caching of the app shell |
| `cloud.js` | Sign-in with a phone number and SMS code (Firebase) |
| `sync.js` | Keeps a landlord's records in step between their devices (Firebase Firestore) |
| `server.js` | Tiny local preview server |

## Not real yet (needs a backend)

- Records are kept on each device and, for a landlord signed in with their phone number who turns it on (More → Your records online), synced through Firebase so all their devices show the same records. Tenants and caretakers using their own phones come in Phase 4
- Sign-in with a phone number and SMS code uses Firebase (project `landlord-hub-volta`, Zambian numbers only, a test number for development). The PIN and fingerprint step is still simulated, and records still live on each device until they move online
- MTN MoMo / Airtel Money payments are simulated; the real flow needs the Collections API and Airtel Open API with callbacks
- WhatsApp/SMS reminders open WhatsApp or the SMS app with the message filled in; automatic sending needs WhatsApp Business API and an SMS gateway
- Bemba and Nyanja wording, the privacy notice and the ZRA tax estimate are drafts to be checked by a native speaker, a lawyer and ZRA respectively
