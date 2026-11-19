/* Bridge to the Android app's SMS reader (see android/app/src/main/java/com/voltatech/landlordhub/).
   In a normal browser this does nothing: window.LHNative stays undefined and the app works as before.
   In the Android app it exposes:
     LHNative.status()        → { granted }   is SMS reading allowed?
     LHNative.enable()        → { granted }   asks the landlord once for permission
     LHNative.pending()       → [messages]    MoMo/Airtel SMS that arrived while the app was closed
     LHNative.inbox(sinceMs)  → [messages]    MoMo/Airtel SMS in the inbox since a time
     LHNative.onMessage(fn)                   called when one arrives while the app is open
   Each message is { from, body, date } — only "money received" messages are passed on. */
(function () {
  var C = window.Capacitor;
  if (!C || typeof C.isNativePlatform !== 'function' || !C.isNativePlatform()) return;
  var Sms = C.registerPlugin('SmsReader');
  window.LHNative = {
    platform: C.getPlatform(),
    status: function () { return Sms.status(); },
    enable: function () { return Sms.requestPermission(); },
    pending: function () { return Sms.getPending().then(function (r) { return r.messages || []; }); },
    inbox: function (since) { return Sms.readInbox({ since: since || 0 }).then(function (r) { return r.messages || []; }); },
    onMessage: function (fn) { return Sms.addListener('smsReceived', fn); },
  };
})();
