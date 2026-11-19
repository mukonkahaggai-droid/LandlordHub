# Landlord Hub — Android app

The Android app is the same Landlord Hub, wrapped with [Capacitor](https://capacitorjs.com), plus one extra:
it **reads MTN MoMo and Airtel Money "money received" SMS and records the rent by itself**.

## How automatic payments work

1. You add a tenant with their phone number, and any **other lines** they pay from.
2. The tenant pays the way they already know: `*303#` (or Airtel) → Send Money → your number → amount → PIN. No reference, no code, no app needed on their side.
3. MTN or Airtel sends **you** an SMS: *"You have received ZMW 3,000 from 0977…"*.
4. The app reads the amount and the sender's number, finds the tenant with that line, and **takes the money off what they owe** — part payments, full payments, and extra as advance rent.
5. A receipt is made. You see *"Rent received by MoMo / Airtel"* with a **Thank** button that sends the tenant a WhatsApp thank-you with their balance.
6. Money from a number that isn't saved for any tenant shows under **Needs you**: you choose who paid, and that number is remembered for next time.

If the app is closed when the SMS arrives, you get a notification (*"K3,000 received"*), and the payment is recorded the moment you open the app.

**Only "money received" messages are read.** Every other SMS is ignored and never stored or sent anywhere. Messages from before you switched the feature on are not used, so nothing you recorded by hand is counted twice. The same payment is never recorded twice (it checks the transaction ID).

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

4. In the app: sign in as the landlord → **More → Automatic payment SMS → Turn on** → allow **SMS** and **notifications**.

5. Test it: from another phone, send K1 by MoMo to the landlord's number, from a number saved as one of a tenant's lines. The payment should appear on its own.

Every time you change the web app (`app.js`, `styles.css` …), run `npm run android:sync` again before building.

## Things to know

- **Google Play:** Google only lets the phone's main SMS app use SMS permissions, so an app like this is very likely to be refused on the Play Store. Install it from the APK file instead. For the Play Store later, the safe route is the MTN MoMo / Airtel Money payment APIs.
- **iPhone:** Apple never lets apps read SMS, so this only works on Android.
- **Real messages:** the reader was written from the usual MTN and Airtel wording. Check it with a few real "money received" messages and adjust `LH.parseMoneySms` in `core.js` if any are missed.
- **One phone:** records are still kept on the phone. Before several landlords or caretakers share data, the app needs the shared online database.
- **Release version:** for a signed release APK, use *Build → Generate Signed App Bundle / APK* and keep the keystore file safe — you need the same one for every update.

## Files

| File | What it does |
|---|---|
| `native.js` | Bridge between the app and the Android SMS reader (does nothing in a browser) |
| `android/app/src/main/java/com/voltatech/landlordhub/SmsReceiver.java` | Catches incoming SMS, keeps only "money received" ones |
| `android/.../SmsStore.java` | Holds them until the app opens; shows the "K… received" notification |
| `android/.../SmsReaderPlugin.java` | Asks for permission and hands messages to the app |
| `android/app/src/main/AndroidManifest.xml` | SMS and notification permissions, the SMS receiver, Share → Landlord Hub |
| `scripts/build-www.js` | Copies the web app into `www/` for Android |
| `capacitor.config.json` | App name and ID (`com.voltatech.landlordhub`) |
