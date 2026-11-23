/* Landlord Hub — keeps a landlord's records in step between their devices (Phase 3).

   The app still works from its own copy of the records on the device (`state` in app.js), so it
   opens and works with no internet. When the landlord has signed in with their phone number and
   switched syncing on, this file:
     • sends every change to Firebase (only what changed, compared with what was last sent or seen),
     • listens for changes made on their other devices and puts them into the device's copy.
   Firebase keeps its own offline copy too, so changes made during load-shedding wait on the device
   and are sent when the signal comes back.

   Where records go: see docs/DATABASE.md. Who may read and write them: firestore.rules.
   The demo (Landlord / Tenant / Caretaker buttons) never uses this.

   window.LHSync:
     ready                      → true when Firebase's database code loaded
     remoteExists(uid)          → does this account already have records online?
     upload(uid, state, phone)  → first time: copy every record on this device online
     download(uid)              → read every record from online (to load onto a new device)
     start(uid, hooks)          → keep in step from now on. hooks: { get(), changed(), status(s) }
     push()                     → send whatever changed (app.js calls it after every save)
     stop()
     status                     → 'off' | 'connecting' | 'online' | 'offline' | 'error' */
(function () {
  var fb = window.firebase;
  if (!fb || !fb.firestore || !window.LHCloud || !window.LHCloud.ready) { window.LHSync = { ready: false, status: 'off' }; return; }

  var db = window.LHCloud.app.firestore();
  // Firebase's own offline copy, so writes made with no signal are kept and sent later.
  try { db.enablePersistence({ synchronizeTabs: true }).catch(function () {}); } catch (e) {}

  // The record lists that sync, one Firestore collection each, under landlords/{uid}/…
  var COLS = ['properties', 'units', 'tenants', 'caretakers', 'payments', 'notices', 'requests', 'messages', 'activity', 'deductions'];
  // Landlord-only settings kept together in landlords/{uid}/private/settings.
  var SETTINGS = ['reminders', 'remindedAt', 'receiptSeq', 'smsWaiting', 'version'];
  var BATCH = 400; // Firestore allows 500 writes per batch

  var uid = null, hooks = null, unsubs = [], shadow = {};
  var api = { ready: true, status: 'off' };
  function setStatus(s) { api.status = s; if (hooks && hooks.status) hooks.status(s); }

  /* ---------- Shaping records ---------- */
  // Same text for the same data, whatever order the fields come back in (to spot real changes).
  function stable(v) {
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().filter(function (k) { return v[k] !== undefined; }).map(function (k) { return JSON.stringify(k) + ':' + stable(v[k]); }).join(',') + '}';
    return JSON.stringify(v === undefined ? null : v);
  }
  var clean = function (o) { return JSON.parse(JSON.stringify(o)); };
  // 0961234567 ↔ +260961234567 (the rules check the landlord's phone against their sign-in)
  var intl = function (p) { var d = String(p || '').replace(/\D/g, ''); if (d.indexOf('260') === 0) d = d.slice(3); if (d.charAt(0) === '0') d = d.slice(1); return d ? '+260' + d : ''; };
  var local = function (p) { var d = String(p || '').replace(/\D/g, ''); if (d.indexOf('260') === 0) d = '0' + d.slice(3); return d; };

  // Fields the rules and other devices rely on: which property each record belongs to, and a
  // fixed order so lists come back in the same order on every device.
  function prepare(st) {
    var unitProp = {};
    (st.units || []).forEach(function (u) { unitProp[u.id] = u.propertyId; });
    var tenantProp = {};
    (st.tenants || []).forEach(function (t) { var p = unitProp[t.unitId] || ''; if (t.propertyId !== p) t.propertyId = p; tenantProp[t.id] = p; });
    (st.payments || []).forEach(function (p) { var q = tenantProp[p.tenantId] || ''; if (p.propertyId !== q) p.propertyId = q; });
    (st.requests || []).forEach(function (r) { var q = tenantProp[r.tenantId] || ''; if (r.propertyId !== q) r.propertyId = q; });
    COLS.forEach(function (c) {
      var list = st[c] || [], max = 0;
      list.forEach(function (x) { if (typeof x._o === 'number' && x._o > max) max = x._o; });
      list.forEach(function (x) { if (typeof x._o !== 'number') x._o = ++max; });
    });
  }
  // Messages a tenant wrote can only be sent from the tenant's own phone (Phase 4), so they stay local.
  var syncs = function (c, item) { return !(c === 'messages' && item.from === 'tenant'); };

  function landlordDoc(st, phone) {
    var L = st.landlord || {};
    return clean({ name: L.name || '', phone: intl(phone || L.phone), business: L.business || '', email: L.email || '', payout: L.payout || '', joined: L.joined || '' });
  }
  function settingsDoc(st) { var o = {}; SETTINGS.forEach(function (k) { if (st[k] !== undefined) o[k] = st[k]; }); return clean(o); }

  var base = function (u) { return db.collection('landlords').doc(u); };

  // Every document this device's records should have online, as { path → data }.
  function wanted(st, phone) {
    prepare(st);
    var out = {};
    out[''] = landlordDoc(st, phone);
    out['private/settings'] = settingsDoc(st);
    COLS.forEach(function (c) { (st[c] || []).forEach(function (x) { if (x && x.id && syncs(c, x)) out[c + '/' + x.id] = clean(x); }); });
    return out;
  }
  var refFor = function (path) { return path ? base(uid).collection(path.split('/')[0]).doc(path.split('/')[1]) : base(uid); };

  function commit(ops) {
    // Not awaited: with no signal Firebase keeps the writes on the device and sends them later.
    for (var i = 0; i < ops.length; i += BATCH) {
      var b = db.batch();
      ops.slice(i, i + BATCH).forEach(function (op) { if (op.del) b.delete(refFor(op.path)); else b.set(refFor(op.path), op.data); });
      b.commit().catch(function (e) { console.warn('Landlord Hub sync:', e); setStatus('error'); });
    }
  }

  /* ---------- First time on an account ---------- */
  api.remoteExists = function (u) { return base(u).get().then(function (d) { return d.exists; }); };

  api.upload = function (u, st, phone) {
    uid = u; shadow = {};
    var want = wanted(st, phone), ops = [];
    Object.keys(want).forEach(function (path) { ops.push({ path: path, data: want[path] }); shadow[path] = stable(want[path]); });
    // Wait for Firebase to confirm the first copy, so the landlord knows it's really online.
    var chunks = [];
    for (var i = 0; i < ops.length; i += BATCH) {
      var b = db.batch();
      ops.slice(i, i + BATCH).forEach(function (op) { b.set(refFor(op.path), op.data); });
      chunks.push(b.commit());
    }
    return Promise.all(chunks).then(function () { return ops.length; });
  };

  api.download = function (u) {
    var b = base(u), out = {};
    return Promise.all([b.get(), b.collection('private').doc('settings').get()].concat(COLS.map(function (c) { return b.collection(c).get(); })))
      .then(function (res) {
        var L = res[0].data() || {};
        out.landlord = { id: 'L1', name: L.name || '', phone: local(L.phone), business: L.business || '', email: L.email || '', payout: L.payout || '', joined: L.joined || '' };
        var S = res[1].exists ? res[1].data() : {};
        SETTINGS.forEach(function (k) { if (S[k] !== undefined) out[k] = S[k]; });
        COLS.forEach(function (c, i) {
          out[c] = res[i + 2].docs.map(function (d) { return d.data(); }).sort(function (x, y) { return (x._o || 0) - (y._o || 0); });
        });
        return out;
      });
  };

  /* ---------- Keeping in step ----------
     When a device opens, the online records win: every change a device makes is handed to
     Firebase straight away, and Firebase keeps it on the device until it is sent, so nothing
     made here is lost. Records missing online are only removed here once Firebase's server
     (not just the device's offline copy) confirms they are gone, so opening with no signal
     never empties the device. */
  var firstSeen = {}, serverSeen = {}, ready = false, orphans = {};
  var NEEDED = COLS.concat(['', 'private/settings']);

  api.push = function () {
    if (!uid || !hooks || !ready) return;
    var st = hooks.get(), want = wanted(st), ops = [];
    Object.keys(want).forEach(function (path) {
      if (orphans[path]) return; // waiting to hear whether it was deleted on another device
      var s = stable(want[path]);
      if (shadow[path] !== s) { ops.push({ path: path, data: want[path] }); shadow[path] = s; }
    });
    // Records deleted on this device are deleted online too.
    Object.keys(shadow).forEach(function (path) {
      if (path && path.indexOf('/') > 0 && path !== 'private/settings' && !(path in want)) { ops.push({ path: path, del: true }); delete shadow[path]; }
    });
    if (ops.length) commit(ops);
  };

  // A change arrived from Firebase (another device, or our own write coming back).
  function applyDoc(c, change) {
    var st = hooks.get(), d = change.doc, path = c + '/' + d.id;
    var list = st[c] = st[c] || [];
    var at = list.findIndex(function (x) { return x.id === d.id; });
    if (change.type === 'removed') {
      delete shadow[path]; delete orphans[path];
      if (at >= 0 && syncs(c, list[at])) { list.splice(at, 1); return true; }
      return false;
    }
    var data = d.data(), s = stable(data);
    delete orphans[path];
    if (shadow[path] === s && at >= 0) return false; // nothing new (usually our own change coming back)
    shadow[path] = s;
    if (at >= 0) { if (stable(list[at]) === s) return false; list[at] = data; return true; }
    // A new record: put it in its place in the list.
    var pos = list.findIndex(function (x) { return (x._o || 0) > (data._o || 0); });
    if (pos < 0) list.push(data); else list.splice(pos, 0, data);
    return true;
  }

  function arrived(key) {
    firstSeen[key] = true;
    if (ready || !NEEDED.every(function (k) { return firstSeen[k]; })) return;
    // Everything online has arrived (at least from the offline copy). Anything here that isn't
    // online yet is held back until the server confirms whether it was deleted elsewhere.
    ready = true;
    var want = wanted(hooks.get());
    Object.keys(want).forEach(function (path) { if (!(path in shadow)) orphans[path] = true; });
    api.push();
  }
  function serverConfirms(c, snap) {
    if (serverSeen[c] || snap.metadata.fromCache || !ready) return false;
    serverSeen[c] = true;
    var st = hooks.get(), list = st[c] || [], changed = false;
    for (var i = list.length - 1; i >= 0; i--) {
      var path = c + '/' + list[i].id;
      if (orphans[path]) { list.splice(i, 1); delete orphans[path]; changed = true; }
    }
    return changed;
  }

  api.start = function (u, h) {
    api.stop();
    uid = u; hooks = h; shadow = {}; firstSeen = {}; serverSeen = {}; orphans = {}; ready = false;
    setStatus('connecting');
    var b = base(uid);
    COLS.forEach(function (c) {
      unsubs.push(b.collection(c).onSnapshot({ includeMetadataChanges: true }, function (snap) {
        var changed = false;
        snap.docChanges().forEach(function (ch) { if (applyDoc(c, ch)) changed = true; });
        arrived(c);
        if (serverConfirms(c, snap)) changed = true;
        if (changed) hooks.changed();
        setStatus(snap.metadata.fromCache ? (navigator.onLine === false ? 'offline' : 'connecting') : (snap.metadata.hasPendingWrites ? 'sending' : 'online'));
      }, function (e) { console.warn('Landlord Hub sync:', e); setStatus('error'); }));
    });
    unsubs.push(b.onSnapshot(function (d) {
      if (d.exists) {
        var data = d.data(), s = stable(data);
        if (shadow[''] !== s) {
          shadow[''] = s;
          var st = hooks.get(), L = st.landlord = st.landlord || { id: 'L1' };
          ['name', 'business', 'email', 'payout', 'joined'].forEach(function (k) { L[k] = data[k] || ''; });
          L.phone = local(data.phone);
          // Our own write coming back changes nothing on screen; only redraw for real changes.
          hooks.changed();
        }
      }
      arrived('');
    }, function (e) { console.warn('Landlord Hub sync:', e); setStatus('error'); }));
    unsubs.push(b.collection('private').doc('settings').onSnapshot(function (d) {
      if (d.exists) {
        var data = d.data(), s = stable(data);
        if (shadow['private/settings'] !== s) {
          shadow['private/settings'] = s;
          var st = hooks.get(), prevSeq = st.receiptSeq || 0;
          SETTINGS.forEach(function (k) { if (data[k] !== undefined) st[k] = data[k]; });
          // Receipt numbers never go backwards, whichever device used the last one.
          st.receiptSeq = Math.max(prevSeq, Number(data.receiptSeq) || 0);
          hooks.changed();
        }
      }
      arrived('private/settings');
    }, function (e) { console.warn('Landlord Hub sync:', e); setStatus('error'); }));
    window.addEventListener('online', onNet); window.addEventListener('offline', onNet);
  };
  function onNet() { if (uid) setStatus(navigator.onLine ? 'connecting' : 'offline'); }

  api.stop = function () {
    unsubs.forEach(function (f) { try { f(); } catch (e) {} });
    unsubs = []; uid = null; hooks = null; shadow = {}; ready = false; orphans = {};
    window.removeEventListener('online', onNet); window.removeEventListener('offline', onNet);
    api.status = 'off';
  };

  // Logging out: remove Firebase's offline copy of the records from this device (they stay online).
  // Firebase must be shut down first, so the page reloads afterwards.
  api.forget = function () {
    api.stop();
    return db.terminate().then(function () { return db.clearPersistence(); }).catch(function (e) { console.warn('Landlord Hub sync:', e); });
  };

  window.LHSync = api;
})();
