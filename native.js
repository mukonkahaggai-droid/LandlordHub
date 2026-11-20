/* Bridge to the Android app's payment reader (see android/app/src/main/java/com/voltatech/landlordhub/).
   In a normal browser this does nothing: window.LHNative stays undefined and the app works as before.
   The Android app never reads the SMS inbox. With Notification access turned on, it looks only at the
   pop-ups of the phone's messages app, and passes on only MTN MoMo / Airtel Money / Zamtel
   "money received" ones. It exposes:
     LHNative.status()        → { granted }   is Notification access on?
     LHNative.enable()        → { granted }   opens the phone's Notification access screen
     LHNative.pending()       → [messages]    payments that arrived while the app was closed
     LHNative.onMessage(fn)                   called when one arrives while the app is open
   Each message is { from, body, date }. */
(function () {
  var C = window.Capacitor;
  if (!C || typeof C.isNativePlatform !== 'function' || !C.isNativePlatform()) return;
  var Sms = C.registerPlugin('SmsReader');
  window.LHNative = {
    platform: C.getPlatform(),
    status: function () { return Sms.status(); },
    enable: function () { return Sms.requestPermission(); },
    pending: function () { return Sms.getPending().then(function (r) { return r.messages || []; }); },
    onMessage: function (fn) { return Sms.addListener('smsReceived', fn); },
  };
})();
