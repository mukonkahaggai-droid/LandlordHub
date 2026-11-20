/* Landlord Hub — online sign-in with Firebase (phone number + one-time SMS code).
   Phase 1: only sign-in is online. Records still live on the device (see app.js); they move
   online in Phase 3. The demo buttons on the sign-in screen never touch Firebase.

   The Firebase code is kept in vendor/firebase/ (not loaded from Google), so the app still opens
   with no internet. Signing in needs internet once; after that the PIN or fingerprint is used.

   window.LHCloud:
     ready                 → true when Firebase loaded and is set up
     sendCode(phone)       → texts a code to a Zambian number like 0961234567
     confirmCode(code)     → checks the 6-digit code; resolves with { uid, phone }
     user()                → the signed-in person, or null
     signOut()
   Errors are thrown as Error objects whose message can be shown to the person as is. */
(function () {
  var fb = window.firebase, cfg = window.LH_FIREBASE;
  if (!fb || !cfg || !fb.auth) { window.LHCloud = { ready: false }; return; }

  var app = fb.apps.length ? fb.app() : fb.initializeApp(cfg);
  var auth = app.auth();
  auth.languageCode = 'en';

  var verifier = null, pending = null;

  // Google's robot check, needed for phone sign-in on websites. It is invisible most of the time.
  function getVerifier() {
    if (verifier) return verifier;
    var holder = document.getElementById('recaptcha');
    if (!holder) { holder = document.createElement('div'); holder.id = 'recaptcha'; document.body.appendChild(holder); }
    // A fresh box every time: Google's check can't be drawn twice in the same box.
    var box = document.createElement('div');
    holder.innerHTML = '';
    holder.appendChild(box);
    verifier = new fb.auth.RecaptchaVerifier(box, { size: 'invisible' }, app);
    return verifier;
  }
  function resetVerifier() {
    try { if (verifier) verifier.clear(); } catch (e) {}
    verifier = null;
    var box = document.getElementById('recaptcha');
    if (box) box.innerHTML = '';
  }

  // Firebase error codes → words a landlord or tenant understands.
  function friendly(err) {
    var code = (err && err.code) || '';
    var msg = {
      'auth/invalid-phone-number': 'That phone number doesn\'t look right. Check it and try again.',
      'auth/missing-phone-number': 'Enter your phone number.',
      'auth/too-many-requests': 'Too many tries from this phone. Wait a while, then try again.',
      'auth/quota-exceeded': 'Sign-in codes are not available right now. Try again later.',
      'auth/invalid-verification-code': 'That code doesn\'t match. Check it and try again.',
      'auth/code-expired': 'That code has expired. Tap “Use a different number” and ask for a new one.',
      'auth/missing-verification-code': 'Enter the 6-digit code.',
      'auth/network-request-failed': 'No internet connection. Connect and try again.',
      'auth/captcha-check-failed': 'The security check didn\'t work. Try again.',
      'auth/operation-not-allowed': 'Phone sign-in isn\'t switched on yet. Use the demo for now.',
      'auth/unauthorized-domain': 'Sign-in isn\'t allowed from this address yet. Use the demo for now.',
      'auth/billing-not-enabled': 'Sign-in codes by SMS aren\'t switched on yet. Use the demo for now.',
    }[code];
    if (code === 'auth/operation-not-allowed' && /region/i.test(err.message || '')) msg = 'Sign-in codes can only be sent to Zambian numbers.';
    if (!code && window.console) console.warn('Landlord Hub sign-in:', err);
    var e = new Error(msg || 'Something went wrong signing in. Try again.');
    e.code = code;
    return e;
  }

  // 0961234567 → +260961234567
  function intl(phone) {
    var d = String(phone || '').replace(/\D/g, '');
    if (d.indexOf('260') === 0) d = d.slice(3);
    if (d.charAt(0) === '0') d = d.slice(1);
    return '+260' + d;
  }

  window.LHCloud = {
    ready: true,
    sendCode: function (phone) {
      if (navigator.onLine === false) return Promise.reject(Object.assign(new Error('You need internet to get a sign-in code. Connect and try again.'), { code: 'offline' }));
      // If Google's picture check is closed or left unfinished, Firebase never answers, so give up
      // after two minutes and let the person try again instead of waiting forever.
      var timer;
      var giveUp = new Promise(function (_, reject) {
        timer = setTimeout(function () {
          reject(Object.assign(new Error('The picture check wasn\'t finished, so no code was sent. Tap “Send me a code” to try again.'), { code: 'timeout' }));
        }, 120000);
      });
      return Promise.race([auth.signInWithPhoneNumber(intl(phone), getVerifier()), giveUp])
        .then(function (c) { clearTimeout(timer); pending = c; })
        .catch(function (err) { clearTimeout(timer); resetVerifier(); throw err && err.code === 'timeout' ? err : friendly(err); });
    },
    confirmCode: function (code) {
      if (!pending) return Promise.reject(Object.assign(new Error('Ask for a new code first.'), { code: 'no-pending' }));
      return pending.confirm(String(code || '').trim())
        .then(function (r) { pending = null; resetVerifier(); return { uid: r.user.uid, phone: r.user.phoneNumber }; })
        .catch(function (err) { throw friendly(err); });
    },
    user: function () {
      var u = auth.currentUser;
      return u ? { uid: u.uid, phone: u.phoneNumber } : null;
    },
    signOut: function () { pending = null; return auth.signOut().catch(function () {}); },
  };
})();
