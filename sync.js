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
  var COLS = ['properties', 'rooms', 'units', 'tenants', 'tenancies', 'caretakers', 'payments', 'notices', 'requests', 'messages', 'activity', 'deductions'];
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
    // A payment belongs to the property of the tenancy it was paid for (a tenant may have moved since).
    var tnProp = {};
    (st.tenancies || []).forEach(function (tn) { tnProp[tn.id] = tn.propertyId; });
    (st.payments || []).forEach(function (p) { var q = (p.tenancyId && tnProp[p.tenancyId]) || tenantProp[p.tenantId] || ''; if (p.propertyId !== q) p.propertyId = q; });
    (st.requests || []).forEach(function (r) { var q = tenantProp[r.tenantId] || ''; if (r.propertyId !== q) r.propertyId = q; });
    COLS.forEach(function (c) {
      var list = st[c] || [], max = 0;
      list.forEach(function (x) { if (typeof x._o === 'number' && x._o > max) max = x._o; });
      list.forEach(function (x) { if (typeof x._o !== 'number') x._o = ++max; });
    });
  }
  // A message a tenant wrote is created from the tenant's own phone. Once it is online, the
  // landlord's devices may only mark it as read; one written on this device stays here.
  var syncs = function (c, item) { return !(c === 'messages' && item.from === 'tenant') || (('messages/' + item.id) in shadow); };

  /* Who may sign in to this landlord's records: one entry per phone number (Phase 4).
     The rules use it to show a tenant only their home, and a caretaker only their properties. */
  function membersFor(st) {
    var unitProp = {}, out = {};
    (st.units || []).forEach(function (u) { unitProp[u.id] = u.propertyId; });
    (st.tenants || []).forEach(function (t) {
      var ph = intl(t.phone);
      if (t.ended || ph.length !== 13 || out[ph]) return;
      out[ph] = { phone: ph, role: 'tenant', refId: t.id, propertyId: unitProp[t.unitId] || '', unitId: t.unitId, tenancyId: t.tenancyId || '' };
    });
    (st.caretakers || []).forEach(function (c) {
      var ph = intl(c.phone);
      if (ph.length !== 13 || out[ph]) return;
      out[ph] = { phone: ph, role: 'caretaker', refId: c.id, propertyIds: (c.propertyIds || []).slice() };
    });
    return out;
  }

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
    var mem = membersFor(st);
    Object.keys(mem).forEach(function (ph) { out['members/' + ph] = mem[ph]; });
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
  var NEEDED = COLS.concat(['', 'private/settings', 'members']);

  api.push = function () {
    if (member) return memberPush();
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
      var drop = at >= 0 && syncs(c, list[at]);
      delete shadow[path]; delete orphans[path];
      if (drop) { list.splice(at, 1); return true; }
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
    Object.keys(want).forEach(function (path) { if (!(path in shadow) && path.indexOf('members/') !== 0) orphans[path] = true; });
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
    // The members list only needs to be known (what's online), not shown.
    unsubs.push(b.collection('members').onSnapshot(function (snap) {
      snap.docChanges().forEach(function (ch) {
        var path = 'members/' + ch.doc.id;
        if (ch.type === 'removed') delete shadow[path]; else shadow[path] = stable(ch.doc.data());
      });
      arrived('members');
    }, function (e) { console.warn('Landlord Hub sync:', e); setStatus('error'); }));
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
  function onNet() { if (uid || member) setStatus(navigator.onLine ? 'connecting' : 'offline'); }

  api.stop = function () {
    unsubs.forEach(function (f) { try { f(); } catch (e) {} });
    unsubs = []; uid = null; hooks = null; shadow = {}; ready = false; orphans = {}; member = null; memberData = {};
    window.removeEventListener('online', onNet); window.removeEventListener('offline', onNet);
    api.status = 'off';
  };

  /* ---------- Receipt numbers ----------
     Each of the landlord's devices reserves a small block of receipt numbers while online (a
     transaction on counters/receipts, so two devices can never get the same block) and uses them
     offline. Numbers may skip between devices, but never repeat. `hint` starts the counter the
     first time, above every receipt number already used. */
  api.reserveReceipts = function (count, hint) {
    if (!uid) return Promise.reject(new Error('Not syncing'));
    var ref = base(uid).collection('counters').doc('receipts');
    return db.runTransaction(function (tx) {
      return tx.get(ref).then(function (d) {
        var next = d.exists ? Number(d.data().next) || 1 : Math.max(1, Number(hint) || 1);
        var end = next + count;
        if (d.exists) tx.update(ref, { next: end }); else tx.set(ref, { next: end });
        return { from: next, to: end - 1 };
      });
    });
  };

  /* ---------- Tenants and caretakers (Phase 4) ----------
     A tenant or caretaker signs in with their own number. Their landlord's app lists that number
     under members/, so they can find the landlord and read only their share: a tenant their home,
     rent, receipts, notices, repairs and messages; a caretaker their properties. They can only
     write what the rules allow, so only those changes are sent. */
  api.findMemberships = function (phone) {
    return db.collectionGroup('members').where('phone', '==', intl(phone)).get().then(function (snap) {
      return snap.docs.map(function (d) { var m = d.data(); m.lid = d.ref.parent.parent.id; return m; });
    });
  };
  // Every place a member's share comes from: [list name, document or query].
  function memberSources(m) {
    var b = base(m.lid), q = [['landlord', b]], N = b.collection('notices');
    if (m.role === 'tenant') {
      q.push(['tenants', b.collection('tenants').doc(m.refId)]);
      q.push(['units', b.collection('units').doc(m.unitId)]);
      q.push(['properties', b.collection('properties').doc(m.propertyId)]);
      ['payments', 'requests', 'messages', 'tenancies'].forEach(function (c) { q.push([c, b.collection(c).where('tenantId', '==', m.refId)]); });
      ['all', m.propertyId, m.refId].forEach(function (a) { q.push(['notices', N.where('audience', '==', a)]); });
      q.push(['notices', N.where('audience', 'array-contains', m.refId)]);
    } else {
      q.push(['caretakers', b.collection('caretakers').doc(m.refId)]);
      q.push(['notices', N.where('audience', '==', 'all')]);
      (m.propertyIds || []).forEach(function (pid) {
        q.push(['properties', b.collection('properties').doc(pid)]);
        ['rooms', 'units', 'tenants', 'tenancies', 'payments', 'requests'].forEach(function (c) { q.push([c, b.collection(c).where('propertyId', '==', pid)]); });
        q.push(['notices', N.where('audience', '==', pid)]);
      });
    }
    return q;
  }
  var isDoc = function (ref) { return typeof ref.collection === 'function' && typeof ref.where !== 'function'; };
  function emptyShare() { var st = { version: 1, landlord: { id: 'L1', name: '', phone: '' }, reminders: {}, remindedAt: {}, receiptSeq: 0 }; COLS.forEach(function (c) { st[c] = []; }); return st; }
  function putLandlord(st, data) { st.landlord = { id: 'L1', name: data.name || '', phone: local(data.phone), business: data.business || '', email: data.email || '', payout: data.payout || '' }; }
  function upsert(list, data) {
    var at = list.findIndex(function (x) { return x.id === data.id; });
    if (at >= 0) { list[at] = data; return; }
    var pos = list.findIndex(function (x) { return (x._o || 0) > (data._o || 0); });
    if (pos < 0) list.push(data); else list.splice(pos, 0, data);
  }

  // Everything a member may see, read once (to open the app on their phone).
  api.downloadMember = function (m) {
    var src = memberSources(m), st = emptyShare();
    return Promise.all(src.map(function (s) { return s[1].get(); })).then(function (res) {
      res.forEach(function (r, i) {
        var col = src[i][0];
        if (col === 'landlord') { if (r.exists) putLandlord(st, r.data()); return; }
        if (isDoc(src[i][1])) { if (r.exists) upsert(st[col], r.data()); return; }
        r.docs.forEach(function (d) { upsert(st[col], d.data()); });
      });
      return st;
    });
  };

  var member = null, memberData = {};
  var MAY_CREATE = {
    tenant: { payments: function (x, m) { return x.tenantId === m.refId && x.status === 'pending' && x.by === 'tenant'; },
      requests: function (x, m) { return x.tenantId === m.refId && x.status === 'open'; },
      messages: function (x) { return x.from === 'tenant'; }, activity: function () { return true; } },
    caretaker: { payments: function (x) { return x.by === 'caretaker' && x.method === 'Cash' && x.status === 'confirmed'; },
      activity: function () { return true; } },
  };
  var MAY_CHANGE = { tenant: { messages: ['read'] }, caretaker: { requests: ['status', 'updatedAt', 'updatedBy'] } };

  function memberPush() {
    if (!member || !hooks || !ready) return;
    var st = hooks.get(), m = member, b = base(m.lid), ops = [], myPhone = intl(m.phone);
    var tenantProp = {};
    (st.tenants || []).forEach(function (t) { tenantProp[t.id] = t.propertyId; });
    Object.keys(MAY_CREATE[m.role]).concat(Object.keys(MAY_CHANGE[m.role])).forEach(function (c) {
      (st[c] || []).forEach(function (x) {
        if (!x || !x.id) return;
        var path = c + '/' + x.id;
        if (!(path in shadow)) {
          var ok = MAY_CREATE[m.role][c];
          if (!ok || !ok(x, m)) return;
          // What the rules expect on a new record from a member.
          if (c === 'payments' || c === 'requests') x.propertyId = m.role === 'tenant' ? m.propertyId : (tenantProp[x.tenantId] || x.propertyId || '');
          if (c === 'messages') { x.propertyId = m.propertyId; x.tenantId = m.refId; x.read = false; }
          if (c === 'activity') x.byPhone = myPhone;
          if (typeof x._o !== 'number') x._o = Date.now();
          var data = clean(x);
          ops.push(b.collection(c).doc(x.id).set.bind(b.collection(c).doc(x.id), data));
          shadow[path] = stable(data); memberData[path] = data;
          return;
        }
        // An existing record: send only the fields this person may change (e.g. "read").
        var allowed = (MAY_CHANGE[m.role] || {})[c] || [], old = memberData[path] || {}, upd = {}, any = false;
        allowed.forEach(function (k) { if (stable(x[k]) !== stable(old[k]) && x[k] !== undefined) { upd[k] = x[k]; any = true; } });
        if (!any) return;
        var merged = Object.assign({}, old, upd);
        ops.push(b.collection(c).doc(x.id).update.bind(b.collection(c).doc(x.id), upd));
        shadow[path] = stable(merged); memberData[path] = merged;
      });
    });
    ops.forEach(function (op) { op().catch(function (e) { console.warn('Landlord Hub sync:', e); setStatus('error'); }); });
  }

  api.startMember = function (m, h) {
    api.stop();
    member = m; hooks = h; shadow = {}; memberData = {}; ready = false;
    setStatus('connecting');
    var src = memberSources(m), pending = src.length;
    var settled = function () { if (--pending === 0) { ready = true; memberPush(); } };
    src.forEach(function (s) {
      var col = s[0], ref = s[1], first = true;
      var done = function () { if (first) { first = false; settled(); } };
      var fail = function (e) { console.warn('Landlord Hub sync:', e); setStatus('error'); done(); };
      if (col === 'landlord') {
        unsubs.push(ref.onSnapshot(function (d) { if (d.exists) { putLandlord(hooks.get(), d.data()); hooks.changed(); } done(); }, fail));
      } else if (isDoc(ref)) {
        unsubs.push(ref.onSnapshot(function (d) {
          var st = hooks.get(), list = st[col] = st[col] || [], path = col + '/' + d.id;
          if (d.exists) { var data = d.data(); if (shadow[path] !== stable(data)) { shadow[path] = stable(data); memberData[path] = data; upsert(list, data); hooks.changed(); } }
          else { var at = list.findIndex(function (x) { return x.id === d.id; }); if (at >= 0) { list.splice(at, 1); delete shadow[path]; hooks.changed(); } }
          done();
        }, fail));
      } else {
        unsubs.push(ref.onSnapshot({ includeMetadataChanges: true }, function (snap) {
          var st = hooks.get(), list = st[col] = st[col] || [], changed = false;
          snap.docChanges().forEach(function (ch) {
            var d = ch.doc, path = col + '/' + d.id, at = list.findIndex(function (x) { return x.id === d.id; });
            if (ch.type === 'removed') { if (at >= 0) { list.splice(at, 1); changed = true; } delete shadow[path]; delete memberData[path]; return; }
            var data = d.data(), sd = stable(data);
            memberData[path] = data;
            if (shadow[path] === sd && at >= 0) return;
            shadow[path] = sd;
            if (at < 0 || stable(list[at]) !== sd) { upsert(list, data); changed = true; }
          });
          if (changed) hooks.changed();
          setStatus(snap.metadata.fromCache ? (navigator.onLine === false ? 'offline' : 'connecting') : (snap.metadata.hasPendingWrites ? 'sending' : 'online'));
          done();
        }, fail));
      }
    });
    window.addEventListener('online', onNet); window.addEventListener('offline', onNet);
  };

  // Logging out: remove Firebase's offline copy of the records from this device (they stay online).
  // Firebase must be shut down first, so the page reloads afterwards.
  api.forget = function () {
    api.stop();
    return db.terminate().then(function () { return db.clearPersistence(); }).catch(function (e) { console.warn('Landlord Hub sync:', e); });
  };

  window.LHSync = api;
})();
