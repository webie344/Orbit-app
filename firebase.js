/* =========================================================
   Halo — firebase.js
   Firebase Auth + Firestore + Cloudinary upload
   --
   FILL IN YOUR CREDENTIALS BELOW (3 places).
   ========================================================= */

/* ----------- 1. FIREBASE CONFIG ----------- */
/* Get this from Firebase Console > Project Settings > Your apps > Web app */
const firebaseConfig = {
  apiKey: "AIzaSyC9jF-ocy6HjsVzWVVlAyXW-4aIFgA79-A",
    authDomain: "crypto-6517d.firebaseapp.com",
    projectId: "crypto-6517d",
    storageBucket: "crypto-6517d.firebasestorage.app",
    messagingSenderId: "60263975159",
    appId: "1:60263975159:web:bd53dcaad86d6ed9592bf2"
};

/* ----------- 2. CLOUDINARY CONFIG ----------- */
/* In Cloudinary > Settings > Upload, create an UNSIGNED upload preset.
   Then put your cloud name and that preset name here. */
const cloudinaryConfig = {
  cloudName: "ddtdqrh1b",
  uploadPreset: "profile-pictures"
};

/* ----------- 3. (Optional) DEMO MODE ----------- */
/* If you haven't filled in Firebase yet, the app falls back to local mock
   data so you can preview the UI. Set this to false once Firebase is set. */
const DEMO_MODE_IF_UNCONFIGURED = true;

/* =========================================================
   App boot
   ========================================================= */
const Halo = (window.Halo = window.Halo || {});
Halo.config = { firebaseConfig, cloudinaryConfig };

const isFbConfigured = !firebaseConfig.apiKey.startsWith("YOUR_");
Halo.demoMode = !isFbConfigured && DEMO_MODE_IF_UNCONFIGURED;

let app, auth, db;
if (isFbConfigured) {
  app = firebase.initializeApp(firebaseConfig);
  auth = firebase.auth();
  db = firebase.firestore();
  // tighter session: log in stays per browser
  auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {});
}
Halo.fb = { app, auth, db };

/* =========================================================
   Cloudinary upload
   ========================================================= */
Halo.uploadImage = async function (file) {
  if (!file) return null;
  if (cloudinaryConfig.cloudName.startsWith("YOUR_")) {
    // Demo fallback: convert to data URL so previews work
    return await new Promise((res) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.readAsDataURL(file);
    });
  }
  const url = `https://api.cloudinary.com/v1_1/${cloudinaryConfig.cloudName}/auto/upload`;
  const fd = new FormData();
  fd.append("file", file);
  fd.append("upload_preset", cloudinaryConfig.uploadPreset);
  const res = await fetch(url, { method: "POST", body: fd });
  if (!res.ok) throw new Error("Cloudinary upload failed");
  const data = await res.json();
  return data.secure_url;
};

/* =========================================================
   Auth
   ========================================================= */
Halo.auth = {
  onChange(cb) {
    if (Halo.demoMode) {
      // Demo: pretend we're logged out at first
      const stored = localStorage.getItem("halo.demoUser");
      setTimeout(() => cb(stored ? JSON.parse(stored) : null), 50);
      Halo._demoAuthCb = cb;
      return;
    }
    auth.onAuthStateChanged(async (user) => {
      if (!user) return cb(null);
      const profile = await Halo.users.ensure(user);
      cb(profile);
    });
  },
  async signUp(email, password, displayName) {
    if (Halo.demoMode) return Halo._demoLogin({ displayName, email });
    const cred = await auth.createUserWithEmailAndPassword(email, password);
    await cred.user.updateProfile({ displayName });
    await Halo.users.create(cred.user, displayName);
    return cred.user;
  },
  async signIn(email, password) {
    if (Halo.demoMode) return Halo._demoLogin({ email, displayName: email.split("@")[0] });
    return auth.signInWithEmailAndPassword(email, password);
  },
  async signOut() {
    if (Halo.demoMode) {
      localStorage.removeItem("halo.demoUser");
      Halo._demoAuthCb && Halo._demoAuthCb(null);
      return;
    }
    return auth.signOut();
  },
  current() {
    if (Halo.demoMode) {
      const s = localStorage.getItem("halo.demoUser");
      return s ? JSON.parse(s) : null;
    }
    return auth.currentUser;
  }
};

Halo._demoLogin = function ({ email, displayName }) {
  const handle = (displayName || email.split("@")[0]).toLowerCase().replace(/\s+/g, "");
  const u = {
    uid: "me-" + handle,
    email,
    displayName: displayName || email.split("@")[0],
    photoURL: null,
    handle,
    bio: "",
    halo: false
  };
  localStorage.setItem("halo.demoUser", JSON.stringify(u));
  Halo._demoSeedIfEmpty(u);
  Halo._demoAuthCb && Halo._demoAuthCb(u);
  return u;
};

/* =========================================================
   Users
   ========================================================= */
Halo.users = {
  async create(user, displayName) {
    const handle = (displayName || user.email.split("@")[0])
      .toLowerCase().replace(/[^a-z0-9]/g, "");
    const data = {
      uid: user.uid,
      email: user.email,
      displayName,
      handle,
      photoURL: null,
      bio: "",
      halo: false,
      orbit: [],
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    await db.collection("users").doc(user.uid).set(data);
    return data;
  },
  async ensure(user) {
    if (Halo.demoMode) return Halo.auth.current();
    const ref = db.collection("users").doc(user.uid);
    const snap = await ref.get();
    if (snap.exists) return { uid: user.uid, ...snap.data() };
    return await Halo.users.create(user, user.displayName || user.email.split("@")[0]);
  },
  async get(uid) {
    if (Halo.demoMode) return Halo._demo.users.find((u) => u.uid === uid) || null;
    const snap = await db.collection("users").doc(uid).get();
    return snap.exists ? { uid, ...snap.data() } : null;
  },
  async getMany(uids) {
    if (!uids || !uids.length) return [];
    if (Halo.demoMode) return Halo._demo.users.filter((u) => uids.includes(u.uid));
    const out = await Promise.all(uids.map((id) => Halo.users.get(id)));
    return out.filter(Boolean);
  },
  async listAll() {
    if (Halo.demoMode) return Halo._demo.users;
    const snap = await db.collection("users").limit(50).get();
    return snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
  },
  async update(uid, patch) {
    if (Halo.demoMode) {
      const u = Halo._demo.users.find((x) => x.uid === uid);
      if (u) Object.assign(u, patch);
      const me = Halo.auth.current();
      if (me && me.uid === uid) {
        Object.assign(me, patch);
        localStorage.setItem("halo.demoUser", JSON.stringify(me));
      }
      Halo._saveDemo();
      return;
    }
    await db.collection("users").doc(uid).update(patch);
  },
  async grantHalo(uid) {
    return Halo.users.update(uid, { halo: true });
  },
  async toggleOrbit(meUid, otherUid) {
    if (Halo.demoMode) {
      const me = Halo._demo.users.find((u) => u.uid === meUid) || Halo.auth.current();
      me.orbit = me.orbit || [];
      const i = me.orbit.indexOf(otherUid);
      if (i >= 0) me.orbit.splice(i, 1); else me.orbit.push(otherUid);
      const stored = Halo.auth.current();
      if (stored && stored.uid === meUid) {
        stored.orbit = me.orbit;
        localStorage.setItem("halo.demoUser", JSON.stringify(stored));
      }
      Halo._saveDemo();
      return me.orbit.includes(otherUid);
    }
    const ref = db.collection("users").doc(meUid);
    const snap = await ref.get();
    const orbit = snap.data().orbit || [];
    const i = orbit.indexOf(otherUid);
    if (i >= 0) orbit.splice(i, 1); else orbit.push(otherUid);
    await ref.update({ orbit });
    return orbit.includes(otherUid);
  }
};

/* =========================================================
   Beams (posts)
   ========================================================= */
Halo.beams = {
  async list() {
    if (Halo.demoMode) {
      return [...Halo._demo.beams].sort((a, b) => b.createdAt - a.createdAt);
    }
    const snap = await db.collection("beams").orderBy("createdAt", "desc").limit(60).get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  },
  subscribe(cb) {
    if (Halo.demoMode) {
      cb([...Halo._demo.beams].sort((a, b) => b.createdAt - a.createdAt));
      Halo._demoBeamSub = cb;
      return () => { Halo._demoBeamSub = null; };
    }
    return db.collection("beams").orderBy("createdAt", "desc").limit(60)
      .onSnapshot((snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
  },
  async create({ authorId, text, image }) {
    const beam = {
      authorId, text, image: image || null,
      sparks: [], comments: [],
      createdAt: Halo.demoMode ? Date.now() : firebase.firestore.FieldValue.serverTimestamp()
    };
    if (Halo.demoMode) {
      const b = { id: "b" + Date.now(), ...beam };
      Halo._demo.beams.unshift(b);
      Halo._saveDemo();
      Halo._demoBeamSub && Halo._demoBeamSub([...Halo._demo.beams].sort((a, b) => b.createdAt - a.createdAt));
      return b;
    }
    const ref = await db.collection("beams").add(beam);
    return { id: ref.id, ...beam };
  },
  async toggleSpark(beamId, uid) {
    if (Halo.demoMode) {
      const b = Halo._demo.beams.find((x) => x.id === beamId);
      if (!b) return;
      const i = b.sparks.indexOf(uid);
      if (i >= 0) b.sparks.splice(i, 1); else b.sparks.push(uid);
      Halo._saveDemo();
      Halo._demoBeamSub && Halo._demoBeamSub([...Halo._demo.beams].sort((a, b) => b.createdAt - a.createdAt));
      return;
    }
    const ref = db.collection("beams").doc(beamId);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const sparks = snap.data().sparks || [];
      const i = sparks.indexOf(uid);
      if (i >= 0) sparks.splice(i, 1); else sparks.push(uid);
      tx.update(ref, { sparks });
    });
  },
  async addComment(beamId, comment) {
    const c = { id: "c" + Date.now() + Math.random().toString(36).slice(2, 5), ...comment, createdAt: Date.now() };
    if (Halo.demoMode) {
      const b = Halo._demo.beams.find((x) => x.id === beamId);
      if (!b) return;
      b.comments = b.comments || [];
      b.comments.push(c);
      Halo._saveDemo();
      Halo._demoBeamSub && Halo._demoBeamSub([...Halo._demo.beams].sort((a, b) => b.createdAt - a.createdAt));
      return c;
    }
    const ref = db.collection("beams").doc(beamId);
    await ref.update({ comments: firebase.firestore.FieldValue.arrayUnion(c) });
    return c;
  }
};

/* =========================================================
   Loops (videos)
   ========================================================= */
Halo.loops = {
  async list() {
    if (Halo.demoMode) return [...Halo._demo.loops];
    const snap = await db.collection("loops").orderBy("createdAt", "desc").limit(40).get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  },
  async toggleSpark(loopId, uid) {
    if (Halo.demoMode) {
      const l = Halo._demo.loops.find((x) => x.id === loopId);
      if (!l) return;
      const i = l.sparks.indexOf(uid);
      if (i >= 0) l.sparks.splice(i, 1); else l.sparks.push(uid);
      Halo._saveDemo();
      return;
    }
    const ref = db.collection("loops").doc(loopId);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const sparks = snap.data().sparks || [];
      const i = sparks.indexOf(uid);
      if (i >= 0) sparks.splice(i, 1); else sparks.push(uid);
      tx.update(ref, { sparks });
    });
  }
};

/* =========================================================
   Rooms (chats)
   ========================================================= */
Halo.rooms = {
  async list(uid) {
    if (Halo.demoMode) {
      return Halo._demo.rooms
        .filter((r) => r.memberIds.includes(uid))
        .sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0));
    }
    const snap = await db.collection("rooms")
      .where("memberIds", "array-contains", uid)
      .orderBy("lastAt", "desc")
      .limit(40).get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  },
  subscribe(uid, cb) {
    if (Halo.demoMode) {
      cb(Halo._demo.rooms.filter((r) => r.memberIds.includes(uid)).sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0)));
      Halo._demoRoomSub = cb;
      return () => { Halo._demoRoomSub = null; };
    }
    return db.collection("rooms")
      .where("memberIds", "array-contains", uid)
      .orderBy("lastAt", "desc")
      .onSnapshot((snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
  },
  async get(roomId) {
    if (Halo.demoMode) return Halo._demo.rooms.find((r) => r.id === roomId);
    const snap = await db.collection("rooms").doc(roomId).get();
    return snap.exists ? { id: roomId, ...snap.data() } : null;
  },
  subscribeOne(roomId, cb) {
    if (Halo.demoMode) {
      cb(Halo._demo.rooms.find((r) => r.id === roomId));
      Halo._demoRoomOneSub = { id: roomId, cb };
      return () => { Halo._demoRoomOneSub = null; };
    }
    return db.collection("rooms").doc(roomId).onSnapshot((s) =>
      s.exists ? cb({ id: roomId, ...s.data() }) : cb(null)
    );
  },
  async create({ name, emoji, cover, memberIds, theme }) {
    const room = {
      name, emoji: emoji || "✨", cover: cover || null,
      memberIds, pinned: false,
      theme: theme || { wallpaper: "aurora", bubbleColor: "#e7c07b", bubbleShape: "rounded" },
      messages: [],
      lastMessage: "",
      lastAt: Halo.demoMode ? Date.now() : firebase.firestore.FieldValue.serverTimestamp(),
      createdAt: Halo.demoMode ? Date.now() : firebase.firestore.FieldValue.serverTimestamp()
    };
    if (Halo.demoMode) {
      const r = { id: "r" + Date.now(), ...room, lastAt: Date.now(), createdAt: Date.now() };
      Halo._demo.rooms.unshift(r);
      Halo._saveDemo();
      Halo._demoRoomSub && Halo._demoRoomSub(Halo._demo.rooms.filter((rr) => rr.memberIds.includes(memberIds[0])).sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0)));
      return r;
    }
    const ref = await db.collection("rooms").add(room);
    return { id: ref.id, ...room };
  },
  async updateTheme(roomId, theme) {
    if (Halo.demoMode) {
      const r = Halo._demo.rooms.find((x) => x.id === roomId);
      if (r) { r.theme = theme; Halo._saveDemo(); Halo._demoRoomOneSub && Halo._demoRoomOneSub.cb(r); }
      return;
    }
    await db.collection("rooms").doc(roomId).update({ theme });
  },
  async sendMessage(roomId, msg) {
    const m = {
      id: "m" + Date.now() + Math.random().toString(36).slice(2, 5),
      ...msg,
      reactions: [],
      status: "sent",
      createdAt: Date.now()
    };
    if (Halo.demoMode) {
      const r = Halo._demo.rooms.find((x) => x.id === roomId);
      r.messages = r.messages || [];
      r.messages.push(m);
      r.lastMessage = m.text || (m.image ? "📷 Photo" : "");
      r.lastAt = Date.now();
      Halo._saveDemo();
      Halo._demoRoomOneSub && Halo._demoRoomOneSub.cb(r);
      Halo._demoRoomSub && Halo._demoRoomSub(Halo._demo.rooms.filter((rr) => rr.memberIds.includes(msg.authorId)).sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0)));

      // simulate delivered + seen + maybe a reply (demo only)
      setTimeout(() => Halo.rooms._setStatus(roomId, m.id, "delivered"), 600);
      setTimeout(() => Halo.rooms._setStatus(roomId, m.id, "seen"), 1500);
      Halo._maybeAutoReply(roomId, msg.authorId);
      return m;
    }
    const ref = db.collection("rooms").doc(roomId);
    await ref.update({
      messages: firebase.firestore.FieldValue.arrayUnion(m),
      lastMessage: m.text || (m.image ? "📷 Photo" : ""),
      lastAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    return m;
  },
  async _setStatus(roomId, msgId, status) {
    if (!Halo.demoMode) return;
    const r = Halo._demo.rooms.find((x) => x.id === roomId);
    if (!r) return;
    const m = r.messages.find((x) => x.id === msgId);
    if (m) m.status = status;
    Halo._saveDemo();
    Halo._demoRoomOneSub && Halo._demoRoomOneSub.cb(r);
  },
  async editMessage(roomId, msgId, newText) {
    if (Halo.demoMode) {
      const r = Halo._demo.rooms.find((x) => x.id === roomId);
      const m = r.messages.find((x) => x.id === msgId);
      if (m) { m.text = newText; m.editedAt = Date.now(); }
      Halo._saveDemo();
      Halo._demoRoomOneSub && Halo._demoRoomOneSub.cb(r);
      return;
    }
    const ref = db.collection("rooms").doc(roomId);
    const snap = await ref.get();
    const messages = snap.data().messages || [];
    const m = messages.find((x) => x.id === msgId);
    if (m) { m.text = newText; m.editedAt = Date.now(); }
    await ref.update({ messages });
  },
  async deleteMessage(roomId, msgId) {
    if (Halo.demoMode) {
      const r = Halo._demo.rooms.find((x) => x.id === roomId);
      r.messages = r.messages.filter((x) => x.id !== msgId);
      Halo._saveDemo();
      Halo._demoRoomOneSub && Halo._demoRoomOneSub.cb(r);
      return;
    }
    const ref = db.collection("rooms").doc(roomId);
    const snap = await ref.get();
    const messages = (snap.data().messages || []).filter((x) => x.id !== msgId);
    await ref.update({ messages });
  },
  async toggleReaction(roomId, msgId, emoji, uid) {
    if (Halo.demoMode) {
      const r = Halo._demo.rooms.find((x) => x.id === roomId);
      const m = r.messages.find((x) => x.id === msgId);
      m.reactions = m.reactions || [];
      let rx = m.reactions.find((x) => x.emoji === emoji);
      if (!rx) { rx = { emoji, userIds: [] }; m.reactions.push(rx); }
      const i = rx.userIds.indexOf(uid);
      if (i >= 0) rx.userIds.splice(i, 1); else rx.userIds.push(uid);
      m.reactions = m.reactions.filter((x) => x.userIds.length > 0);
      Halo._saveDemo();
      Halo._demoRoomOneSub && Halo._demoRoomOneSub.cb(r);
      return;
    }
    const ref = db.collection("rooms").doc(roomId);
    const snap = await ref.get();
    const messages = snap.data().messages || [];
    const m = messages.find((x) => x.id === msgId);
    m.reactions = m.reactions || [];
    let rx = m.reactions.find((x) => x.emoji === emoji);
    if (!rx) { rx = { emoji, userIds: [] }; m.reactions.push(rx); }
    const i = rx.userIds.indexOf(uid);
    if (i >= 0) rx.userIds.splice(i, 1); else rx.userIds.push(uid);
    m.reactions = m.reactions.filter((x) => x.userIds.length > 0);
    await ref.update({ messages });
  }
};

/* =========================================================
   Demo data (used until you fill in Firebase)
   ========================================================= */
Halo._demo = {
  users: [],
  beams: [],
  loops: [],
  rooms: []
};

Halo._saveDemo = function () {
  try {
    localStorage.setItem("halo.demo", JSON.stringify(Halo._demo));
  } catch (_) {}
};

Halo._loadDemo = function () {
  try {
    const s = localStorage.getItem("halo.demo");
    if (s) Halo._demo = JSON.parse(s);
  } catch (_) {}
};

Halo._maybeAutoReply = function (roomId, fromUid) {
  const r = Halo._demo.rooms.find((x) => x.id === roomId);
  if (!r) return;
  const others = r.memberIds.filter((id) => id !== fromUid);
  if (!others.length) return;
  const replier = others[Math.floor(Math.random() * others.length)];
  // typing indicator
  r._typing = replier;
  Halo._demoRoomOneSub && Halo._demoRoomOneSub.cb(r);
  setTimeout(() => {
    const replies = [
      "ah, that's it 🌙",
      "thinking the same.",
      "totally — say more about that?",
      "haha okay that hit",
      "noted. saving this one.",
      "💛",
      "bring it back to me tomorrow",
      "yes. yes yes yes.",
      "you would 😂",
      "oof. felt."
    ];
    const m = {
      id: "m" + Date.now() + Math.random().toString(36).slice(2, 5),
      authorId: replier,
      text: replies[Math.floor(Math.random() * replies.length)],
      reactions: [],
      status: "delivered",
      createdAt: Date.now()
    };
    r.messages.push(m);
    r.lastMessage = m.text;
    r.lastAt = Date.now();
    delete r._typing;
    Halo._saveDemo();
    Halo._demoRoomOneSub && Halo._demoRoomOneSub.cb(r);
    Halo._demoRoomSub && Halo._demoRoomSub(Halo._demo.rooms.filter((rr) => rr.memberIds.includes(fromUid)).sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0)));
  }, 1500 + Math.random() * 1500);
};

Halo._demoSeedIfEmpty = function (me) {
  Halo._loadDemo();
  if (Halo._demo.users.length > 0) {
    // Make sure "me" exists
    if (!Halo._demo.users.find((u) => u.uid === me.uid)) {
      Halo._demo.users.unshift({ ...me, orbit: me.orbit || ["u1", "u2", "u3", "u4", "u5"] });
      Halo._saveDemo();
    }
    return;
  }

  const av = (seed) => `https://api.dicebear.com/7.x/notionists/svg?seed=${encodeURIComponent(seed)}&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf`;

  const users = [
    { uid: "u1", displayName: "Aria Vance", handle: "aria", photoURL: av("Aria"), bio: "Late-night thinker. Tea over coffee.", halo: true, orbit: [] },
    { uid: "u2", displayName: "Sol Marin", handle: "sol", photoURL: av("Sol"), bio: "Surf, synths, and slow mornings.", halo: true, orbit: [] },
    { uid: "u3", displayName: "Nori Park", handle: "nori", photoURL: av("Nori"), bio: "Designing quiet things.", halo: false, orbit: [] },
    { uid: "u4", displayName: "Wren Castillo", handle: "wren", photoURL: av("Wren"), bio: "Photo + film. Often outside.", halo: true, orbit: [] },
    { uid: "u5", displayName: "Ivo Lange", handle: "ivo", photoURL: av("Ivo"), bio: "Composer. Long walks, longer phrases.", halo: false, orbit: [] },
    { uid: "u6", displayName: "Mira Okafor", handle: "mira", photoURL: av("Mira"), bio: "Building a bakery one loaf at a time.", halo: true, orbit: [] },
    { uid: "u7", displayName: "Theo Dane", handle: "theo", photoURL: av("Theo"), bio: "Reads more than he posts.", halo: false, orbit: [] },
    { uid: "u8", displayName: "Cleo Hart", handle: "cleo", photoURL: av("Cleo"), bio: "Color theorist with a complicated relationship to beige.", halo: true, orbit: [] }
  ];
  // Place "me" at front
  users.unshift({ ...me, orbit: ["u1", "u2", "u3", "u4", "u5"], photoURL: me.photoURL || av(me.displayName) });

  const now = Date.now();
  const m = (mins) => now - mins * 60_000;
  const h = (hours) => now - hours * 3_600_000;

  const beams = [
    { id: "b1", authorId: "u1", text: "found a tiny secondhand bookstore in Lisbon today. the owner stamps the inside cover with the date you bought it. i'm thinking about that more than i'd like to admit.", image: "https://images.unsplash.com/photo-1521587760476-6c12a4b040da?w=900", sparks: ["u2", "u4", me.uid], comments: [
      { id: "c1", authorId: "u4", text: "the date stamp is killing me 🥺", createdAt: m(35) },
      { id: "c2", authorId: "u2", text: "address?? please?", createdAt: m(20) }
    ], createdAt: m(45) },
    { id: "b2", authorId: "u2", text: "the ocean was glass at 6am. i didn't bring my board. didn't need to.", image: "https://images.unsplash.com/photo-1505142468610-359e7d316be0?w=900", sparks: ["u1", "u3", "u5", "u6", me.uid], comments: [], createdAt: h(2) },
    { id: "b3", authorId: "u3", text: "design decision of the day: removed every shadow from the app and added one back, very carefully, to one element. it changed everything.", sparks: ["u1", me.uid], comments: [
      { id: "c3", authorId: "u1", text: "this is the most designer thing i've ever read.", createdAt: h(3) }
    ], createdAt: h(4) },
    { id: "b4", authorId: "u6", text: "experimental sourdough loaf #47. crumb is finally where i want it. tasting notes: hazelnut, hay, light tang.", image: "https://images.unsplash.com/photo-1509440159596-0249088772ff?w=900", sparks: ["u1", "u2", "u3", "u4", "u7", "u8"], comments: [
      { id: "c4", authorId: "u8", text: "i want a slice mailed to me", createdAt: h(5) }
    ], createdAt: h(6) },
    { id: "b5", authorId: "u4", text: "shot a roll of expired Portra 800 in the rain. half the frames came back a deep magenta. keeping every single one.", image: "https://images.unsplash.com/photo-1516906571636-2cee79608d12?w=900", sparks: ["u1", "u2", "u3"], comments: [], createdAt: h(8) },
    { id: "b6", authorId: "u5", text: "the third movement is finally talking back to me. only took ten months.", sparks: ["u1", me.uid], comments: [], createdAt: h(11) },
    { id: "b7", authorId: "u7", text: "halfway through 'A Little Life'. recommend it to no one i love. unable to stop reading.", sparks: ["u1", "u8"], comments: [
      { id: "c5", authorId: "u8", text: "you've been warned and you went anyway", createdAt: h(13) }
    ], createdAt: h(14) },
    { id: "b8", authorId: "u8", text: "test print: a navy so dark it reads black until you put it next to actual black. obsessed.", image: "https://images.unsplash.com/photo-1557682250-33bd709cbe85?w=900", sparks: ["u1", "u3"], comments: [], createdAt: h(20) },
    { id: "b9", authorId: "u1", text: "two weeks of no notifications on this phone and i can hear my own thoughts again. wild what we let ourselves get used to.", sparks: ["u2", "u3", "u4", "u5", "u7"], comments: [], createdAt: h(26) },
    { id: "b10", authorId: "u3", text: "tiny ui win: replaced 'submit' with 'send it' and conversion went up 12%. words have weight.", sparks: ["u1", "u8"], comments: [], createdAt: h(32) }
  ];

  const loops = [
    { id: "l1", authorId: "u4", caption: "fog rolling in over the headlands.", videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4", posterUrl: "https://images.unsplash.com/photo-1494526585095-c41746248156?w=600", sparks: ["u1", "u2", me.uid], createdAt: h(2) },
    { id: "l2", authorId: "u2", caption: "morning paddle out. nobody around.", videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4", posterUrl: "https://images.unsplash.com/photo-1505142468610-359e7d316be0?w=600", sparks: ["u1", "u3", "u4"], createdAt: h(5) },
    { id: "l3", authorId: "u6", caption: "kneading dough is meditation.", videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4", posterUrl: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=600", sparks: ["u1"], createdAt: h(9) },
    { id: "l4", authorId: "u1", caption: "the bookstore i was talking about.", videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4", posterUrl: "https://images.unsplash.com/photo-1521587760476-6c12a4b040da?w=600", sparks: ["u2", "u3", "u4", me.uid], createdAt: h(13) },
    { id: "l5", authorId: "u5", caption: "writing the third movement, midnight.", videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4", posterUrl: "https://images.unsplash.com/photo-1465225314224-587cd83d322b?w=600", sparks: ["u1"], createdAt: h(20) }
  ];

  const rooms = [
    { id: "r1", name: "Late Night Thinkers", emoji: "🌙", cover: null, memberIds: [me.uid, "u1", "u3", "u5", "u7"], pinned: true,
      theme: { wallpaper: "aurora", bubbleColor: "#e7c07b", bubbleShape: "rounded" },
      messages: [
        { id: "m1", authorId: "u1", text: "anyone else awake?", reactions: [], status: "seen", createdAt: m(45) },
        { id: "m2", authorId: "u5", text: "always.", reactions: [{ emoji: "🌙", userIds: ["u1", me.uid] }], status: "seen", createdAt: m(44) },
        { id: "m3", authorId: "u3", text: "i'm sketching. send me something to think about.", reactions: [], status: "seen", createdAt: m(42) },
        { id: "m4", authorId: "u1", text: "okay: when did 'minimal' become a synonym for 'forgettable'?", reactions: [{ emoji: "🔥", userIds: [me.uid, "u5"] }], status: "seen", createdAt: m(40) },
        { id: "m5", authorId: me.uid, text: "around 2018 i think.", reactions: [], status: "seen", replyToId: "m4", createdAt: m(39) },
        { id: "m6", authorId: "u5", text: "ha.", reactions: [], status: "seen", createdAt: m(38) },
        { id: "m7", authorId: "u3", text: "okay i'm going to design something brave tomorrow", reactions: [{ emoji: "💛", userIds: ["u1", me.uid] }], status: "seen", createdAt: m(35) }
      ], lastMessage: "okay i'm going to design something brave tomorrow", lastAt: m(35), createdAt: h(48) },

    { id: "r2", name: "Aria", emoji: "🌿", cover: null, memberIds: [me.uid, "u1"], pinned: false,
      theme: { wallpaper: "paper", bubbleColor: "#8a7cff", bubbleShape: "rounded" },
      messages: [
        { id: "m10", authorId: "u1", text: "did you see the bookstore beam?", reactions: [], status: "seen", createdAt: h(3) },
        { id: "m11", authorId: me.uid, text: "yes! send me the address?", reactions: [], status: "seen", createdAt: h(3) },
        { id: "m12", authorId: "u1", text: "sending tomorrow morning, it deserves a proper letter not a text.", reactions: [{ emoji: "❤️", userIds: [me.uid] }], status: "seen", createdAt: h(3) }
      ], lastMessage: "sending tomorrow morning, it deserves a proper letter not a text.", lastAt: h(3), createdAt: h(50) },

    { id: "r3", name: "Bread Heads", emoji: "🥖", cover: null, memberIds: [me.uid, "u6", "u8", "u2"], pinned: false,
      theme: { wallpaper: "forest", bubbleColor: "#6bd29a", bubbleShape: "pill" },
      messages: [
        { id: "m20", authorId: "u6", text: "loaf 47. i think i did it.", reactions: [{ emoji: "🤤", userIds: [me.uid, "u8", "u2"] }], status: "seen", createdAt: h(6) },
        { id: "m21", authorId: "u8", text: "the crumb. mira. THE CRUMB.", reactions: [], status: "seen", createdAt: h(6) },
        { id: "m22", authorId: "u2", text: "post the recipe or i riot", reactions: [], status: "seen", createdAt: h(5) }
      ], lastMessage: "post the recipe or i riot", lastAt: h(5), createdAt: h(72) },

    { id: "r4", name: "Sol", emoji: "🌊", cover: null, memberIds: [me.uid, "u2"], pinned: false,
      theme: { wallpaper: "ocean", bubbleColor: "#5a90c8", bubbleShape: "rounded" },
      messages: [
        { id: "m30", authorId: "u2", text: "swell tomorrow at 6am, want in?", reactions: [], status: "seen", createdAt: h(8) },
        { id: "m31", authorId: me.uid, text: "if i'm awake, i'm awake.", reactions: [], status: "seen", createdAt: h(8) }
      ], lastMessage: "if i'm awake, i'm awake.", lastAt: h(8), createdAt: h(80) },

    { id: "r5", name: "Slow Studio", emoji: "🎨", cover: null, memberIds: [me.uid, "u3", "u4", "u8"], pinned: false,
      theme: { wallpaper: "rose", bubbleColor: "#d97a8c", bubbleShape: "rounded" },
      messages: [
        { id: "m40", authorId: "u3", text: "anyone else feeling design fatigue right now?", reactions: [{ emoji: "🙋", userIds: ["u4", "u8", me.uid] }], status: "seen", createdAt: h(10) },
        { id: "m41", authorId: "u8", text: "i needed a week off the grid before color started feeling like color again.", reactions: [], status: "seen", createdAt: h(10) },
        { id: "m42", authorId: "u4", text: "going to shoot film with no plan this weekend. cure for everything.", reactions: [], status: "seen", createdAt: h(9) }
      ], lastMessage: "going to shoot film with no plan this weekend. cure for everything.", lastAt: h(9), createdAt: h(120) }
  ];

  Halo._demo.users = users;
  Halo._demo.beams = beams;
  Halo._demo.loops = loops;
  Halo._demo.rooms = rooms;
  Halo._saveDemo();
};
