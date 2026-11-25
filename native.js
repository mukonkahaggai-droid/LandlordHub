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
  // Rent reminders for the landlord: notifications the phone shows by itself on the chosen days,
  // even when the app is closed or offline (Capacitor's Local Notifications plugin).
  var Ln = C.registerPlugin('LocalNotifications');
  var channelReady = null;
  function channel() {
    if (!channelReady) channelReady = Ln.createChannel({ id: 'rent', name: 'Rent reminders', description: 'When tenants’ rent is due or late', importance: 4, visibility: 0 }).catch(function () {});
    return channelReady;
  }
  var notify = {
    // Is showing notifications allowed? → 'granted' | 'denied' | 'prompt'
    status: function () { return Ln.checkPermissions().then(function (r) { return r.display; }); },
    allow: function () { return Ln.requestPermissions().then(function (r) { return r.display; }); },
    // items: [{ id, at (Date), title, body, extra }]. Replaces nothing: cancel first.
    schedule: function (items) {
      if (!items.length) return Promise.resolve();
      return channel().then(function () {
        return Ln.schedule({ notifications: items.map(function (x) {
          // Around 9:00 is fine for a reminder, so no "exact alarm" permission is needed (the Play Store
          // keeps that for alarm clocks and calendars, and asking for it would open a settings screen).
          return { id: x.id, title: x.title, body: x.body, largeBody: x.body, extra: x.extra || null, channelId: 'rent',
            isExactNotification: false, schedule: { at: x.at, allowWhileIdle: true } };
        }) });
      });
    },
    cancel: function (ids) { return ids.length ? Ln.cancel({ notifications: ids.map(function (id) { return { id: id }; }) }) : Promise.resolve(); },
    // Called with the notification's `extra` when the landlord taps it.
    onTap: function (fn) { return Ln.addListener('localNotificationActionPerformed', function (e) { fn((e && e.notification && e.notification.extra) || {}); }); },
  };
  window.LHNative = {
    platform: C.getPlatform(),
    status: function () { return Sms.status(); },
    enable: function () { return Sms.requestPermission(); },
    pending: function () { return Sms.getPending().then(function (r) { return r.messages || []; }); },
    onMessage: function (fn) { return Sms.addListener('smsReceived', fn); },
    notify: notify,
  };
})();
