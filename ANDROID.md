# Landlord Hub — Android app

The Android app is the same Landlord Hub, wrapped with [Capacitor](https://capacitorjs.com), plus one extra:
it **reads the "money received" pop-ups from MTN MoMo, Airtel Money and Zamtel and takes the payment off the tenant's rent by itself**.

It does **not** ask for SMS permission and never opens the messages inbox. It only sees the pop-up notifications of the phone's messages app, once the landlord turns on *Notification access* for it.

## How automatic payments work

1. You add a tenant with their phone number, and any **other lines** they pay from.
2. The tenant pays the way they already know: `*303#` (or Airtel / Zamtel) → Send Money → your number → amount → PIN. No reference, no code, no app needed on their side.
3. MTN, Airtel or Zamtel sends **you** an SMS, and your phone shows its pop-up: *"You have received ZMW 3,000 from 0977…"*.
4. Landlord Hub sees that pop-up. It only acts when:
   - the pop-up comes from the phone's own messages app (not any other app), and
   - the sender is named MoMo, MTN, Airtel or Zamtel (not a phone number, so a text typed on someone's phone is ignored), and
   - the message says money was **received**.
5. It reads the amount and the number that sent the money. If that number is **exactly** one of a tenant's saved lines, the amount is taken off what that tenant owes (part payments, full payments, and extra as advance rent) and a receipt is made. **Nothing pops up**: you see it on the tenant's page and in the activity log.
6. Money from a number that isn't saved for any tenant is **not** taken off anyone's rent. It waits quietly on the **More** page under *Automatic MoMo, Airtel and Zamtel payments*, where you can choose who paid (that number is then saved for next time) or clear the list.

If the app is closed when the pop-up arrives, the payment is kept on the phone and recorded the moment the app is opened.

**Things that stop a payment being picked up:**
- If you have that MoMo / Airtel conversation open on screen when the SMS arrives, the messages app shows no pop-up, so there is nothing to read. Use *Record from a payment SMS* for that one.
- If you have turned off notifications for the messages app, or for MoMo / Airtel in it.
- The same payment is never recorded twice (it checks the transaction ID).

## One-time setup on this laptop

1. Install **Android Studio** (free) from https://developer.android.com/studio. Open it once and let it finish installing the Android SDK. You accept Google's licence there.
2. In the project folder, run:

   ```bash
   npm install
   ```

### This laptop (already set up)

- Android Studio: `D:\Android\Android Studio` (shortcut on the Desktop)
- Android SDK: `C:\Users\DELL\AppData\Local\Android\Sdk`
- Build files: `D:\Android\.gradle` (set with the `GRADLE_USER_HOME` variable)
- The project uses **Gradle 9.1**, because Android Studio comes with Java 25, which older Gradle can't run on.

Build from the command line without opening Android Studio:

```bash
npm run android:sync
```

```bash
cd android
```

```bash
gradlew.bat assembleDebug
```

The app file appears in `android\app\build\outputs\apk\debug\app-debug.apk`. A copy for phones is kept in `builds\Landlord-Hub-test.apk`; with `node server.js` running, a phone on the same Wi-Fi can download it from `http://192.168.1.177:5173/builds/Landlord-Hub-test.apk`.

## Build and install

1. Copy the latest app into the Android project:

   ```bash
   npm run android:sync
   ```

2. Open it in Android Studio:

   ```bash
   npm run android:open
   ```

   Wait for "Gradle sync" to finish (the first time takes a few minutes).

3. Put it on your phone, either way:
   - **With a cable:** on the phone, turn on *Developer options → USB debugging*, plug it in, and press the green **Run ▶** button in Android Studio.
   - **As a file:** *Build → Build App Bundle(s) / APK(s) → Build APK(s)*. Send the `app-debug.apk` it makes to your phone (WhatsApp or USB) and open it. Allow "install unknown apps" when asked.

4. In the app: sign in as the landlord → **More → Automatic MoMo, Airtel and Zamtel payments → Turn on**. The phone's **Notification access** screen opens: switch on **Landlord Hub**, confirm, and go back to the app.
   - On Android 13 and newer, an app installed from a file may show *"Restricted setting"* instead. Go to *Settings → Apps → Landlord Hub → ⋮ (top right) → Allow restricted settings*, then try again.

5. Test it: from another phone, send K1 by MoMo to the landlord's number, from a number saved as one of a tenant's lines. Don't have the MoMo conversation open. The K1 should come off that tenant's balance on its own.

Every time you change the web app (`app.js`, `styles.css` …), run `npm run android:sync` again before building.

## Testing sign-in and syncing on a real phone

Use the test numbers in `local/firebase-test-login.txt` (they never send an SMS). Tick each one off:

1. **Sign in in the Android app** with the landlord test number. Google may show a picture check: finish
   it and tap Verify. *If the picture check never appears, spins forever or says "not allowed", note
   exactly what it shows: that would mean the app needs the Android sign-in add-on.*
2. **Load my online records** when asked. The same tenants as on the laptop appear.
3. **Change something on the phone** (a tenant's name) and see it on the laptop within seconds; then
   the other way round.
4. **Airplane mode**, record a cash payment, switch airplane mode off: it reaches the laptop.
5. **Receipt numbers:** record one payment on the phone and one on the laptop. They never share a
   number (each device reserves its own block, so numbers may jump, e.g. 0126 then 0146).
6. **Close the app fully and reopen it:** still signed in, still syncing (More → Your records online
   says "Up to date").
7. **Tenant and caretaker:** log out, sign in with the test tenant number, then the caretaker number;
   each sees only their own share.
8. **Payment pop-up** (needs a real K1 MoMo payment): see "How automatic payments work" above.

## Things to know

- **Google Play:** the app no longer uses SMS permissions, which Google rarely allows. Notification access is allowed, but Google will ask you to explain in the Play Console why the app needs it ("to record rent payments from mobile money notifications"). The most reliable route later is still the MTN MoMo / Airtel Money payment APIs.
- **iPhone:** Apple never lets apps read other apps' notifications or SMS, so this only works on Android.
- **Real messages:** the reader was written from the usual MTN, Airtel and Zamtel wording. If a real payment ends up in the "not saved" list or isn't picked up, check the sender name your messages app shows; it must contain MoMo, MTN, Airtel or Zamtel (see `TRUSTED_SENDER` in `SmsStore.java` and `app.js`). Check it with a few real "money received" messages and adjust `LH.parseMoneySms` in `core.js` if any are missed.
- **One phone:** records are still kept on the phone. Before several landlords or caretakers share data, the app needs the shared online database.
- **Release version:** for a signed release APK, use *Build → Generate Signed App Bundle / APK* and keep the keystore file safe — you need the same one for every update.

## Files

| File | What it does |
|---|---|
| `native.js` | Bridge between the app and the Android payment reader (does nothing in a browser) |
| `android/app/src/main/java/com/voltatech/landlordhub/PaymentNotificationListener.java` | Sees the messages app's pop-ups, keeps only MoMo / Airtel / Zamtel "money received" ones |
| `android/.../SmsStore.java` | Trusted sender names, and holds payments until the app opens |
| `android/.../SmsReaderPlugin.java` | Opens the Notification access screen and hands payments to the app |
| `android/app/src/main/AndroidManifest.xml` | The notification reader, Share → Landlord Hub |
| `scripts/build-www.js` | Copies the web app into `www/` for Android |
| `capacitor.config.json` | App name and ID (`com.voltatech.landlordhub`) |
