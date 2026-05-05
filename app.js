// =========================================================================
// Orbit — app.js
// Firebase init + Auth + Cloudinary + Router + Feed + Reels + Groups +
// Profile + Settings + Theme + Verified-by-location.
// Chat + DM logic lives in chat.js (it imports state from this file).
// =========================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut, GoogleAuthProvider,
  signInWithPopup, updateProfile,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  getFirestore, doc, setDoc, getDoc, updateDoc, addDoc, deleteDoc,
  collection, query, where, orderBy, limit, onSnapshot, getDocs,
  serverTimestamp, increment, arrayUnion, arrayRemove, writeBatch,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

// =========================================================================
// 1. CONFIG — REPLACE THESE BEFORE HOSTING
// =========================================================================

// Firebase: get from https://console.firebase.google.com → Project Settings → Your apps
export const firebaseConfig = {
  apiKey: "AIzaSyC9jF-ocy6HjsVzWVVlAyXW-4aIFgA79-A",
    authDomain: "crypto-6517d.firebaseapp.com",
    projectId: "crypto-6517d",
    storageBucket: "crypto-6517d.firebasestorage.app",
    messagingSenderId: "60263975159",
    appId: "1:60263975159:web:bd53dcaad86d6ed9592bf2"
};

// Cloudinary: get from https://cloudinary.com → Settings → Upload → Upload presets
// 1) Create an UNSIGNED preset (recommended for client-side uploads)
// 2) Put your cloud name + the preset name below
export const cloudinaryConfig = {
  cloudName:    "ddtdqrh1b",
  uploadPreset: "profile-pictures",
};

// =========================================================================
// 2. INIT
// =========================================================================
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Globals shared with chat.js
export const state = {
  me: null,           // current user profile doc (from /users/{uid})
  uid: null,          // current uid
  chatsUnsub: null,   // unsubscribe for chats list listener
  chatUnsub: null,    // unsubscribe for active chat messages listener
  activeChat: null,   // currently open chat doc id
  cache: {
    users: new Map(), // uid -> profile snapshot
  },
};

// =========================================================================
// 3. UTILITIES
// =========================================================================
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const _cloudPoster = (url) => {
  try { return url.replace(/\.mp4(\?.*)?$/, ".jpg").replace(/\.webm(\?.*)?$/, ".jpg").replace(/\.mov(\?.*)?$/, ".jpg"); }
  catch { return ""; }
};
const buildVideoPlayer = (url) => {
  const poster = _cloudPoster(url);
  const video = el("video", { src: url, poster, preload: "metadata", playsinline: "" });
  const playIcon  = el("i", { class: "ri-play-fill" });
  const overlay   = el("div", { class: "vp-overlay" }, el("button", { class: "vp-big-play" }, playIcon));
  const playSmI   = el("i", { class: "ri-play-fill" });
  const playSmBtn = el("button", { class: "vp-btn" }, playSmI);
  const played    = el("div", { class: "vp-played" });
  const seek      = el("div", { class: "vp-seek" }, played);
  const timeEl    = el("span", { class: "vp-time", text: "0:00" });
  const muteI     = el("i", { class: "ri-volume-up-line" });
  const muteBtn   = el("button", { class: "vp-btn" }, muteI);
  const fullBtn   = el("button", { class: "vp-btn" }, el("i", { class: "ri-fullscreen-line" }));
  const bar       = el("div", { class: "vp-bar" }, playSmBtn, seek, timeEl, muteBtn, fullBtn);
  const wrap      = el("div", { class: "vid-player" }, video, overlay, bar);
  const togglePlay = () => { video.paused ? video.play() : video.pause(); };
  overlay.onclick = togglePlay;
  playSmBtn.onclick = (e) => { e.stopPropagation(); togglePlay(); };
  video.addEventListener("play",  () => { playIcon.className = playSmI.className = "ri-pause-fill"; overlay.classList.add("playing"); });
  video.addEventListener("pause", () => { playIcon.className = playSmI.className = "ri-play-fill";  overlay.classList.remove("playing"); });
  video.addEventListener("ended", () => { playIcon.className = playSmI.className = "ri-play-fill";  overlay.classList.remove("playing"); played.style.width = "0%"; });
  video.addEventListener("timeupdate", () => {
    const pct = video.duration ? (video.currentTime / video.duration) * 100 : 0;
    played.style.width = pct + "%";
    const s = Math.floor(video.currentTime);
    timeEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  });
  seek.onclick = (e) => { if (!video.duration) return; const r = seek.getBoundingClientRect(); video.currentTime = ((e.clientX - r.left) / r.width) * video.duration; };
  muteBtn.onclick = (e) => { e.stopPropagation(); video.muted = !video.muted; muteI.className = video.muted ? "ri-volume-mute-line" : "ri-volume-up-line"; };
  fullBtn.onclick = (e) => { e.stopPropagation(); (video.requestFullscreen || video.webkitRequestFullscreen || (() => {})).call(video); };
  return wrap;
};
export const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (k === "data") for (const [dk, dv] of Object.entries(v)) node.dataset[dk] = dv;
    else if (v === true) node.setAttribute(k, "");
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
};

export const fmtTime = (ts) => {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const diffDays = Math.floor((now - d) / 86400000);
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
};

export const fmtDay = (ts) => {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.floor((today - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7) return d.toLocaleDateString([], { weekday: "long" });
  return d.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
};

export const escapeHtml = (s = "") =>
  s.replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));

export const linkify = (s = "") =>
  escapeHtml(s)
    .replace(/(https?:\/\/[^\s]+)/g, (m) => `<a href="${m}" target="_blank" rel="noopener">${m}</a>`)
    .replace(/#([A-Za-z][\w]*)/g, (_, tag) => `<a class="hashtag" href="#explore/tag/${tag}">#${tag}</a>`)
    .replace(/@(\w+)/g, (_, u) => `<a class="mention" href="#profile-u/${u}">@${u}</a>`);

export const extractHashtags = (s = "") => {
  const matches = s.match(/#(\w+)/g);
  return matches ? [...new Set(matches.map((m) => m.slice(1).toLowerCase()))] : [];
};

export const toast = (msg, ms = 2200) => {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add("hidden"), ms);
};

export const avatarFor = (u) =>
  u?.photoURL || `https://api.dicebear.com/7.x/shapes/svg?seed=${encodeURIComponent(u?.uid || u?.username || "x")}`;

export const fetchUser = async (uid) => {
  if (!uid) return null;
  if (state.cache.users.has(uid)) return state.cache.users.get(uid);
  const snap = await getDoc(doc(db, "users", uid));
  const data = snap.exists() ? { uid, ...snap.data() } : null;
  if (data) state.cache.users.set(uid, data);
  return data;
};

// =========================================================================
// 4. CLOUDINARY UPLOAD
// =========================================================================
export const uploadToCloudinary = async (file, kind = "image") => {
  if (!file) return null;
  if (cloudinaryConfig.cloudName.startsWith("YOUR_")) {
    toast("Cloudinary not configured — set cloudName + uploadPreset in app.js");
    throw new Error("Cloudinary not configured");
  }
  const url = `https://api.cloudinary.com/v1_1/${cloudinaryConfig.cloudName}/${kind === "video" ? "video" : "image"}/upload`;
  const fd = new FormData();
  fd.append("file", file);
  fd.append("upload_preset", cloudinaryConfig.uploadPreset);
  const res = await fetch(url, { method: "POST", body: fd });
  if (!res.ok) throw new Error("Upload failed");
  const json = await res.json();
  // Strip undefined fields — Firestore rejects them
  const out = { url: json.secure_url, publicId: json.public_id, type: kind };
  if (json.width)    out.width    = json.width;
  if (json.height)   out.height   = json.height;
  if (json.duration) out.duration = json.duration; // only present for video
  return out;
};

// =========================================================================
// 5. THEME
// =========================================================================
const applyTheme = (theme) => {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("orbit:theme", theme);
  $("#themeToggle")?.querySelector("i")?.classList.toggle("ri-sun-line", theme === "dark");
  $("#themeToggle")?.querySelector("i")?.classList.toggle("ri-moon-line", theme === "light");
};
const initTheme = () => applyTheme(localStorage.getItem("orbit:theme") || "dark");
const toggleTheme = () =>
  applyTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");

// =========================================================================
// 6. AUTH FLOW
// =========================================================================
const showAuth = () => { $("#auth").classList.remove("hidden"); $("#app").classList.add("hidden"); $("#boot").classList.add("hidden"); };
const showApp  = () => { $("#auth").classList.add("hidden"); $("#app").classList.remove("hidden"); $("#boot").classList.add("hidden"); };

const ensureUserDoc = async (user, extras = {}) => {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    const username = (extras.username || (user.email?.split("@")[0]) || `u${Date.now()}`).toLowerCase().replace(/[^a-z0-9_]/g, "");
    const profile = {
      uid: user.uid,
      name: extras.name || user.displayName || username,
      username,
      email: user.email || null,
      photoURL: user.photoURL || `https://api.dicebear.com/7.x/shapes/svg?seed=${user.uid}`,
      bio: "",
      verified: false,                // becomes true after location grant
      verifiedAt: null,
      location: null,                 // { lat, lng, city }
      followers: [],
      following: [],
      themePref: "dark",
      online: true,
      lastSeen: serverTimestamp(),
      createdAt: serverTimestamp(),
    };
    await setDoc(ref, profile);
    return profile;
  }
  // mark online + lastSeen
  await updateDoc(ref, { online: true, lastSeen: serverTimestamp() });
  return { uid: user.uid, ...snap.data(), online: true };
};

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    state.me = null; state.uid = null;
    showAuth();
    return;
  }
  state.uid = user.uid;
  state.me = await ensureUserDoc(user);
  $("#meAvatar").src = avatarFor(state.me);
  showApp();
  startMyProfileListener();
  startNotifListener();
  startSuggestions();
  router(); // initial route
  watchOfflineOnUnload();
  // Notify chat module
  document.dispatchEvent(new CustomEvent("orbit:auth-ready", { detail: state.me }));
});

const watchOfflineOnUnload = () => {
  const off = async () => {
    try { await updateDoc(doc(db, "users", state.uid), { online: false, lastSeen: serverTimestamp() }); } catch {}
  };
  window.addEventListener("beforeunload", off);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") off();
    else if (state.uid) updateDoc(doc(db, "users", state.uid), { online: true, lastSeen: serverTimestamp() }).catch(() => {});
  });
};

const startMyProfileListener = () => {
  return onSnapshot(doc(db, "users", state.uid), (snap) => {
    if (snap.exists()) {
      state.me = { uid: state.uid, ...snap.data() };
      $("#meAvatar").src = avatarFor(state.me);
    }
  });
};

// Auth UI bindings
$$(".auth-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    $$(".auth-tab").forEach((t) => t.classList.toggle("active", t === tab));
    const which = tab.dataset.tab;
    $("#signinForm").classList.toggle("hidden", which !== "signin");
    $("#signupForm").classList.toggle("hidden", which !== "signup");
  });
});

$("#signinForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    await signInWithEmailAndPassword(auth, fd.get("email"), fd.get("password"));
  } catch (err) { toast(err.message.replace("Firebase: ", "")); }
});

$("#signupForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const name = fd.get("name"), username = fd.get("username");
  try {
    const cred = await createUserWithEmailAndPassword(auth, fd.get("email"), fd.get("password"));
    await updateProfile(cred.user, { displayName: name });
    await ensureUserDoc(cred.user, { name, username });
  } catch (err) { toast(err.message.replace("Firebase: ", "")); }
});

$("#googleBtn").addEventListener("click", async () => {
  try { await signInWithPopup(auth, new GoogleAuthProvider()); }
  catch (err) { toast(err.message.replace("Firebase: ", "")); }
});

$("#signOutBtn").addEventListener("click", async () => {
  try {
    if (state.uid) await updateDoc(doc(db, "users", state.uid), { online: false, lastSeen: serverTimestamp() });
  } catch {}
  await signOut(auth);
});

$("#themeToggle").addEventListener("click", toggleTheme);
$("#themeAuthToggle")?.addEventListener("click", toggleTheme);

// -- Notification helpers --
export const writeNotif = async (toUid, type, data = {}) => {
  if (!toUid || toUid === state.uid) return;
  try {
    await addDoc(collection(db, "notifications", toUid, "items"), {
      type, ...data, fromUid: state.uid,
      fromName: state.me?.name || "", fromAvatar: state.me?.photoURL || "",
      read: false, createdAt: serverTimestamp(),
    });
  } catch {}
};
let _notifUnsub = null;
const startNotifListener = () => {
  if (_notifUnsub) _notifUnsub();
  _notifUnsub = onSnapshot(
    query(collection(db, "notifications", state.uid, "items"), where("read", "==", false), limit(99)),
    (snap) => { const pill = $("#notifPill"); if (!pill) return; const n = snap.size; pill.textContent = n > 99 ? "99+" : String(n); pill.hidden = n === 0; }, () => {}
  );
};
// -- Notification bell --
const toggleNotifPanel = () => {
  const existing = $("#notifPanel");
  if (existing) { existing.remove(); return; }
  const panel = el("div", { class: "notif-panel", id: "notifPanel" });
  panel.appendChild(el("div", { class: "np-head" }, el("span", { text: "Notifications" }),
    el("button", { class: "icon-btn", style: "width:30px;height:30px;", onclick: () => panel.remove() }, el("i", { class: "ri-close-line" }))));
  getDocs(query(collection(db, "notifications", state.uid, "items"), orderBy("createdAt", "desc"), limit(30)))
  .then((snap) => {
    if (snap.empty) { panel.appendChild(el("div", { class: "notif-empty" }, "No notifications yet.")); return; }
    const iconMap = { orbit:"ri-fire-fill", follow:"ri-user-follow-fill", message:"ri-chat-1-fill", comment:"ri-chat-4-fill", experience:"ri-sparkling-fill" };
    const colMap  = { orbit:"var(--grad-2)", follow:"var(--primary)", message:"var(--good)", comment:"var(--grad-3)", experience:"var(--grad-1)" };
    snap.docs.forEach((d) => {
      const n = { id: d.id, ...d.data() };
      const ic = iconMap[n.type] || "ri-notification-3-fill";
      const co = colMap[n.type]  || "var(--primary)";
      const txt = n.text || (n.fromName || "Someone") + " " + ({ orbit:"orbited your post", follow:"followed you", message:"sent you a message", experience:"replied to your experience" }[n.type] || "interacted");
      const item = el("div", { class: "notif-item" + (n.read ? "" : " unread") },
        el("i", { class: ic, style: "color:" + co + ";font-size:20px;flex-shrink:0;margin-top:2px;" }),
        el("div", { style: "min-width:0;" }, el("div", { class: "ni-text" }, txt), el("div", { class: "ni-time" }, fmtTime(n.createdAt))),
      );
      item.addEventListener("click", () => {
        updateDoc(doc(db, "notifications", state.uid, "items", n.id), { read: true }).catch(() => {});
        panel.remove();
        if (n.type === "message" && n.fromUid) location.hash = "#chats/" + n.fromUid;
        else if (n.type === "follow"  && n.fromUid) location.hash = "#profile/" + n.fromUid;
        else location.hash = "#feed";
      });
      panel.appendChild(item);
    });
    snap.docs.filter((d) => !d.data().read).forEach((d) => updateDoc(doc(db, "notifications", state.uid, "items", d.id), { read: true }).catch(() => {}));
  }).catch(() => panel.appendChild(el("div", { class: "notif-empty" }, "Could not load notifications.")));
  document.body.appendChild(panel);
  setTimeout(() => document.addEventListener("click", function once(e) {
    if (!panel.contains(e.target) && e.target !== $("#notifBtn")) panel.remove();
    else document.addEventListener("click", once, { once: true });
  }, { once: true }), 50);
};
$("#notifBtn").addEventListener("click", (e) => { e.stopPropagation(); toggleNotifPanel(); });

// =========================================================================
// 7. ROUTER
// =========================================================================
const routes = ["feed", "reels", "chats", "groups", "explore", "saved", "settings", "profile", "post", "profile-u", "spaces", "challenges", "mentorship"];

// Track feed scroll so "back from post" returns to same position
let _feedScrollY = 0;

const router = () => {
  const hash = (location.hash || "#feed").replace(/^#/, "");
  const [route, ...rest] = hash.split("/");
  const target = routes.includes(route) ? route : "feed";

  $$(".nav-item, .bn").forEach((b) => b.classList.toggle("active", b.dataset.route === target));

  const content = $("#content");
  // Save scroll before leaving feed
  if (content._currentRoute === "feed") {
    _feedScrollY = content.querySelector(".feed-wrap")?.parentElement?.scrollTop || 0;
  }
  content.innerHTML = "";
  content._currentRoute = target;

  switch (target) {
    case "feed":       renderFeed(content, _feedScrollY); _feedScrollY = 0; break;
    case "reels":      renderReels(content); break;
    case "chats":      document.dispatchEvent(new CustomEvent("orbit:open-chats", { detail: { peerUid: rest[0] || null } })); break;
    case "groups":     renderGroups(content); break;
    case "explore":    renderExplore(content, rest[0] === "tag" ? rest[1] : null); break;
    case "saved":      renderSaved(content); break;
    case "settings":   renderSettings(content); break;
    case "profile":    renderProfile(content, rest[0] || state.uid); break;
    case "profile-u":  renderProfileByUsername(content, rest[0]); break;
    case "post":       renderPostDetail(content, rest[0]); break;
    case "spaces":     import("./features.js").then(m => m.renderSpaces(content)); break;
    case "challenges": import("./features.js").then(m => m.renderChallenges(content)); break;
    case "mentorship": import("./features.js").then(m => m.renderMentorship(content)); break;
  }
};
window.addEventListener("hashchange", router);
$$(".nav-item, .bn, .brand").forEach((b) => {
  if (!b.dataset.route) return;
  b.addEventListener("click", () => { location.hash = "#" + b.dataset.route; });
});
$("#meBtn").addEventListener("click", () => { location.hash = "#profile"; });
// ── Mobile sidebar overlay ──────────────────────────────────────
const openMobileSidebar = () => {
  $("#sidebar").classList.add("is-open");
  $("#sidebarBackdrop").classList.add("visible");
};
const closeMobileSidebar = () => {
  $("#sidebar").classList.remove("is-open");
  $("#sidebarBackdrop").classList.remove("visible");
};
$("#openSidebar")?.addEventListener("click", openMobileSidebar);
$("#sidebarBackdrop").addEventListener("click", closeMobileSidebar);
// Close sidebar when a nav item is tapped on mobile
$$(".nav-item, .sidebar-foot .link").forEach((b) =>
  b.addEventListener("click", () => { if (window.innerWidth <= 640) closeMobileSidebar(); })
);

// =========================================================================
// 8. FEED — flat IG/FB style with separator lines + Trending lane
// =========================================================================
const renderFeed = (root, restoreScrollY = 0) => {
  const wrap = el("div", { class: "feed-wrap" });

  const stub = el("div", { class: "composer-stub" },
    el("img", { class: "avatar sm", src: avatarFor(state.me) }),
    el("button", { onclick: () => openCompose("post") }, `What's orbiting your mind, ${state.me.name.split(" ")[0]}?`)
  );
  wrap.appendChild(stub);

  // Trending lane container (filled later)
  const trendingLane = el("div", { class: "trending-lane hidden" });
  trendingLane.appendChild(el("div", { class: "trending-head" },
    el("i", { class: "ri-fire-fill" }), "Trending in your orbit"
  ));
  const trendingScroller = el("div", { class: "trending-scroller" });
  trendingLane.appendChild(trendingScroller);
  wrap.appendChild(trendingLane);

  // Posts container
  const list = el("div", { class: "feed-list" });
  list.appendChild(el("div", { class: "empty" },
    el("i", { class: "ri-loader-4-line" }),
    el("div", { class: "t" }, "Loading your orbit"),
  ));
  wrap.appendChild(list);
  root.appendChild(wrap);

  const q = query(collection(db, "posts"), orderBy("createdAt", "desc"), limit(50));
  let _lastPostIds = "";
  const unsub = onSnapshot(q, async (snap) => {
    const _newIds = snap.docs.map(d => d.id).join(",");
    if (_newIds === _lastPostIds && list.children.length > 0) return;
    _lastPostIds = _newIds;
    list.innerHTML = "";
    trendingScroller.innerHTML = "";
    if (snap.empty) {
      list.appendChild(el("div", { class: "empty" },
        el("i", { class: "ri-planet-line" }),
        el("div", { class: "t" }, "Your orbit is quiet"),
        el("div", {}, "Be the first to post — tap Create above."),
      ));
      return;
    }

    const posts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    // resolve authors
    const authors = await Promise.all([...new Set(posts.map((p) => p.authorUid))].map(fetchUser));
    const byUid = Object.fromEntries(authors.filter(Boolean).map((u) => [u.uid, u]));

    // Trending = top 5 by orbitCount with at least 3 orbits
    const trending = [...posts].filter((p) => (p.orbitCount || 0) >= 3)
      .sort((a, b) => (b.orbitCount || 0) - (a.orbitCount || 0)).slice(0, 5);
    if (trending.length) {
      trendingLane.classList.remove("hidden");
      trending.forEach((p) => trendingScroller.appendChild(renderTrendingCard(p, byUid[p.authorUid])));
    } else {
      trendingLane.classList.add("hidden");
    }

    let _inlineReels = [];
    try {
      const _rs = await getDocs(query(collection(db, "reels"), orderBy("createdAt", "desc"), limit(6)));
      _inlineReels = _rs.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch {}
    // Algorithm: score posts by affinity (following > hashtag match > engagement > recency)
    const _following = state.me?.following || [];
    const _interests = state.me?.interests || [];
    const _scored = posts.map((p) => {
      let score = 0;
      if (_following.includes(p.authorUid)) score += 50;
      if (_interests.some((tag) => (p.hashtags || []).includes(tag))) score += 30;
      score += Math.min((p.orbitCount || 0) * 2 + (p.commentCount || 0), 30);
      score += Math.max(0, 20 - Math.floor(((Date.now() - (p.createdAt?.toMillis?.() || Date.now())) / 3600000)));
      return { p, score };
    });
    _scored.sort((a, b) => b.score - a.score);
    _scored.forEach(({ p }, idx) => {
      list.appendChild(renderPost(p, byUid[p.authorUid]));
      if ((idx + 1) % 5 === 0 && _inlineReels.length) {
        const _r = _inlineReels.shift();
        if (_r) list.appendChild(renderFeedReelCard(_r));
      }
    });

    // Restore scroll position after coming back from a post
    if (restoreScrollY > 0) {
      requestAnimationFrame(() => { root.scrollTop = restoreScrollY; restoreScrollY = 0; });
    }
  });

  getDocs(query(collection(db, "experiences"), orderBy("createdAt", "desc"), limit(3))).then(async (snap) => {
    if (snap.empty) return;
    const _eb = el("div", { class: "exp-feed-banner" });
    _eb.appendChild(el("div", { class: "exp-feed-head" }, el("i", { class: "ri-sparkling-line", style: "color:var(--grad-1);" }), el("span", {}, "Experiences"), el("button", { class: "btn sm ghost", onclick: () => openCompose("experience") }, "+ Share yours")));
    const _sc = el("div", { class: "exp-feed-scroller" }); _eb.appendChild(_sc);
    const _ea = await Promise.all(snap.docs.map((d) => fetchUser(d.data().authorUid)));
    const _em = Object.fromEntries(_ea.filter(Boolean).map((u) => [u.uid, u]));
    snap.docs.forEach((d) => { const ex = { id: d.id, ...d.data() }; _sc.appendChild(renderExperienceMiniCard(ex, _em[ex.authorUid])); });
    wrap.insertBefore(_eb, list);
  }).catch(() => {});
  // store unsub on root so route changes clean up
  root._unsub = unsub;
};

const renderTrendingCard = (p, author) => {
  return el("div", { class: "trending-card", onclick: () => location.hash = `#feed` /* stays; could open detail */ },
    el("div", { class: "t-head" },
      el("img", { class: "avatar xs", src: avatarFor(author) }),
      el("div", { class: "t-name" }, author?.name || "User"),
    ),
    el("div", { class: "t-text", text: (p.text || "").slice(0, 140) }),
    el("div", { class: "t-meta" },
      el("i", { class: "ri-fire-fill", style: "color: var(--grad-2);" }),
      `${p.orbitCount || 0} Orbits · ${fmtTime(p.createdAt)}`
    ),
  );
};

// Build a media carousel node for an array of media objects (or single obj)
const renderMediaCarousel = (mediaRaw) => {
  const items = Array.isArray(mediaRaw) ? mediaRaw : (mediaRaw ? [mediaRaw] : []);
  if (!items.length) return null;
  if (items.length === 1) {
    const m = items[0];
    if (m.type === "video") {
      return el("div", { class: "post-media" }, buildVideoPlayer(m.url));
    }
    return el("div", { class: "post-media" }, el("img", { src: m.url, loading: "lazy" }));
  }
  // Multiple — simple slider
  let cur = 0;
  const slides = items.map((m, i) => {
    const slide = el("div", { class: "carousel-slide", style: i === 0 ? "" : "display:none;" });
    if (m.type === "video") {
      slide.appendChild(buildVideoPlayer(m.url));
    } else {
      slide.appendChild(el("img", { src: m.url, loading: "lazy" }));
    }
    return slide;
  });
  const dotsWrap = el("div", { class: "carousel-dots" });
  const dots = items.map((_, i) => {
    const d = el("button", { class: `carousel-dot${i === 0 ? " active" : ""}` });
    dotsWrap.appendChild(d);
    return d;
  });
  const go = (n) => {
    slides[cur].style.display = "none"; dots[cur].classList.remove("active");
    cur = (n + items.length) % items.length;
    slides[cur].style.display = ""; dots[cur].classList.add("active");
  };
  const prev = el("button", { class: "carousel-arrow left", onclick: (e) => { e.stopPropagation(); go(cur - 1); }},
    el("i", { class: "ri-arrow-left-s-line" }));
  const next = el("button", { class: "carousel-arrow right", onclick: (e) => { e.stopPropagation(); go(cur + 1); }},
    el("i", { class: "ri-arrow-right-s-line" }));
  const wrap = el("div", { class: "post-media carousel" }, ...slides, prev, next, dotsWrap);
  return wrap;
};

const renderPost = (p, author, opts = {}) => {
  const iOrbited = (p.orbits || []).includes(state.uid);
  const isMine = p.authorUid === state.uid;
  const trending = (p.orbitCount || 0) >= 3;
  const { hideComments = false } = opts;

  const post = el("article", { class: `post${trending ? " is-trending" : ""}` });

  const head = el("div", { class: "post-head" },
    el("img", { class: "avatar md", src: avatarFor(author), onclick: (e) => { e.stopPropagation(); location.hash = `#profile/${author?.uid}`; } }),
    el("div", { class: "meta", style: "cursor:pointer;", onclick: () => location.hash = `#post/${p.id}` },
      el("div", { class: "name" },
        author?.name || "User",
        author?.verified ? el("span", { class: "verified", title: "Location verified", html: '<i class="ri-check-line"></i>' }) : null,
      ),
      el("div", { class: "sub" },
        `@${author?.username || "user"}`,
        el("span", { class: "dot" }, "·"),
        fmtTime(p.createdAt),
      )
    ),
    !isMine ? (() => {
      let _isFollowing = (state.me?.following || []).includes(author?.uid);
      const fbtn = el("button", { class: `follow-btn${_isFollowing ? " following" : ""}` },
        _isFollowing ? "Following" : "Follow");
      fbtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        _isFollowing = !_isFollowing;
        fbtn.textContent = _isFollowing ? "Following" : "Follow";
        fbtn.classList.toggle("following", _isFollowing);
        await updateDoc(doc(db, "users", state.uid), {
          following: _isFollowing ? arrayUnion(author.uid) : arrayRemove(author.uid),
        }).catch(() => {});
        await updateDoc(doc(db, "users", author.uid), {
          followers: _isFollowing ? arrayUnion(state.uid) : arrayRemove(state.uid),
        }).catch(() => {});
        if (_isFollowing) {
          writeNotif(author.uid, "follow", {}).catch(() => {});
          import("./notifications.js").then(({ notifyUser }) =>
            notifyUser(author.uid, state.me?.name || "Someone", "started following you", "/#profile/" + state.uid)
          ).catch(() => {});
        }
        if (state.me) { state.me.following = _isFollowing ? [...(state.me.following||[]), author.uid] : (state.me.following||[]).filter((x)=>x!==author.uid); }
      });
      return fbtn;
    })() : el("button", { class: "icon-btn more", onclick: async (e) => {
      e.stopPropagation();
      if (confirm("Delete this post?")) {
        await deleteDoc(doc(db, "posts", p.id));
        toast("Post deleted");
      }
    }}, el("i", { class: "ri-more-2-line" })),
  );
  post.appendChild(head);

  if (p.location?.city || p.location?.lat) { post.appendChild(el("div", { class: "post-location-badge" }, el("i", { class: "ri-map-pin-fill" }), " " + (p.location.city || p.location.lat + ", " + p.location.lng))); }

  // Feature: kind badge + title for build/project posts
  if (p.kind === "build" || p.kind === "project") {
    const icons  = { build: "ri-hammer-line", project: "ri-folder-5-line" };
    const labels = { build: "Build in Public",  project: "Project Showcase" };
    post.appendChild(el("div", { class: `post-kind-badge post-kind-${p.kind}` },
      el("i", { class: icons[p.kind] }), " " + labels[p.kind]));
  }
  if (p.title) {
    post.appendChild(el("div", { class: "post-feat-title", onclick: () => location.hash = `#post/${p.id}` }, p.title));
  }

  if (p.text) {
    if (p.text.includes("```")) {
      const body = el("div", { class: "post-text-wrap", onclick: (e) => { if (!e.target.closest("button,a")) location.hash = `#post/${p.id}`; } });
      import("./features.js").then((m) => body.appendChild(m.renderTextWithCode(p.text))).catch(() => {
        body.innerHTML = linkify(p.text);
      });
      post.appendChild(body);
    } else {
      const body = el("div", { class: "post-text", onclick: () => location.hash = `#post/${p.id}` });
      body.innerHTML = linkify(p.text);
      post.appendChild(body);
    }
  }

  // Media (single or carousel)
  const carousel = renderMediaCarousel(p.media);
  if (carousel) post.appendChild(carousel);

  // Feature: extra detail block for build/project posts (stage, progress, tags, links)
  if (p.kind === "build" || p.kind === "project") {
    import("./features.js").then((m) => {
      const extra = p.kind === "build" ? m.renderBuildExtra(p) : m.renderProjectExtra(p);
      const actions = post.querySelector(".post-actions");
      if (actions) post.insertBefore(extra, actions); else post.appendChild(extra);
    }).catch(() => {});
  }

  // Actions row
  const orbitIcon = el("i", { class: iOrbited ? "ri-fire-fill" : "ri-fire-line" });
  const orbitCount = el("span", { text: String(p.orbitCount || 0) });
  let _iOrbited = iOrbited;
  const orbitBtn = el("button", { class: `post-act orbit${iOrbited ? " active" : ""}`, onclick: async (e) => {
    e.stopPropagation();
    _iOrbited = !_iOrbited;
    orbitIcon.className = _iOrbited ? "ri-fire-fill" : "ri-fire-line";
    orbitCount.textContent = String((p.orbitCount || 0) + (_iOrbited ? 1 : -1));
    orbitBtn.classList.toggle("active", _iOrbited);
    await updateDoc(doc(db, "posts", p.id), {
      orbits: _iOrbited ? arrayUnion(state.uid) : arrayRemove(state.uid),
      orbitCount: increment(_iOrbited ? 1 : -1),
    }).catch(() => {});
  }}, orbitIcon, el("span", {}, "Orbit · "), orbitCount);

  const saveIcon = (state.me?.saved || []).includes(p.id) ? "ri-bookmark-fill" : "ri-bookmark-line";

  const actions = el("div", { class: "post-actions" },
    el("button", { class: "post-act", onclick: (e) => { e.stopPropagation(); location.hash = `#post/${p.id}`; }},
      el("i", { class: "ri-chat-1-line" }),
      String(p.commentCount || 0),
    ),
    el("button", { class: "post-act", onclick: async (e) => {
      e.stopPropagation();
      const url = `${location.origin}${location.pathname}#post/${p.id}`;
      try { await navigator.share?.({ title: "Orbit", text: p.text || "Check this out", url }); }
      catch { await navigator.clipboard.writeText(url); toast("Link copied"); }
    }},
      el("i", { class: "ri-share-forward-line" }),
      "Share",
    ),
    el("button", { class: "post-act", onclick: (e) => { e.stopPropagation(); toggleSave(p.id); } },
      el("i", { class: saveIcon }),
    ),
    orbitBtn,
  );
  post.appendChild(actions);

  if (!hideComments) {
    // Comments preview (top 2)
    const cBox = el("div", { class: "comments hidden" });
    post.appendChild(cBox);

    const cForm = el("form", { class: "comment-form" },
      el("img", { class: "avatar xs", src: avatarFor(state.me) }),
      el("input", { type: "text", placeholder: "Write a comment…" }),
      el("button", { class: "icon-btn", type: "submit" }, el("i", { class: "ri-send-plane-fill" })),
    );
    cForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = cForm.querySelector("input");
      const text = input.value.trim();
      if (!text) return;
      input.value = "";
      // Optimistic UI — show comment instantly without waiting for Firestore
      cBox.classList.remove("hidden");
      cBox.appendChild(el("div", { class: "comment" },
        el("img", { class: "avatar xs", src: avatarFor(state.me) }),
        el("div", { class: "body" },
          el("div", { class: "name" }, state.me?.name || "User"),
          el("div", { class: "text", text }),
        ),
      ));
      await addDoc(collection(db, "posts", p.id, "comments"), {
        text, authorUid: state.uid, createdAt: serverTimestamp(),
      });
      await updateDoc(doc(db, "posts", p.id), { commentCount: increment(1) });
    });
    post.appendChild(cForm);

    onSnapshot(query(collection(db, "posts", p.id, "comments"), orderBy("createdAt", "desc"), limit(3)),
      async (snap) => {
        cBox.innerHTML = "";
        if (snap.empty) { cBox.classList.add("hidden"); return; }
        cBox.classList.remove("hidden");
        const comments = snap.docs.map((d) => ({ id: d.id, ...d.data() })).reverse();
        const authors = await Promise.all([...new Set(comments.map((c) => c.authorUid))].map(fetchUser));
        const map = Object.fromEntries(authors.filter(Boolean).map((u) => [u.uid, u]));
        comments.forEach((c) => {
          const a = map[c.authorUid];
          cBox.appendChild(el("div", { class: "comment" },
            el("img", { class: "avatar xs", src: avatarFor(a) }),
            el("div", { class: "body" },
              el("div", { class: "name" }, a?.name || "User",
                a?.verified ? el("span", { class: "verified", html: '<i class="ri-check-line"></i>' }) : null),
              el("div", { class: "text", text: c.text }),
            ),
          ));
        });
      });

    post._focusComment = () => cForm.querySelector("input").focus();
  }
  return post;
};

// =========================================================================
// 8b. POST DETAIL — full single post with all comments + back button
// =========================================================================
const renderPostDetail = async (root, postId) => {
  if (!postId) { location.hash = "#feed"; return; }

  const back = el("div", { class: "detail-topbar" },
    el("button", { class: "icon-btn", onclick: () => history.back() },
      el("i", { class: "ri-arrow-left-line" }), "Back"),
    el("span", { class: "detail-title" }, "Post"),
  );
  root.appendChild(back);

  const snap = await getDoc(doc(db, "posts", postId)).catch(() => null);
  if (!snap || !snap.exists()) {
    root.appendChild(el("div", { class: "empty" },
      el("i", { class: "ri-ghost-line" }),
      el("div", { class: "t" }, "Post not found"),
    ));
    return;
  }
  const p = { id: snap.id, ...snap.data() };
  const author = await fetchUser(p.authorUid);

  // Render the post card (no inline comment form — we show all comments below)
  root.appendChild(renderPost(p, author, { hideComments: true }));

  // Full comments section
  const cmtSection = el("div", { class: "detail-comments" });
  root.appendChild(cmtSection);

  const cmtHead = el("div", { class: "detail-cmt-head" }, "Comments");
  cmtSection.appendChild(cmtHead);

  const cList = el("div", { class: "detail-cmt-list" });
  cmtSection.appendChild(cList);

  onSnapshot(query(collection(db, "posts", p.id, "comments"), orderBy("createdAt", "asc"), limit(100)),
    async (snap) => {
      cList.innerHTML = "";
      if (snap.empty) {
        cList.appendChild(el("div", { class: "reel-cmt-empty" }, "No comments yet. Be the first!"));
        return;
      }
      const comments = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const auths = await Promise.all([...new Set(comments.map((c) => c.authorUid))].map(fetchUser));
      const map = Object.fromEntries(auths.filter(Boolean).map((u) => [u.uid, u]));
      comments.forEach((c) => {
        const a = map[c.authorUid];
        cList.appendChild(el("div", { class: "comment detail-cmt" },
          el("img", { class: "avatar xs", src: avatarFor(a), onclick: () => location.hash = `#profile/${a?.uid}` }),
          el("div", { class: "body" },
            el("div", { class: "name" }, a?.name || "User",
              a?.verified ? el("span", { class: "verified", html: '<i class="ri-check-line"></i>' }) : null,
              el("span", { class: "cmt-time" }, fmtTime(c.createdAt)),
            ),
            el("div", { class: "text", text: c.text }),
          ),
        ));
      });
    });

  const cForm = el("form", { class: "comment-form detail-cmt-form" },
    el("img", { class: "avatar xs", src: avatarFor(state.me) }),
    el("input", { type: "text", placeholder: "Write a comment…" }),
    el("button", { class: "icon-btn", type: "submit" }, el("i", { class: "ri-send-plane-fill" })),
  );
  cForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = cForm.querySelector("input");
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    await addDoc(collection(db, "posts", p.id, "comments"), {
      text, authorUid: state.uid, createdAt: serverTimestamp(),
    });
    await updateDoc(doc(db, "posts", p.id), { commentCount: increment(1) });
  });
  cmtSection.appendChild(cForm);
};

const toggleSave = async (postId) => {
  const ref = doc(db, "users", state.uid);
  const has = (state.me.saved || []).includes(postId);
  await updateDoc(ref, { saved: has ? arrayRemove(postId) : arrayUnion(postId) });
  toast(has ? "Removed from Saved" : "Saved");
};

// =========================================================================
// 9. REELS — load once (no snapshot re-render), in-place DOM updates,
//            TikTok-style comments slide-up, intersection autoplay
// =========================================================================
const renderReels = async (root) => {
  const wrap = el("div", { class: "reels-wrap" });
  root.appendChild(wrap);

  wrap.appendChild(el("div", { class: "reel-loading" },
    el("i", { class: "ri-loader-4-line", style: "font-size:36px;color:white;animation:spin 1s linear infinite;" })));

  let reels = [];
  try {
    const snap = await getDocs(query(collection(db, "reels"), orderBy("createdAt", "desc"), limit(30)));
    if (snap.empty) {
      wrap.innerHTML = "";
      wrap.appendChild(el("div", { class: "empty reel-empty-msg" },
        el("i", { class: "ri-film-line" }),
        el("div", { class: "t" }, "No reels yet"),
        el("div", {}, "Tap Create → Reel to upload one."),
      ));
      return;
    }
    reels = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    wrap.innerHTML = "";
    wrap.appendChild(el("div", { class: "empty reel-empty-msg" },
      el("i", { class: "ri-error-warning-line" }),
      el("div", { class: "t" }, "Couldn't load reels"),
    ));
    return;
  }

  const authors = await Promise.all([...new Set(reels.map((r) => r.authorUid))].map(fetchUser));
  const map = Object.fromEntries(authors.filter(Boolean).map((u) => [u.uid, u]));

  wrap.innerHTML = "";
  reels.forEach((r) => wrap.appendChild(renderReel(r, map[r.authorUid])));

  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      const v = e.target;
      if (e.intersectionRatio >= 0.6) {
        if (v.paused) v.play().catch(() => {});
      } else {
        if (!v.paused) v.pause();
      }
    });
  }, { threshold: [0, 0.6, 1] });
  wrap.querySelectorAll("video").forEach((v) => io.observe(v));
};

const renderReel = (r, author) => {
  // Track liked state client-side to avoid re-render
  let liked = (r.likes || []).includes(state.uid);
  let likeCount = r.likeCount || 0;
  let commentCount = r.commentCount || 0;

  const likeIcon = el("i", { class: liked ? "ri-heart-fill" : "ri-heart-line" });
  const likeNum  = el("span", { text: String(likeCount) });
  const cmtNum   = el("span", { text: String(commentCount) });

  const likeBtn = el("button", { class: `reel-act${liked ? " active" : ""}`,
    onclick: async (e) => {
      e.stopPropagation();
      liked = !liked;
      likeCount += liked ? 1 : -1;
      likeIcon.className = liked ? "ri-heart-fill" : "ri-heart-line";
      likeNum.textContent = String(likeCount);
      likeBtn.classList.toggle("active", liked);
      await updateDoc(doc(db, "reels", r.id), {
        likes: liked ? arrayUnion(state.uid) : arrayRemove(state.uid),
        likeCount: increment(liked ? 1 : -1),
      }).catch(() => {});
    }
  }, likeIcon, likeNum);

  const cmtBtn = el("button", { class: "reel-act",
    onclick: (e) => { e.stopPropagation(); openReelComments(r.id, cmtNum); }
  }, el("i", { class: "ri-chat-bubble-line" }), cmtNum);

  const shareBtn = el("button", { class: "reel-act",
    onclick: async (e) => {
      e.stopPropagation();
      try { await navigator.share?.({ title: "Reel on Orbit", url: r.media.url }); }
      catch { await navigator.clipboard.writeText(r.media.url); toast("Link copied"); }
    }
  }, el("i", { class: "ri-share-forward-line" }), el("span", { text: "Share" }));

  const video = el("video", { src: r.media.url, poster: _cloudPoster(r.media.url), loop: true, playsinline: "", muted: "",
    "webkit-playsinline": "",
    onclick: (e) => { e.stopPropagation(); e.target.muted = !e.target.muted; }
  });

  // Follow button for reel author
  let _reelFollowing = (state.me?.following || []).includes(author?.uid);
  const reelFollowBtn = r.authorUid !== state.uid ? (() => {
    const btn = el("button", { class: `reel-follow-btn${_reelFollowing ? " following" : ""}` },
      _reelFollowing ? "Following" : "+ Follow");
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      _reelFollowing = !_reelFollowing;
      btn.textContent = _reelFollowing ? "Following" : "+ Follow";
      btn.classList.toggle("following", _reelFollowing);
      await updateDoc(doc(db, "users", state.uid), { following: _reelFollowing ? arrayUnion(author.uid) : arrayRemove(author.uid) }).catch(() => {});
      await updateDoc(doc(db, "users", author.uid), { followers: _reelFollowing ? arrayUnion(state.uid) : arrayRemove(state.uid) }).catch(() => {});
      if (_reelFollowing) {
        writeNotif(author.uid, "follow", {}).catch(() => {});
        import("./notifications.js").then(({ notifyUser }) =>
          notifyUser(author.uid, state.me?.name || "Someone", "started following you", "/#profile/" + state.uid)
        ).catch(() => {});
      }
      if (state.me) { state.me.following = _reelFollowing ? [...(state.me.following||[]), author.uid] : (state.me.following||[]).filter((x)=>x!==author.uid); }
    });
    return btn;
  })() : null;

  const node = el("div", { class: "reel" },
    video,
    el("div", { class: "reel-overlay" }),
    el("div", { class: "reel-info" },
      el("div", { class: "name", onclick: () => location.hash = `#profile/${author?.uid}` },
        el("img", { class: "avatar sm", src: avatarFor(author) }),
        author?.name || "User",
        author?.verified ? el("span", { class: "verified", html: '<i class="ri-check-line"></i>' }) : null,
        reelFollowBtn,
      ),
        r.caption ? el("div", { class: "caption", text: r.caption }) : null,
    ),
    el("div", { class: "reel-actions" }, likeBtn, cmtBtn, shareBtn),
  );
  return node;
};

// TikTok-style slide-up comments for a reel
const openReelComments = (reelId, cmtNumEl) => {
  // Remove any existing
  $("#reelCommentsSheet")?.remove();

  const sheet = el("div", { class: "reel-cmt-sheet", id: "reelCommentsSheet" });
  const backdrop = el("div", { class: "reel-cmt-backdrop", onclick: () => sheet.remove() });

  const inner = el("div", { class: "reel-cmt-inner" },
    el("div", { class: "reel-cmt-handle" }),
    el("div", { class: "reel-cmt-head" },
      el("span", { class: "reel-cmt-title" }, "Comments"),
      el("button", { class: "icon-btn", style: "width:32px;height:32px;", onclick: () => sheet.remove() },
        el("i", { class: "ri-close-line" })),
    ),
    el("div", { class: "reel-cmt-list", id: `reelCmtList_${reelId}` },
      el("div", { style: "text-align:center;padding:20px;color:var(--text-mute);" }, "Loading…")),
    el("div", { class: "reel-cmt-composer" },
      el("img", { class: "avatar xs", src: avatarFor(state.me) }),
      el("input", { type: "text", id: "reelCmtInput", placeholder: "Add a comment…" }),
      el("button", { class: "icon-btn", id: "reelCmtSend",
        onclick: () => submitReelComment(reelId, cmtNumEl),
      }, el("i", { class: "ri-send-plane-fill", style: "color:var(--primary);" })),
    ),
  );

  const reelCmtInput = inner.querySelector("#reelCmtInput");
  reelCmtInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submitReelComment(reelId, cmtNumEl);
  });

  sheet.appendChild(backdrop);
  sheet.appendChild(inner);
  document.body.appendChild(sheet);

  // Load comments live
  const listEl = inner.querySelector(`#reelCmtList_${reelId}`);
  const unsub = onSnapshot(
    query(collection(db, "reels", reelId, "comments"), orderBy("createdAt", "asc"), limit(100)),
    async (snap) => {
      listEl.innerHTML = "";
      if (snap.empty) {
        listEl.appendChild(el("div", { class: "reel-cmt-empty" }, "No comments yet. Be the first!"));
        return;
      }
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const uids = [...new Set(items.map((c) => c.authorUid))];
      const authors = await Promise.all(uids.map(fetchUser));
      const amap = Object.fromEntries(authors.filter(Boolean).map((u) => [u.uid, u]));
      items.forEach((c) => {
        const a = amap[c.authorUid];
        const row = el("div", { class: "reel-cmt-row" },
          el("img", { class: "avatar xs", src: avatarFor(a), onclick: () => location.hash = `#profile/${a?.uid}` }),
          el("div", { class: "reel-cmt-body" },
            el("div", { class: "reel-cmt-name" },
              a?.name || "User",
              a?.verified ? el("span", { class: "verified", html: '<i class="ri-check-line"></i>' }) : null,
            ),
            el("div", { class: "reel-cmt-text", text: c.text }),
            el("div", { class: "reel-cmt-meta" },
              fmtTime(c.createdAt),
              el("button", { class: "reel-cmt-reply-btn", onclick: () => {
                reelCmtInput.value = `@${a?.username || "user"} `;
                reelCmtInput.dataset.replyTo = c.id;
                reelCmtInput.focus();
              }}, "Reply"),
              (c.likes || []).length
                ? el("span", { style: "color:var(--danger);", text: `♥ ${c.likes.length}` })
                : null,
            ),
          ),
          el("button", { class: "reel-cmt-like",
            onclick: async () => {
              const has = (c.likes || []).includes(state.uid);
              await updateDoc(doc(db, "reels", reelId, "comments", c.id), {
                likes: has ? arrayRemove(state.uid) : arrayUnion(state.uid),
              }).catch(() => {});
            }
          }, el("i", { class: (c.likes || []).includes(state.uid) ? "ri-heart-fill" : "ri-heart-line" })),
        );
        listEl.appendChild(row);
      });
      listEl.scrollTop = listEl.scrollHeight;
    });

  // Clean up listener when sheet is removed
  const mo = new MutationObserver(() => {
    if (!document.body.contains(sheet)) { unsub(); mo.disconnect(); }
  });
  mo.observe(document.body, { childList: true });
};

const submitReelComment = async (reelId, cmtNumEl) => {
  const input = $("#reelCmtInput");
  const text = (input?.value || "").trim();
  if (!text) return;
  input.value = "";
  try {
    await addDoc(collection(db, "reels", reelId, "comments"), {
      authorUid: state.uid, text, likes: [],
      replyTo: input.dataset.replyTo || null,
      createdAt: serverTimestamp(),
    });
    await updateDoc(doc(db, "reels", reelId), { commentCount: increment(1) });
    if (cmtNumEl) {
      cmtNumEl.textContent = String(parseInt(cmtNumEl.textContent || "0") + 1);
    }
    delete input.dataset.replyTo;
  } catch (err) {
    toast("Couldn't post comment");
  }
};

// =========================================================================
// 10. GROUPS
// =========================================================================
const renderGroups = (root) => {
  const head = el("div", { class: "section-head" },
    el("h2", {}, "Groups"),
    el("div", { class: "right" },
      el("button", { class: "btn primary", onclick: () => openCompose("group") },
        el("i", { class: "ri-add-line" }), "New group"),
    ),
  );
  root.appendChild(head);

  const grid = el("div", { class: "group-grid" });
  root.appendChild(grid);

  onSnapshot(query(collection(db, "groups"), orderBy("createdAt", "desc"), limit(60)), (snap) => {
    grid.innerHTML = "";
    if (snap.empty) {
      grid.appendChild(el("div", { class: "empty", style: "grid-column:1/-1;" },
        el("i", { class: "ri-group-2-line" }),
        el("div", { class: "t" }, "No groups yet"),
        el("div", {}, "Create a group to chat with multiple people in real time."),
      ));
      return;
    }
    snap.docs.forEach((d) => {
      const g = { id: d.id, ...d.data() };
      const member = (g.members || []).includes(state.uid);
      const card = el("div", { class: "group-card" },
        el("div", { class: "group-cover", text: (g.name || "?").slice(0, 1).toUpperCase() }),
        el("div", { class: "group-name", text: g.name }),
        el("div", { class: "group-meta", text: `${(g.members || []).length} members${g.isPublic ? " · public" : " · private"}` }),
        el("div", { class: "group-actions" },
          el("button", { class: `btn ${member ? "ghost" : "primary"}`, onclick: async () => {
            const ref = doc(db, "groups", g.id);
            if (member) {
              await updateDoc(ref, { members: arrayRemove(state.uid) });
              toast("Left group");
            } else {
              await updateDoc(ref, { members: arrayUnion(state.uid) });
              toast("Joined group");
            }
          }}, member ? "Leave" : "Join"),
          member ? el("button", { class: "btn ghost", onclick: () => location.hash = `#chats/${g.id}` },
            el("i", { class: "ri-chat-3-line" }), "Open") : null,
        ),
      );
      grid.appendChild(card);
    });
  });
};

// =========================================================================
// 11. EXPLORE / SAVED
// =========================================================================
const renderExplore = (root, hashtagFilter = null) => {
  const title = hashtagFilter ? `#${hashtagFilter}` : "Explore";
  const head = el("div", { class: "section-head" },
    hashtagFilter
      ? el("button", { class: "icon-btn", style: "margin-right:8px;", onclick: () => history.back() },
          el("i", { class: "ri-arrow-left-line" }))
      : null,
    el("h2", {}, title),
  );
  root.appendChild(head);
  const grid = el("div", { class: "grid-3" });
  root.appendChild(grid);

  // No compound orderBy on hashtag queries — sort client-side to avoid composite index
  const baseQ = hashtagFilter
    ? query(collection(db, "posts"), where("hashtags", "array-contains", hashtagFilter.toLowerCase()), limit(60))
    : query(collection(db, "posts"), orderBy("orbitCount", "desc"), limit(60));

  onSnapshot(baseQ, (snap) => {
    grid.innerHTML = "";
    if (snap.empty) {
      grid.appendChild(el("div", { class: "empty", style: "grid-column:1/-1;" },
        el("i", { class: hashtagFilter ? "ri-hashtag" : "ri-compass-3-line" }),
        el("div", { class: "t" }, hashtagFilter ? `No posts tagged #${hashtagFilter}` : "Nothing to explore yet")));
      return;
    }
    // Client-side sort for hashtag queries (no compound index needed)
    const docs = [...snap.docs].sort((a, b) => {
      if (hashtagFilter) return (b.data().createdAt?.seconds || 0) - (a.data().createdAt?.seconds || 0);
      return (b.data().orbitCount || 0) - (a.data().orbitCount || 0);
    });
    docs.forEach((d) => {
      const p = { id: d.id, ...d.data() };
      const cell = el("div", { class: "cell", onclick: () => location.hash = `#post/${p.id}` });
      const mediaItems = Array.isArray(p.media) ? p.media : (p.media ? [p.media] : []);
      if (mediaItems.length) {
        const m = mediaItems[0];
        if (m.type === "video") {
          cell.appendChild(el("video", { src: m.url, muted: "", playsinline: "", preload: "metadata" }));
          cell.appendChild(el("span", { class: "cell-badge" }, el("i", { class: "ri-play-fill" })));
        } else {
          cell.appendChild(el("img", { src: m.url, loading: "lazy" }));
          if (mediaItems.length > 1) cell.appendChild(el("span", { class: "cell-badge" }, el("i", { class: "ri-image-2-line" })));
        }
      } else {
        cell.appendChild(el("div", { class: "cell-text", text: (p.text || "").slice(0, 80) }));
      }
      if (p.text) cell.appendChild(el("div", { class: "cell-overlay", text: (p.text || "").slice(0, 55) }));
      grid.appendChild(cell);
    });
  });
};

const renderSaved = (root) => {
  const head = el("div", { class: "section-head" }, el("h2", {}, "Saved"));
  root.appendChild(head);
  const list = el("div", { class: "feed-wrap" });
  root.appendChild(list);

  const ids = state.me.saved || [];
  if (!ids.length) {
    list.appendChild(el("div", { class: "empty" },
      el("i", { class: "ri-bookmark-line" }),
      el("div", { class: "t" }, "Nothing saved yet"),
      el("div", {}, "Tap the bookmark on any post to save it here.")));
    return;
  }
  Promise.all(ids.map((id) => getDoc(doc(db, "posts", id)))).then(async (docs) => {
    const posts = docs.filter((d) => d.exists()).map((d) => ({ id: d.id, ...d.data() }));
    const authors = await Promise.all([...new Set(posts.map((p) => p.authorUid))].map(fetchUser));
    const map = Object.fromEntries(authors.filter(Boolean).map((u) => [u.uid, u]));
    posts.forEach((p) => list.appendChild(renderPost(p, map[p.authorUid])));
  });
};

// =========================================================================
// 12. PROFILE
// =========================================================================
const renderProfile = async (root, uid) => {
  // Always use fresh data for own profile (bypass stale cache after Pro activation)
  let u;
  if (uid === state.uid) {
    state.cache.users.delete(uid);
    u = await fetchUser(uid);
    if (u) state.me = { ...state.me, ...u };
  } else {
    u = await fetchUser(uid);
  }
  if (!u) {
    root.appendChild(el("div", { class: "empty" }, el("i", { class: "ri-user-line" }), el("div", { class: "t" }, "User not found")));
    return;
  }
  const isMe = uid === state.uid;
  const iFollow = (state.me.following || []).includes(uid);

  root.appendChild(el("div", { class: "profile-head" },
    el("img", { class: "avatar xl", src: avatarFor(u) }),
    el("div", {},
      el("div", { class: "name-row" }, u.name,
        u.verified ? el("span", { class: "verified lg", title: "Location verified", html: '<i class="ri-check-line"></i>' }) : null,
        u.isPro ? el("span", { class: "pro-name-badge" }, el("i", { class: "ri-vip-crown-fill" }), " Pro") : null),
      el("div", { class: "uname" }, "@" + u.username),
      el("div", { class: "stats" },
        el("div", { class: "stat" }, el("strong", {}, String((u.followers || []).length)), el("span", {}, "followers")),
        el("div", { class: "stat" }, el("strong", {}, String((u.following || []).length)), el("span", {}, "following")),
      ),
      u.bio ? el("div", { class: "bio", text: u.bio }) : null,
      el("div", { class: "profile-actions" },
        isMe
          ? el("button", { class: "btn ghost", onclick: () => openProfileEditModal() }, el("i", { class: "ri-edit-line" }), "Edit profile")
          : el("button", { class: "btn primary", onclick: async () => {
              const meRef = doc(db, "users", state.uid);
              const themRef = doc(db, "users", uid);
              const batch = writeBatch(db);
              if (iFollow) {
                batch.update(meRef, { following: arrayRemove(uid) });
                batch.update(themRef, { followers: arrayRemove(state.uid) });
              } else {
                batch.update(meRef, { following: arrayUnion(uid) });
                batch.update(themRef, { followers: arrayUnion(state.uid) });
              }
              await batch.commit();
              router();
            }}, iFollow ? "Following" : "Follow"),
        !isMe ? el("button", { class: "btn ghost", onclick: () => location.hash = `#chats/${uid}` },
          el("i", { class: "ri-chat-3-line" }), "Message") : null,
        isMe && !u.verified ? el("button", { class: "btn ghost", onclick: requestLocationVerification },
          el("i", { class: "ri-shield-check-line" }), "Get verified") : null,
      ),
    ),
  ));

  // Feature: Pro section — rendered directly below header, always visible
  const proSection = el("div", { class: "profile-pro-section" });
  root.appendChild(proSection);
  import("./features.js").then((m) => {
    if (u.isPro) {
      // Orbit Score goes at the TOP of proSection (not inside name-row)
      m.renderOrbitScoreBadge(proSection, uid);
      m.renderTechStack(proSection, u, isMe);
      m.renderSkillBadges(proSection, uid, isMe);
    } else if (isMe) {
      m.renderGoProBanner(proSection);
    }
  }).catch(() => {});

  const tabs = el("div", { class: "profile-tabs" },
    el("button", { class: "profile-tab active", "data-ptab": "posts" }, "Posts"),
    el("button", { class: "profile-tab", "data-ptab": "reels" }, "Reels"),
    el("button", { class: "profile-tab", "data-ptab": "tagged" }, "About"),
  );
  root.appendChild(tabs);
  const body = el("div", {});
  root.appendChild(body);

  const renderTab = async (which) => {
    body.innerHTML = "";
    // Show loading state
    body.appendChild(el("div", { class: "empty" },
      el("i", { class: "ri-loader-4-line", style: "animation:spin 1s linear infinite;" }),
      el("div", { class: "t" }, "Loading…")));

    if (which === "posts") {
      // No orderBy — avoid composite index requirement; sort client-side
      const snap = await getDocs(
        query(collection(db, "posts"), where("authorUid", "==", uid), limit(60))
      ).catch(() => null);
      body.innerHTML = "";
      if (!snap || snap.empty) {
        body.appendChild(el("div", { class: "empty" }, el("i", { class: "ri-image-line" }), el("div", { class: "t" }, "No posts yet"))); return;
      }
      const posts = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

      const profFeed = el("div", { class: "profile-feed-list" }); body.appendChild(profFeed);
      posts.forEach((p) => profFeed.appendChild(renderPost(p, u)));
    } else if (which === "reels") {
      // No orderBy — avoid composite index requirement; sort client-side
      const snap = await getDocs(
        query(collection(db, "reels"), where("authorUid", "==", uid), limit(30))
      ).catch(() => null);
      body.innerHTML = "";
      if (!snap || snap.empty) {
        body.appendChild(el("div", { class: "empty" }, el("i", { class: "ri-film-line" }), el("div", { class: "t" }, "No reels yet"))); return;
      }
      const reels = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

      const grid = el("div", { class: "grid-3 portrait-grid" }); body.appendChild(grid);
      reels.forEach((r) => {
        const cell = el("div", { class: "cell portrait-cell", onclick: () => location.hash = `#reels` },
          el("video", { src: r.media?.url, muted: "", playsinline: "", preload: "metadata" }),
          el("span", { class: "cell-badge" }, el("i", { class: "ri-play-fill" })),
        );
        grid.appendChild(cell);
      });
    } else {
      body.appendChild(el("div", { class: "settings" },
        el("div", { class: "group" },
          el("h3", {}, "About"),
          el("div", { class: "row" }, el("div", { class: "label" }, el("div", { class: "t" }, "Joined"), el("div", { class: "d" }, fmtTime(u.createdAt) || "—"))),
          u.location ? el("div", { class: "row" }, el("div", { class: "label" }, el("div", { class: "t" }, "Verified location"), el("div", { class: "d" }, u.location.city || `${u.location.lat?.toFixed(2)}, ${u.location.lng?.toFixed(2)}`))) : null,
          el("div", { class: "row" }, el("div", { class: "label" }, el("div", { class: "t" }, "Status"), el("div", { class: "d" }, u.online ? "Online now" : `Last seen ${fmtTime(u.lastSeen)}`))),
        ),
      ));
    }
  };
  renderTab("posts");
  $$(".profile-tab", tabs).forEach((t) => t.addEventListener("click", () => {
    $$(".profile-tab", tabs).forEach((x) => x.classList.toggle("active", x === t));
    renderTab(t.dataset.ptab);
  }));
};

const openProfileEditModal = () => {
  const modal = document.getElementById("profileEditModal"); if (!modal) return;
  const ni = document.getElementById("editName");    if (ni) ni.value = state.me.name || "";
  const ui = document.getElementById("editUsername"); if (ui) ui.value = state.me.username || "";
  const bi = document.getElementById("editBio");      if (bi) bi.value = state.me.bio || "";
  const av = document.getElementById("editAvatar");   if (av) av.src = state.me.photoURL || avatarFor(state.me);
  modal.classList.remove("hidden");
  modal.style.display = "flex";
};

const renderProfileByUsername = async (root, username) => {
  if (!username) { location.hash = "#feed"; return; }
  const qs = await getDocs(query(collection(db, "users"), where("username", "==", username.toLowerCase()), limit(1)));
  if (qs.empty) {
    root.appendChild(el("div", { class: "empty" }, el("i", { class: "ri-user-unfollow-line" }), el("div", { class: "t" }, `@${username} not found`)));
    return;
  }
  const u = { uid: qs.docs[0].id, ...qs.docs[0].data() };
  renderProfile(root, u.uid);
};

// =========================================================================
// 13. SETTINGS — theme, verification, notifications
// =========================================================================
const renderSettings = (root) => {
  const wrap = el("div", { class: "settings" },
    el("h2", { style: "margin-top:0;font-family:var(--font-display);" }, "Settings"),

    el("div", { class: "group" },
      el("h3", {}, "Appearance"),
      el("div", { class: "row" },
        el("div", { class: "label" },
          el("div", { class: "t" }, "Theme"),
          el("div", { class: "d" }, "Choose between light and dark — saved across devices."),
        ),
        el("div", { class: `switch ${document.documentElement.getAttribute("data-theme") === "dark" ? "on" : ""}`, onclick: (e) => {
          toggleTheme();
          e.currentTarget.classList.toggle("on");
          updateDoc(doc(db, "users", state.uid), { themePref: document.documentElement.getAttribute("data-theme") }).catch(() => {});
        }}),
      ),
    ),

    el("div", { class: "group" },
      el("h3", {}, "Verification"),
      el("div", { class: "row" },
        el("div", { class: "label" },
          el("div", { class: "t" }, state.me.verified ? "Verified ✓" : "Get verified by location"),
          el("div", { class: "d" }, state.me.verified
            ? `You're verified${state.me.location?.city ? " in " + state.me.location.city : ""}.`
            : "Allow Orbit to read your location once. We only store an approximate area, never live tracking."),
        ),
        state.me.verified
          ? el("button", { class: "btn ghost", onclick: async () => {
              await updateDoc(doc(db, "users", state.uid), { verified: false, location: null });
              toast("Verification removed");
              router();
            }}, "Remove")
          : el("button", { class: "btn primary", onclick: requestLocationVerification }, "Verify"),
      ),
    ),

    el("div", { class: "group" },
      el("h3", {}, "Notifications"),
      el("div", { class: "row" },
        el("div", { class: "label" },
          el("div", { class: "t" }, "Browser notifications"),
          el("div", { class: "d" }, "Get pings for new messages and Orbits.")),
        el("button", { class: "btn ghost", onclick: async () => {
          const p = await Notification.requestPermission();
          toast(p === "granted" ? "Notifications enabled" : "Notifications denied");
        }}, "Enable"),
      ),
    ),

    el("div", { class: "group" },
      el("h3", {}, "Account"),
      el("div", { class: "row" }, el("div", { class: "label" }, el("div", { class: "t" }, "Email"), el("div", { class: "d" }, state.me.email || "—"))),
      el("div", { class: "row" }, el("div", { class: "label" }, el("div", { class: "t" }, "Username"), el("div", { class: "d" }, "@" + state.me.username))),
      el("div", { class: "row" },
        el("div", { class: "label" }, el("div", { class: "t" }, "Sign out"), el("div", { class: "d" }, "End your session on this device.")),
        el("button", { class: "btn ghost", onclick: () => $("#signOutBtn").click() }, "Sign out"),
      ),
    ),

    el("div", { class: "group" },
      el("h3", {}, el("i", { class: "ri-vip-crown-line", style: "color:var(--grad-1);margin-right:6px;" }), "Orbit Pro"),
      el("div", { class: "row" },
        el("div", { class: "label" },
          el("div", { class: "t" }, state.me.isPro ? "Pro activated ✦" : "Go Professional"),
          el("div", { class: "d" }, state.me.isPro
            ? "You have access to Orbit Score, Tech Stack, Skill Badges, Build in Public and Project Showcase."
            : "Unlock developer features: Orbit Score, Tech Stack, Skill Badges, Build in Public & Project Showcase."),
        ),
        state.me.isPro
          ? el("span", { class: "pro-active-badge" }, el("i", { class: "ri-vip-crown-fill" }), " Active")
          : el("button", { class: "btn primary", onclick: async (e) => {
              e.currentTarget.disabled = true;
              e.currentTarget.textContent = "Activating…";
              await updateDoc(doc(db, "users", state.uid), { isPro: true }).catch(() => {});
              state.me.isPro = true;
              state.cache.users.delete(state.uid);
              toast("Welcome to Orbit Pro! ✦");
              router();
            }}, el("i", { class: "ri-vip-crown-line" }), " Activate Pro"),
      ),
    ),

    el("div", { class: "group" },
      el("h3", {}, "Storage"),
      el("div", { class: "row" }, el("div", { class: "label" },
        el("div", { class: "t" }, "Cloudinary"),
        el("div", { class: "d" }, cloudinaryConfig.cloudName.startsWith("YOUR_")
          ? "Not configured — uploads will fail until you set cloudName + uploadPreset in app.js."
          : `Connected to "${cloudinaryConfig.cloudName}"`)),
      ),
    ),
  );
  root.appendChild(wrap);
};

// Verification by location (one-time geolocation)
const requestLocationVerification = () => {
  if (!("geolocation" in navigator)) { toast("Location not available on this device"); return; }
  toast("Requesting location…");
  navigator.geolocation.getCurrentPosition(async (pos) => {
    const { latitude: lat, longitude: lng } = pos.coords;
    let city = null;
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=10`);
      const j = await r.json();
      city = j.address?.city || j.address?.town || j.address?.state || j.display_name?.split(",")[0] || null;
    } catch {}
    await updateDoc(doc(db, "users", state.uid), {
      verified: true,
      verifiedAt: serverTimestamp(),
      location: { lat: Math.round(lat * 100) / 100, lng: Math.round(lng * 100) / 100, city },
    });
    toast("✓ You're verified");
    router();
  }, (err) => {
    toast("Location denied — verification not granted");
  }, { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 });
};

// =========================================================================
// 14. COMPOSE MODAL — posts, reels, groups
// =========================================================================
const composeModal = $("#composeModal");
const openCompose = (which = "post") => {
  if ((which === "build" || which === "project") && !state.me?.isPro) {
    import("./features.js").then((m) => m.showGoProModal()).catch(() => {});
    return;
  }
  composeModal.classList.remove("hidden");
  $$(".ct").forEach((b) => b.classList.toggle("active", b.dataset.ctab === which));
  $$(".compose-pane").forEach((p) => p.classList.toggle("hidden", !p.id.startsWith(which)));
};
$("#composeBtn")?.addEventListener("click", () => openCompose("post"));
$("#composeBtnMobile")?.addEventListener("click", () => openCompose("post"));
$$(".ct").forEach((b) => b.addEventListener("click", () => openCompose(b.dataset.ctab)));

document.addEventListener("click", (e) => {
  if (e.target.matches("[data-close-modal]") || e.target.closest("[data-close-modal]")) {
    composeModal.classList.add("hidden");
  }
  if (e.target.matches("[data-close-drawer]") || e.target.closest("[data-close-drawer]")) {
    $("#chatCustomize").classList.add("hidden");
  }
});

// Post media — up to 3 files (images or one video)
let postFiles = [];
const MAX_POST_FILES = 3;

const refreshPostPreviews = () => {
  const prev = $("#postPreview");
  if (!prev) return;
  prev.innerHTML = "";
  postFiles.forEach((file, i) => {
    const url = URL.createObjectURL(file);
    const isVid = file.type.startsWith("video/");
    const wrap = el("div", { class: "post-preview-thumb" },
      isVid
        ? el("video", { src: url, muted: "", playsinline: "", style: "width:100%;height:100%;object-fit:cover;" })
        : el("img", { src: url }),
      el("button", { class: "thumb-remove", onclick: () => {
        postFiles.splice(i, 1);
        refreshPostPreviews();
      }}, el("i", { class: "ri-close-circle-fill" })),
    );
    prev.appendChild(wrap);
  });
  const countEl = $("#postFileCount");
  if (countEl) countEl.textContent = postFiles.length ? `${postFiles.length}/${MAX_POST_FILES} file${postFiles.length > 1 ? "s" : ""}` : "";
};

let _postLocation = null;
document.getElementById("postLocationBtn")?.addEventListener("click", () => {
  if (!("geolocation" in navigator)) { toast("Location not available"); return; }
  const btn = document.getElementById("postLocationBtn");
  btn.innerHTML = '<i class="ri-loader-4-line" style="animation:spin 1s linear infinite;"></i>';
  navigator.geolocation.getCurrentPosition(async (pos) => {
    const { latitude: lat, longitude: lng } = pos.coords; let city = null;
    try { const r = await fetch("https://nominatim.openstreetmap.org/reverse?format=json&lat=" + lat + "&lon=" + lng + "&zoom=10"); const j = await r.json(); city = j.address?.city || j.address?.town || j.address?.state || (j.display_name || "").split(",")[0] || null; } catch {}
    _postLocation = { lat: Math.round(lat * 100) / 100, lng: Math.round(lng * 100) / 100, city };
    const tag = document.getElementById("postLocationTag"); if (tag) { tag.textContent = city || "My location"; tag.style.display = ""; }
    btn.innerHTML = '<i class="ri-map-pin-fill" style="color:var(--primary);"></i>';
    toast("Tagged: " + (city || "your location"));
  }, () => { toast("Location access denied"); btn.innerHTML = '<i class="ri-map-pin-line"></i>'; }, { timeout: 8000 });
});

$("#postPickMedia").addEventListener("click", () => {
  if (postFiles.length >= MAX_POST_FILES) { toast(`Max ${MAX_POST_FILES} files per post`); return; }
  $("#postMedia").click();
});
$("#postMedia").addEventListener("change", (e) => {
  const files = Array.from(e.target.files || []);
  for (const file of files) {
    if (postFiles.length >= MAX_POST_FILES) break;
    // Only allow 1 video
    if (file.type.startsWith("video/") && postFiles.some((f) => f.type.startsWith("video/"))) {
      toast("Only one video per post"); continue;
    }
    postFiles.push(file);
  }
  e.target.value = "";
  refreshPostPreviews();
});

$("#postForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const textEl = e.target.querySelector("textarea[name='text']");
  const text = (textEl?.value || "").trim();
  if (!text && !postFiles.length) { toast("Write something or pick a file first"); return; }
  const btn = e.target.querySelector("button[type='submit']");
  btn.disabled = true; btn.textContent = "Posting…";
  try {
    let media = null;
    if (postFiles.length === 1) {
      toast("Uploading…");
      media = await uploadToCloudinary(postFiles[0], postFiles[0].type.startsWith("video/") ? "video" : "image");
    } else if (postFiles.length > 1) {
      toast("Uploading files…");
      media = await Promise.all(postFiles.map((f) =>
        uploadToCloudinary(f, f.type.startsWith("video/") ? "video" : "image")));
    }
    const hashtags = extractHashtags(text);
    const _pd = { authorUid: state.uid, text, media, hashtags, orbits: [], orbitCount: 0, commentCount: 0, createdAt: serverTimestamp() };
    if (_postLocation) { _pd.location = _postLocation; _postLocation = null; }
    await addDoc(collection(db, "posts"), _pd);
    e.target.reset(); postFiles = []; refreshPostPreviews();
    const _lt = document.getElementById("postLocationTag"); if (_lt) { _lt.style.display = "none"; _lt.textContent = ""; }
    const _lb = document.getElementById("postLocationBtn"); if (_lb) _lb.innerHTML = '<i class="ri-map-pin-line"></i>';
    composeModal.classList.add("hidden"); toast("Posted!");
  } catch (err) {
    toast("Failed to post: " + (err.message || "unknown error"));
  } finally {
    btn.disabled = false; btn.textContent = "Post";
  }
});

$("#reelForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const file = $("#reelMedia").files[0];
  if (!file) { toast("Pick a video first"); return; }
  const btn = e.target.querySelector("button[type='submit']");
  btn.disabled = true; btn.textContent = "Uploading…";
  try {
    toast("Uploading reel…");
    const media = await uploadToCloudinary(file, "video");
    const capEl = e.target.querySelector("input[name='caption']");
    const _rd = { authorUid: state.uid, caption: (capEl?.value || "").trim(), media, likes: [], likeCount: 0, commentCount: 0, createdAt: serverTimestamp() };
    await addDoc(collection(db, "reels"), _rd);
    e.target.reset();
    composeModal.classList.add("hidden");
    toast("Reel uploaded!");
    location.hash = "#reels";
  } catch (err) {
    toast("Upload failed: " + (err.message || "check Cloudinary config"));
  } finally {
    btn.disabled = false; btn.textContent = "Upload reel";
  }
});

$("#groupForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const name = (fd.get("name") || "").trim();
  if (!name) { toast("Give the group a name"); return; }
  const btn = e.target.querySelector("button[type='submit']");
  btn.disabled = true; btn.textContent = "Creating…";
  try {
    const ref = await addDoc(collection(db, "groups"), {
      name,
      about: fd.get("about") || "",
      isPublic: fd.get("isPublic") === "on",
      ownerUid: state.uid,
      admins: [state.uid],
      members: [state.uid],
      createdAt: serverTimestamp(),
    });
    await addDoc(collection(db, "groups", ref.id, "messages"), {
      type: "system", text: `${state.me.name} created the group`,
      createdAt: serverTimestamp(),
    });
    e.target.reset();
    composeModal.classList.add("hidden");
    toast("Group created!");
    location.hash = `#chats/${ref.id}`;
  } catch (err) {
    toast("Failed to create group: " + (err.message || "check Firebase config"));
  } finally {
    btn.disabled = false; btn.textContent = "Create group";
  }
});

// =========================================================================
// FEED REEL CARD
// =========================================================================
const renderFeedReelCard = (reel) => {
  const card = el("div", { class: "feed-reel-card" });
  const vid = el("video", { src: reel.media?.url, muted: "", playsinline: "", loop: "", style: "width:100%;height:240px;object-fit:cover;cursor:pointer;display:block;" });
  card.appendChild(el("div", { class: "frc-label" }, el("i", { class: "ri-film-fill" }), " Reels for you"));
  card.appendChild(vid);
  if (reel.caption) card.appendChild(el("div", { class: "frc-caption", text: reel.caption.slice(0, 80) }));
  card.appendChild(el("div", { class: "frc-actions" }, el("button", { class: "btn ghost", style: "font-size:13px;gap:6px;", onclick: () => location.hash = "#reels" }, el("i", { class: "ri-play-circle-line" }), "Watch more reels")));
  vid.addEventListener("click", () => {
    if (vid.paused) vid.play();
    else vid.pause();
  });
  new IntersectionObserver((en) => en.forEach((e) => {
    if (e.isIntersecting) vid.play().catch(()=>{});
    else vid.pause();
  }), { threshold: 0.5 }).observe(vid);
  return card;
};
// =========================================================================
// EXPERIENCE MINI CARD
// =========================================================================
const renderExperienceMiniCard = (ex, author) => {
  const cc = { travel:"#5cd3ff",food:"#ff8a5a",adventure:"#3fdca0",music:"#ff5cae",fitness:"#ffb04a",art:"#7c5cff",tech:"#4ab8ff",life:"#ff5cae" };
  return el("div", { class: "exp-mini-card", onclick: () => openExperienceThread(ex) },
    el("div", { class: "exp-mini-cat", style: "background:" + (cc[ex.category] || "var(--primary)") + ";" }, ex.category || "experience"),
    el("div", { class: "exp-mini-title", text: ex.title || "Experience" }),
    el("div", { class: "exp-mini-author" }, el("img", { class: "avatar xs", src: avatarFor(author) }), el("span", {}, author?.name || "User")),
    ex.replyCount ? el("div", { class: "exp-mini-replies" }, el("i", { class: "ri-reply-fill" }), " " + ex.replyCount + " replies") : null,
  );
};
// =========================================================================
// EXPERIENCE THREAD
// =========================================================================
const openExperienceThread = async (ex) => {
  const overlay = el("div", { class: "exp-thread-overlay" });
  const sheet   = el("div", { class: "exp-thread-sheet" });
  sheet.appendChild(el("button", { class: "icon-btn exp-close-btn", onclick: () => overlay.remove() }, el("i", { class: "ri-close-line" })));
  sheet.appendChild(await buildExperienceCard(ex));
  sheet.appendChild(el("div", { class: "exp-replies-head" }, el("span", {}, "Replies"),
    el("button", { class: "btn primary", style: "padding:6px 14px;font-size:13px;", onclick: () => { overlay.remove(); _replyToExpId = ex.id; openCompose("experience"); } }, el("i", { class: "ri-sparkling-line" }), "Share yours")));
  const carousel = el("div", { class: "exp-replies-carousel" }); sheet.appendChild(carousel);
  getDocs(query(collection(db, "experiences", ex.id, "replies"), orderBy("createdAt", "desc"), limit(20))).then(async (snap) => {
    if (snap.empty) { carousel.appendChild(el("div", { class: "exp-empty-replies" }, "Be the first to reply!")); return; }
    const ras = await Promise.all(snap.docs.map((d) => fetchUser(d.data().authorUid)));
    const rm  = Object.fromEntries(ras.filter(Boolean).map((u) => [u.uid, u]));
    for (const d of snap.docs) carousel.appendChild(await buildExperienceCard({ id: d.id, ...d.data() }, rm[d.data().authorUid], true));
  }).catch(() => {});
  overlay.appendChild(sheet);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
};
let _replyToExpId = null;
const buildExperienceCard = async (ex, authorPre = null, compact = false) => {
  const author = authorPre || await fetchUser(ex.authorUid);
  const cc = { travel:"#5cd3ff",food:"#ff8a5a",adventure:"#3fdca0",music:"#ff5cae",fitness:"#ffb04a",art:"#7c5cff",tech:"#4ab8ff",life:"#ff5cae" };
  const card = el("div", { class: "exp-card" + (compact ? " compact" : "") });
  if (ex.imageUrl) card.appendChild(el("img", { src: ex.imageUrl, class: "exp-card-img", loading: "lazy" }));
  card.appendChild(el("div", { class: "exp-cat-tag", style: "background:" + (cc[ex.category] || "var(--primary)") + ";" }, ex.category || "experience"));
  card.appendChild(el("div", { class: "exp-card-title", text: ex.title || "" }));
  if (ex.description) card.appendChild(el("div", { class: "exp-card-desc", text: ex.description.slice(0, 200) }));
  if (ex.location?.city) card.appendChild(el("div", { class: "post-location-badge" }, el("i", { class: "ri-map-pin-fill" }), " " + ex.location.city));
  card.appendChild(el("div", { class: "exp-card-author" }, el("img", { class: "avatar xs", src: avatarFor(author) }), el("span", { class: "exp-author-name" }, author?.name || "User"), el("span", { class: "exp-author-time" }, fmtTime(ex.createdAt))));
  return card;
};
// =========================================================================
// EXPERIENCE FORM
// =========================================================================
let _expLocation = null, _expMediaFile = null;
document.getElementById("expLocationBtn")?.addEventListener("click", () => {
  if (!("geolocation" in navigator)) { toast("Location not available"); return; }
  const btn = document.getElementById("expLocationBtn");
  btn.innerHTML = '<i class="ri-loader-4-line" style="animation:spin 1s linear infinite;"></i>';
  navigator.geolocation.getCurrentPosition(async (pos) => {
    const { latitude: lat, longitude: lng } = pos.coords; let city = null;
    try { const r = await fetch("https://nominatim.openstreetmap.org/reverse?format=json&lat=" + lat + "&lon=" + lng + "&zoom=10"); const j = await r.json(); city = j.address?.city || j.address?.town || j.address?.state || (j.display_name || "").split(",")[0] || null; } catch {}
    _expLocation = { lat: Math.round(lat * 100) / 100, lng: Math.round(lng * 100) / 100, city };
    const tag = document.getElementById("expLocationTag"); if (tag) { tag.textContent = city || "My location"; tag.style.display = ""; }
    btn.innerHTML = '<i class="ri-map-pin-fill" style="color:var(--primary);"></i>';
    toast("Tagged: " + (city || "your location"));
  }, () => { toast("Location access denied"); btn.innerHTML = '<i class="ri-map-pin-line"></i>'; }, { timeout: 8000 });
});
document.getElementById("expPickMedia")?.addEventListener("click", () => document.getElementById("expMedia")?.click());
document.getElementById("expMedia")?.addEventListener("change", (e) => { _expMediaFile = e.target.files?.[0] || null; const lbl = document.getElementById("expMediaLabel"); if (lbl) lbl.textContent = _expMediaFile ? _expMediaFile.name : ""; });
document.getElementById("experienceForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = (document.getElementById("expTitle")?.value || "").trim();
  const desc  = (document.getElementById("expDesc")?.value  || "").trim();
  const cat   = document.getElementById("expCategory")?.value || "life";
  if (!title) { toast("Give your experience a title"); return; }
  const btn = e.target.querySelector("button[type=submit]"); btn.disabled = true;
  try {
    let imageUrl = null;
    if (_expMediaFile) { toast("Uploading..."); const up = await uploadToCloudinary(_expMediaFile, _expMediaFile.type.startsWith("video") ? "video" : "image"); imageUrl = up.url; }
    const data = { authorUid: state.uid, title, description: desc, category: cat, imageUrl, location: _expLocation || null, replyCount: 0, createdAt: serverTimestamp() };
    if (_replyToExpId) { await addDoc(collection(db, "experiences", _replyToExpId, "replies"), data); await updateDoc(doc(db, "experiences", _replyToExpId), { replyCount: increment(1) }); _replyToExpId = null; }
    else await addDoc(collection(db, "experiences"), data);
    e.target.reset(); _expLocation = null; _expMediaFile = null;
    const t2 = document.getElementById("expLocationTag"); if (t2) { t2.style.display = "none"; t2.textContent = ""; }
    const l2 = document.getElementById("expMediaLabel"); if (l2) l2.textContent = "";
    composeModal.classList.add("hidden"); toast("Experience shared!"); router();
  } catch (err) { toast("Failed: " + (err.message || "unknown")); }
  finally { btn.disabled = false; }
});

// =========================================================================
// 15. SUGGESTIONS + TRENDING right rail
// =========================================================================
const startSuggestions = () => {
  // Suggested users (latest accounts I don't follow)
  onSnapshot(query(collection(db, "users"), orderBy("createdAt", "desc"), limit(8)), (snap) => {
    const list = $("#suggestList"); if (!list) return;
    list.innerHTML = "";
    snap.docs.forEach((d) => {
      const u = { uid: d.id, ...d.data() };
      if (u.uid === state.uid) return;
      const iFollow = (state.me.following || []).includes(u.uid);
      list.appendChild(el("div", { class: "suggest-row" },
        el("img", { class: "avatar sm", src: avatarFor(u), onclick: () => location.hash = `#profile/${u.uid}` }),
        el("div", { class: "meta" },
          el("div", { class: "name" }, u.name,
            u.verified ? el("span", { class: "verified", html: '<i class="ri-check-line"></i>' }) : null),
          el("div", { class: "uname" }, "@" + u.username),
        ),
        el("button", { class: `btn sm ${iFollow ? "ghost" : "primary"}`, onclick: async () => {
          const meRef = doc(db, "users", state.uid);
          const themRef = doc(db, "users", u.uid);
          const batch = writeBatch(db);
          if (iFollow) {
            batch.update(meRef, { following: arrayRemove(u.uid) });
            batch.update(themRef, { followers: arrayRemove(state.uid) });
          } else {
            batch.update(meRef, { following: arrayUnion(u.uid) });
            batch.update(themRef, { followers: arrayUnion(state.uid) });
          }
          await batch.commit();
        }}, iFollow ? "Following" : "Follow"),
      ));
    });
  });

  // Trending posts
  onSnapshot(query(collection(db, "posts"), orderBy("orbitCount", "desc"), limit(5)), (snap) => {
    const list = $("#trendList"); if (!list) return;
    list.innerHTML = "";
    snap.docs.forEach((d) => {
      const p = d.data();
      list.appendChild(el("div", {},
        el("div", { class: "trend-tag", text: (p.text || "Untitled").slice(0, 60) }),
        el("div", { class: "trend-meta" }, `${p.orbitCount || 0} Orbits · ${fmtTime(p.createdAt)}`),
      ));
    });
  });
};

// Search
$("#globalSearch").addEventListener("keydown", async (e) => {
  if (e.key !== "Enter") return;
  const q1 = e.target.value.trim().toLowerCase().replace(/^@/, "");
  if (!q1) return;
  const qs = await getDocs(query(collection(db, "users"), where("username", ">=", q1), where("username", "<=", q1 + "\uf8ff"), limit(1)));
  if (qs.empty) { toast("No user found"); return; }
  location.hash = `#profile/${qs.docs[0].id}`;
});

// =========================================================================
// 15b. PROFILE EDIT MODAL
// =========================================================================
(() => {
  const modal = document.getElementById("profileEditModal");
  const save  = document.getElementById("editProfileSave");
  if (!modal || !save) return;
  let pendingAvFile = null;
  const closeModal = () => { modal.style.display = "none"; modal.classList.add("hidden"); pendingAvFile = null; };
  document.getElementById("profileEditClose")?.addEventListener("click", closeModal);
  document.getElementById("editProfileCancel")?.addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });
  document.getElementById("editAvatarWrap")?.addEventListener("click", () => document.getElementById("editAvatarInput")?.click());
  document.getElementById("editAvatarInput")?.addEventListener("change", (e) => { const f = e.target.files?.[0]; if (!f) return; pendingAvFile = f; const av = document.getElementById("editAvatar"); if (av) av.src = URL.createObjectURL(f); });
  save.addEventListener("click", async () => {
    const nameV = (document.getElementById("editName")?.value || "").trim();
    const userV = (document.getElementById("editUsername")?.value || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
    const bioV  = (document.getElementById("editBio")?.value || "").trim();
    if (!nameV) { toast("Name cannot be empty"); return; }
    const st = document.getElementById("editSaveText"); if (st) st.textContent = "Saving..."; save.disabled = true;
    try {
      const updates = { name: nameV, bio: bioV, username: userV || state.me.username };
      if (pendingAvFile) { toast("Uploading photo..."); const up = await uploadToCloudinary(pendingAvFile, "image"); updates.photoURL = up.url; }
      await updateDoc(doc(db, "users", state.uid), updates);
      toast("Profile updated"); closeModal(); router();
    } catch (err) { toast("Save failed: " + (err.message || "unknown")); }
    finally { save.disabled = false; if (st) st.textContent = "Save changes"; }
  });
})();

// =========================================================================
// 16. INIT
// =========================================================================
initTheme();
// Hide boot once auth state resolved (handled in onAuthStateChanged)
setTimeout(() => $("#boot").classList.add("hidden"), 1200);
