// =========================================================================
// Orbit — chat.js
// Chats list, real-time messaging, DMs + groups, replies, reactions,
// edit/delete, typing indicator, read receipts, per-chat customization,
// emoji picker, attachments via Cloudinary, swipe-to-reply on touch.
// =========================================================================

import {
  state, db, auth, $, $$, el, fmtTime, fmtDay, escapeHtml, linkify,
  toast, avatarFor, fetchUser, uploadToCloudinary, writeNotif,
} from "./app.js";

import {
  doc, setDoc, getDoc, updateDoc, addDoc, deleteDoc,
  collection, query, where, orderBy, limit, onSnapshot, getDocs,
  serverTimestamp, increment, arrayUnion, arrayRemove, deleteField,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

// ─────────────────────────────────────────────────────────────────────────────
// VIDEO PLAYER — custom player replacing bare <video controls>
// ─────────────────────────────────────────────────────────────────────────────
const _cloudPoster = (url) => {
  try { return url.replace(/\.mp4(\?.*)?$/, ".jpg").replace(/\.webm(\?.*)?$/, ".jpg").replace(/\.mov(\?.*)?$/, ".jpg"); }
  catch { return ""; }
};
const buildVideoPlayer = (url, opts = {}) => {
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

// ─────────────────────────────────────────────────────────────────────────────
// VOICE NOTE — custom waveform player
// ─────────────────────────────────────────────────────────────────────────────
const buildVoicePlayer = (url) => {
  const audio   = new Audio(url);
  const playI   = el("i", { class: "ri-play-fill" });
  const playBtn = el("button", { class: "vnp-play" }, playI);
  const played  = el("div", { class: "vnp-played" });
  const bar     = el("div", { class: "vnp-bar" }, played);
  const timeEl  = el("span", { class: "vnp-time", text: "0:00" });
  const wrap    = el("div", { class: "voice-note-player" }, playBtn, bar, timeEl);
  playBtn.onclick = () => { audio.paused ? audio.play() : audio.pause(); };
  audio.addEventListener("play",  () => { playI.className = "ri-pause-fill"; });
  audio.addEventListener("pause", () => { playI.className = "ri-play-fill";  });
  audio.addEventListener("ended", () => { playI.className = "ri-play-fill"; played.style.width = "0%"; });
  audio.addEventListener("timeupdate", () => {
    const pct = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
    played.style.width = pct + "%";
    const s = Math.floor(audio.currentTime);
    timeEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  });
  bar.onclick = (e) => { if (!audio.duration) return; const r = bar.getBoundingClientRect(); audio.currentTime = ((e.clientX - r.left) / r.width) * audio.duration; };
  return wrap;
};

// Voice recording state
let _mediaRecorder = null;
let _audioChunks   = [];
let _recTimerTo    = null;

// ─────────────────────────────────────────────────────────────────────────────
// STICKER PACKS — Google Noto Animated Emoji (Google CDN, no API key needed)
// ─────────────────────────────────────────────────────────────────────────────
const _G = (code) => `https://fonts.gstatic.com/s/e/notoemoji/latest/${code}/lottie.json`;
const STICKER_PACKS = [
  { category: "Faces", stickers: [
    { name: "Grinning",       url: _G("1f600") },
    { name: "Tears of Joy",   url: _G("1f602") },
    { name: "ROFL",           url: _G("1f923") },
    { name: "Heart Eyes",     url: _G("1f60d") },
    { name: "Smiling Hearts", url: _G("1f970") },
    { name: "Cool",           url: _G("1f60e") },
    { name: "Thinking",       url: _G("1f914") },
    { name: "Crying",         url: _G("1f622") },
    { name: "Sobbing",        url: _G("1f62d") },
    { name: "Annoyed",        url: _G("1f624") },
    { name: "Mind Blown",     url: _G("1f92f") },
    { name: "Party Face",     url: _G("1f973") },
    { name: "Sleepy",         url: _G("1f634") },
    { name: "Smirk",          url: _G("1f60f") },
    { name: "Eye Roll",       url: _G("1f644") },
    { name: "Devil",          url: _G("1f608") },
    { name: "Star Struck",    url: _G("1f929") },
    { name: "Unamused",       url: _G("1f612") },
    { name: "Grimace",        url: _G("1f62c") },
    { name: "Salute",         url: _G("1fae1") },
    { name: "Facepalm",       url: _G("1f926") },
  ]},
  { category: "Hearts & Vibes", stickers: [
    { name: "Red Heart",      url: _G("2764_fe0f") },
    { name: "Broken Heart",   url: _G("1f494") },
    { name: "Two Hearts",     url: _G("1f495") },
    { name: "Sparkling Heart",url: _G("1f496") },
    { name: "Fire",           url: _G("1f525") },
    { name: "100",            url: _G("1f4af") },
    { name: "Explosion",      url: _G("1f4a5") },
    { name: "Rainbow",        url: _G("1f308") },
    { name: "Star",           url: _G("2b50") },
    { name: "Glowing Star",   url: _G("1f31f") },
    { name: "Moon",           url: _G("1f319") },
    { name: "Sun",            url: _G("2600_fe0f") },
    { name: "Lightning",      url: _G("26a1") },
    { name: "Snowflake",      url: _G("2744_fe0f") },
  ]},
  { category: "Gestures", stickers: [
    { name: "Thumbs Up",      url: _G("1f44d") },
    { name: "Thumbs Down",    url: _G("1f44e") },
    { name: "Clapping",       url: _G("1f44f") },
    { name: "Praying",        url: _G("1f64f") },
    { name: "Muscle",         url: _G("1f4aa") },
    { name: "Handshake",      url: _G("1f91d") },
    { name: "Love Hands",     url: _G("1faf6") },
    { name: "Rocket",         url: _G("1f680") },
    { name: "Party Popper",   url: _G("1f389") },
    { name: "Confetti Ball",  url: _G("1f38a") },
    { name: "Wave",           url: _G("1f44b") },
    { name: "Peace",          url: _G("270c_fe0f") },
    { name: "OK Hand",        url: _G("1f44c") },
    { name: "Crossed Fingers",url: _G("1f91e") },
  ]},
  { category: "Animals", stickers: [
    { name: "Dog",            url: _G("1f436") },
    { name: "Cat",            url: _G("1f431") },
    { name: "Panda",          url: _G("1f43c") },
    { name: "Fox",            url: _G("1f98a") },
    { name: "Rabbit",         url: _G("1f430") },
    { name: "Penguin",        url: _G("1f427") },
    { name: "Koala",          url: _G("1f428") },
    { name: "Lion",           url: _G("1f981") },
    { name: "Frog",           url: _G("1f438") },
    { name: "Wolf",           url: _G("1f43a") },
    { name: "Bear",           url: _G("1f43b") },
    { name: "Monkey",         url: _G("1f435") },
    { name: "Unicorn",        url: _G("1f984") },
    { name: "Dolphin",        url: _G("1f42c") },
  ]},
  { category: "Food", stickers: [
    { name: "Pizza",          url: _G("1f355") },
    { name: "Burger",         url: _G("1f354") },
    { name: "Sushi",          url: _G("1f363") },
    { name: "Coffee",         url: _G("2615") },
    { name: "Cake",           url: _G("1f382") },
    { name: "Avocado",        url: _G("1f951") },
    { name: "Donut",          url: _G("1f369") },
    { name: "Taco",           url: _G("1f32e") },
    { name: "Ramen",          url: _G("1f35c") },
    { name: "Strawberry",     url: _G("1f353") },
    { name: "Boba Tea",       url: _G("1f9cb") },
    { name: "Ice Cream",      url: _G("1f368") },
  ]},
  { category: "Sports", stickers: [
    { name: "Soccer",         url: _G("26bd") },
    { name: "Basketball",     url: _G("1f3c0") },
    { name: "Trophy",         url: _G("1f3c6") },
    { name: "Game Controller",url: _G("1f3ae") },
    { name: "Medal",          url: _G("1f3c5") },
    { name: "Tennis",         url: _G("1f3be") },
    { name: "Boxing Glove",   url: _G("1f94a") },
    { name: "Dart",           url: _G("1f3af") },
    { name: "Bowling",        url: _G("1f3b3") },
    { name: "Bicycle",        url: _G("1f6b2") },
  ]},
  { category: "Travel", stickers: [
    { name: "Airplane",       url: _G("2708_fe0f") },
    { name: "Rocket",         url: _G("1f680") },
    { name: "Globe",          url: _G("1f30d") },
    { name: "Mountain",       url: _G("26f0_fe0f") },
    { name: "Camera",         url: _G("1f4f8") },
    { name: "Car",            url: _G("1f697") },
    { name: "Compass",        url: _G("1f9ed") },
    { name: "Luggage",        url: _G("1f9f3") },
    { name: "Map",            url: _G("1f5fa_fe0f") },
    { name: "Tent",           url: _G("26fa") },
  ]},
  { category: "Celebrate", stickers: [
    { name: "Party Popper",   url: _G("1f389") },
    { name: "Fireworks",      url: _G("1f386") },
    { name: "Gift",           url: _G("1f381") },
    { name: "Balloon",        url: _G("1f388") },
    { name: "Confetti",       url: _G("1f38a") },
    { name: "Sparkles",       url: _G("2728") },
    { name: "Crown",          url: _G("1f451") },
    { name: "Clinking Mugs",  url: _G("1f37b") },
    { name: "Trophy",         url: _G("1f3c6") },
    { name: "Champagne",      url: _G("1f942") },
  ]},
];

// =========================================================================
// 1. WALLPAPER + COLOR PRESETS
// =========================================================================
const WALLPAPERS = [
  { id: "none",   name: "None",    css: null },
  { id: "aurora", name: "Aurora",  css: "linear-gradient(135deg, #7c5cff, #ff5cae, #5cd3ff)" },
  { id: "night",  name: "Night",   css: "radial-gradient(circle at 30% 20%, #1f2657 0%, #0b0b1c 70%)" },
  { id: "paper",  name: "Paper",   css: "repeating-linear-gradient(90deg, #f7f3ee 0 24px, #efe9e1 24px 25px)" },
  { id: "mesh",   name: "Mesh",    css: "radial-gradient(circle at 20% 30%, #ff8aa8 0, transparent 40%), radial-gradient(circle at 80% 70%, #6cf 0, transparent 40%), #1c1830" },
  { id: "mint",   name: "Mint",    css: "linear-gradient(135deg, #b9f7d8, #6cd4a4)" },
  { id: "ink",    name: "Ink",     css: "radial-gradient(circle at 50% 50%, #2b2b44, #08080f)" },
  { id: "sun",    name: "Sun",     css: "linear-gradient(135deg, #ffd58a, #ff8a5a)" },
];
const BUBBLE_COLORS = [
  "linear-gradient(135deg, #7c5cff, #ff5cae)",
  "linear-gradient(135deg, #5cd3ff, #7c5cff)",
  "linear-gradient(135deg, #3fdca0, #5cd3ff)",
  "linear-gradient(135deg, #ff8a5a, #ff5cae)",
  "linear-gradient(135deg, #ffb04a, #ff5c7a)",
  "#2563eb", "#10b981", "#ef4444", "#f59e0b", "#0ea5e9",
];
const FONT_MAP = {
  inter:   '"Inter", sans-serif',
  jakarta: '"Plus Jakarta Sans", sans-serif',
  mono:    '"JetBrains Mono", monospace',
};
const EMOJIS = "😀 😅 😂 🤣 😊 😍 🥰 😘 😎 🤩 🤔 😴 🤤 😭 😢 😤 😡 🥺 😳 🤯 🤗 🤝 👍 👏 🙌 🙏 💯 🔥 ✨ 💖 💔 💞 💪 🎉 🎊 🥳 🎁 ☕ 🍕 🍔 🍣 🍜 🍩 🍰 🍷 🍺 ⚽ 🏀 🎮 🎧 🎤 🎬 📷 📚 ✈️ 🚗 🌍 🌙 ☀️ 🌧️ 🌈 ⭐".split(" ");

// =========================================================================
// 2. ENTRY — open the chats route
// =========================================================================
document.addEventListener("orbit:open-chats", (e) => openChats(e.detail?.peerUid || null));

// =========================================================================
// 3. SHELL
// =========================================================================
const openChats = (target) => {
  const content = $("#content");
  content.innerHTML = "";

  // Lock the content container so the chat grid owns all scrolling
  content.classList.add("chat-active");

  // Clean up when user navigates away
  const removeActive = () => {
    content.classList.remove("chat-active");
  };
  window.addEventListener("hashchange", removeActive, { once: true });

  const route = el("div", { class: "chats-route", id: "chatsRoute" });
  content.appendChild(route);

  // Left: chat list
  const list = el("div", { class: "chats-list" },
    el("div", { class: "head" },
      el("h2", {}, "Chats"),
      el("div", { class: "right" },
        el("button", { class: "icon-btn", title: "New chat", onclick: openNewChatPicker },
          el("i", { class: "ri-edit-box-line" })),
      )),
    el("div", { class: "search" },
      el("input", { type: "text", id: "chatSearch", placeholder: "Search chats" })),
    el("div", { class: "chats-scroll", id: "chatsScroll" },
      el("div", { class: "empty" },
        el("i", { class: "ri-loader-4-line" }),
        el("div", { class: "t" }, "Loading"))),
  );
  route.appendChild(list);

  // Right: chat view (empty placeholder)
  const view = el("div", { class: "chat-view", id: "chatView" },
    el("div", { class: "chat-empty" },
      el("i", { class: "ri-chat-3-line" }),
      el("div", {}, "Select a chat to start messaging"),
      el("div", { style: "margin-top:6px;color:var(--text-mute);font-size:13px;" }, "or tap the pencil icon to start a new one")),
  );
  route.appendChild(view);

  loadChatsList();

  if (target) {
    // target may be a uid (DM) or a group id
    openChatById(target);
  }
};

// =========================================================================
// 4. CHAT LIST  — DMs (chats/) and Groups I'm in
// =========================================================================
const loadChatsList = () => {
  const scroll = $("#chatsScroll");
  // Clean up previous listener
  if (state.chatsUnsub) { state.chatsUnsub(); state.chatsUnsub = null; }

  // We listen to my chat-meta docs at users/{uid}/chats — these are always created/updated via sendMessage.
  state.chatsUnsub = onSnapshot(
    query(collection(db, "users", state.uid, "chats"), orderBy("updatedAt", "desc"), limit(80)),
    async (snap) => {
      // also fetch groups I'm a member of
      const groupQs = await getDocs(query(collection(db, "groups"), where("members", "array-contains", state.uid)));
      const groups = groupQs.docs.map((d) => ({
        id: d.id, kind: "group", ...d.data(),
        updatedAt: d.data().lastMessageAt || d.data().createdAt,
      }));

      const dms = await Promise.all(snap.docs.map(async (d) => {
        const data = d.data();
        const peer = await fetchUser(data.peerUid);
        return { id: d.id, kind: "dm", peer, ...data };
      }));

      const all = [...dms, ...groups].sort((a, b) => {
        const av = a.updatedAt?.toMillis?.() || 0, bv = b.updatedAt?.toMillis?.() || 0;
        return bv - av;
      });

      scroll.innerHTML = "";
      if (!all.length) {
        scroll.appendChild(el("div", { class: "empty" },
          el("i", { class: "ri-chat-3-line" }),
          el("div", { class: "t" }, "No chats yet"),
          el("div", {}, "Tap the pencil to start one.")));
        return;
      }

      let totalUnread = 0;
      all.forEach((c) => {
        const node = renderChatRow(c);
        if (c.kind === "dm") totalUnread += c.unread || 0;
        scroll.appendChild(node);
      });
      const pill = $("#chatsPill");
      if (pill) { pill.hidden = totalUnread === 0; pill.textContent = String(totalUnread); }
    });

  // Search filter
  $("#chatSearch")?.addEventListener("input", (e) => {
    const q1 = e.target.value.toLowerCase();
    $$("#chatsScroll .chat-row").forEach((row) => {
      const txt = row.dataset.search || "";
      row.style.display = txt.includes(q1) ? "" : "none";
    });
  });
};

const renderChatRow = (c) => {
  const isGroup = c.kind === "group";
  const name = isGroup ? c.name : c.peer?.name || "Unknown";
  const verified = !isGroup && c.peer?.verified;
  const sub = isGroup ? `${(c.members || []).length} members` : (c.peer?.online ? "online" : c.peer?.lastSeen ? `last seen ${fmtTime(c.peer.lastSeen)}` : "");
  const preview = c.lastMessage || (isGroup ? "Tap to open group" : "Say hi");
  const time = fmtTime(c.updatedAt || c.lastMessageAt || c.createdAt);
  const pinned = (state.me.pinnedChats || []).includes(c.id);
  const muted = (state.me.mutedChats || []).includes(c.id);
  const unread = c.unread || 0;

  const row = el("div", {
    class: `chat-row ${pinned ? "pinned" : ""} ${state.activeChat === c.id ? "active" : ""}`,
    data: { search: (name + " " + preview).toLowerCase() },
    onclick: () => openChatById(isGroup ? c.id : c.peerUid),
    oncontextmenu: (e) => { e.preventDefault(); chatRowMenu(c); },
  },
    el("div", { class: "av" },
      el("img", { class: "avatar md",
        src: isGroup
          ? `https://api.dicebear.com/7.x/shapes/svg?seed=${c.id}`
          : avatarFor(c.peer) }),
      !isGroup && c.peer?.online ? el("span", { class: "online" }) : null,
    ),
    el("div", { class: "meta" },
      el("div", { class: "name" }, name,
        verified ? el("span", { class: "verified", html: '<i class="ri-check-line"></i>' }) : null,
        isGroup ? el("i", { class: "ri-group-2-line", style: "color:var(--text-mute);font-size:12px;" }) : null),
      el("div", { class: c.typing ? "preview typing" : "preview" },
        c.typing ? "typing…" : (c.lastFromMe ? el("span", { class: "you" }, "You: ") : null),
        c.typing ? "" : preview),
    ),
    el("div", { class: "right" },
      el("div", { class: "time" }, time),
      muted ? el("i", { class: "ri-notification-off-line muted-icon" }) : null,
      unread > 0 ? el("div", { class: "badge" }, String(unread)) : null,
    ),
  );
  return row;
};

const chatRowMenu = (c) => {
  const pinned = (state.me.pinnedChats || []).includes(c.id);
  const muted = (state.me.mutedChats || []).includes(c.id);
  const opts = [
    { label: pinned ? "Unpin" : "Pin", action: async () =>
        updateDoc(doc(db, "users", state.uid), { pinnedChats: pinned ? arrayRemove(c.id) : arrayUnion(c.id) }) },
    { label: muted ? "Unmute" : "Mute", action: async () =>
        updateDoc(doc(db, "users", state.uid), { mutedChats: muted ? arrayRemove(c.id) : arrayUnion(c.id) }) },
  ];
  if (c.kind === "dm") opts.push({ label: "Delete chat", action: async () => {
    if (!confirm("Delete this chat for you?")) return;
    await deleteDoc(doc(db, "users", state.uid, "chats", c.id));
  }});
  const choice = prompt(opts.map((o, i) => `${i + 1}. ${o.label}`).join("\n") + "\n\nEnter number:");
  const idx = parseInt(choice) - 1;
  if (opts[idx]) opts[idx].action();
};

// =========================================================================
// 5. NEW CHAT PICKER
// =========================================================================
const openNewChatPicker = async () => {
  const u = prompt("Username to message (without @):");
  if (!u) return;
  const qs = await getDocs(query(collection(db, "users"), where("username", "==", u.toLowerCase().replace(/^@/, ""))));
  if (qs.empty) { toast("User not found"); return; }
  openChatById(qs.docs[0].id);
};

// =========================================================================
// 6. OPEN CHAT (DM by uid, or group by id)
// =========================================================================
const dmChatId = (a, b) => [a, b].sort().join("__"); // deterministic doc id

const openChatById = async (target) => {
  if (!target) return;

  // Check if target is a group
  let isGroup = false;
  let chatId = null;
  let peer = null;

  const groupSnap = await getDoc(doc(db, "groups", target));
  if (groupSnap.exists()) {
    isGroup = true; chatId = target;
  } else {
    peer = await fetchUser(target);
    if (!peer) { toast("User not found"); return; }
    chatId = dmChatId(state.uid, peer.uid);
    // Ensure my chat-meta exists
    const myChatRef = doc(db, "users", state.uid, "chats", chatId);
    const exists = (await getDoc(myChatRef)).exists();
    if (!exists) {
      await setDoc(myChatRef, {
        peerUid: peer.uid, lastMessage: "", lastFromMe: false, unread: 0,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
    }
    // Reset unread for me
    await updateDoc(myChatRef, { unread: 0 });
  }

  state.activeChat = chatId;
  $("#chatsRoute")?.classList.add("is-open");
  renderChatView({ isGroup, chatId, peer, group: isGroup ? { id: groupSnap.id, ...groupSnap.data() } : null });
  // Mark active in list
  $$("#chatsScroll .chat-row").forEach((r) => r.classList.remove("active"));
};

// =========================================================================
// 7. RENDER CHAT VIEW
// =========================================================================
let typingDebounce = null;
let replyingTo = null;

const renderChatView = ({ isGroup, chatId, peer, group }) => {
  const view = $("#chatView");
  view.innerHTML = "";

  const messagesPath = isGroup ? ["groups", chatId, "messages"] : ["chats", chatId, "messages"];

  // Apply per-chat customization
  const cust = (state.me.chatCustomization || {})[chatId] || {};
  applyChatCustomization(view, cust);

  // HEAD
  const head = el("div", { class: "chat-head" },
    el("button", { class: "icon-btn back", onclick: () => $("#chatsRoute").classList.remove("is-open") },
      el("i", { class: "ri-arrow-left-line" })),
    el("img", { class: "avatar md",
      src: isGroup ? `https://api.dicebear.com/7.x/shapes/svg?seed=${chatId}` : avatarFor(peer),
      onclick: () => isGroup ? null : (location.hash = `#profile/${peer.uid}`),
    }),
    el("div", { class: "info" },
      el("div", { class: "name" }, isGroup ? group.name : peer.name,
        !isGroup && peer.verified ? el("span", { class: "verified", html: '<i class="ri-check-line"></i>' }) : null),
      el("div", { class: "sub", id: "chatSub" },
        isGroup ? `${(group.members || []).length} members` :
          (peer.online ? "online" : (peer.lastSeen ? `last seen ${fmtTime(peer.lastSeen)}` : ""))),
    ),
    el("div", { class: "right" },
      el("button", { class: "icon-btn", title: "Search in chat", onclick: () => searchInChat(chatId, isGroup) },
        el("i", { class: "ri-search-line" })),
      el("button", { class: "btn ghost", style: "padding:6px 12px;font-size:13px;gap:6px;", title: "Customize", onclick: () => openCustomize(chatId) },
        el("i", { class: "ri-palette-line" }), el("span", { class: "hide-xs" }, "Customize")),
      el("button", { class: "icon-btn", title: "More options", onclick: () => chatHeaderMenu({ isGroup, chatId, peer, group }) },
        el("i", { class: "ri-more-2-line" })),
    ),
  );
  view.appendChild(head);

  // MESSAGES
  const messages = el("div", { class: "messages", id: "messages" });
  view.appendChild(messages);

  // BOTTOM BAR — one grid child wrapping all bottom UI (reply, attach preview, composer)
  const bottomBar = el("div", { class: "chat-bottom-bar", id: "chatBottomBar" });

  // Reply preview (hidden until replying)
  const replyPreview = el("div", { class: "reply-preview hidden", id: "replyPreview" });
  bottomBar.appendChild(replyPreview);

  // Attachment preview strip (hidden until file picked)
  const attachPreview = el("div", { class: "attach-preview hidden", id: "attachPreviewStrip" });
  bottomBar.appendChild(attachPreview);

  // COMPOSER
  const composerField = el("div", { class: "field", id: "composerField", contenteditable: "true",
    "data-placeholder": "Message", spellcheck: "true" });
  composerField.addEventListener("input", () => {
    const hasText = composerField.textContent.trim().length > 0;
    const sendBtn = bottomBar.querySelector("#sendBtn");
    const micBtn  = bottomBar.querySelector("#micBtn");
    const stickerInBtn = bottomBar.querySelector("#composerStickerInlineBtn");
    const active  = hasText || !!pendingAttachment;
    if (sendBtn) { sendBtn.disabled = !active; sendBtn.style.display = active ? "" : "none"; }
    if (micBtn)  micBtn.style.display = active ? "none" : "";
    if (stickerInBtn) stickerInBtn.classList.toggle("hidden", hasText);
    if (sendBtn) sendBtn.disabled = !active;
    // typing indicator
    if (!isGroup) {
      updateDoc(doc(db, "chats", chatId), { typing: { [state.uid]: serverTimestamp() } }, { merge: true }).catch(async () => {
        await setDoc(doc(db, "chats", chatId), { typing: { [state.uid]: serverTimestamp() } }, { merge: true });
      });
      clearTimeout(typingDebounce);
      typingDebounce = setTimeout(() => {
        updateDoc(doc(db, "chats", chatId), { [`typing.${state.uid}`]: deleteField() }).catch(() => {});
      }, 2200);
    }
    localStorage.setItem(`orbit:draft:${chatId}`, composerField.innerText);
  });
  composerField.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  });
  composerField.addEventListener("focus", () => { const p = document.getElementById("orbitStickerPicker"); if (p) { p.classList.add("closing"); setTimeout(() => p.remove(), 220); } });

  const sendBtnEl = el("button", { class: "send", id: "sendBtn", disabled: true, onclick: send },
    el("i", { class: "ri-send-plane-fill" }));
  const micBtnEl = el("button", { class: "ctrl mic-btn", id: "micBtn", title: "Voice note",
    onclick: () => startVoiceRecord(chatId, isGroup) },
    el("i", { class: "ri-mic-line" }));

  const _stickerInlineBtn = el("button", {
    class: "ctrl composer-sticker-inline", id: "composerStickerInlineBtn", title: "Stickers",
    onclick: (e) => { e.stopPropagation(); toggleStickerPicker(chatId, isGroup); },
  }, el("i", { class: "ri-sticky-note-2-line" }));
  const _composerInputWrap = el("div", { class: "composer-input-wrap" }, composerField, _stickerInlineBtn);
  const composer = el("div", { class: "composer" },
    el("button", { class: "ctrl", title: "Emoji", onclick: toggleEmojiPicker },
      el("i", { class: "ri-emotion-line" })),
    _composerInputWrap,
    el("button", { class: "ctrl", title: "Attach photo/video", onclick: () => pickAttachment(chatId) },
      el("i", { class: "ri-image-add-line" })),
    micBtnEl,
    sendBtnEl,
  );
  bottomBar.appendChild(composer);
  view.appendChild(bottomBar);

  // Restore draft
  const draft = localStorage.getItem(`orbit:draft:${chatId}`);
  if (draft) {
    composerField.innerText = draft;
    bottomBar.querySelector("#sendBtn").disabled = false;
  }

  // Live messages listener
  if (state.chatUnsub) state.chatUnsub();
  state.chatUnsub = onSnapshot(
    query(collection(db, ...messagesPath), orderBy("createdAt", "asc"), limit(200)),
    async (snap) => await renderMessages(messages, snap, { isGroup, chatId, peer }),
  );

  // Typing/online indicator (DM only)
  if (!isGroup) {
    onSnapshot(doc(db, "chats", chatId), async (s) => {
      const d = s.data() || {};
      const peerTyping = d.typing && d.typing[peer.uid];
      const ts = peerTyping?.toMillis?.() || 0;
      const fresh = Date.now() - ts < 4000;
      const sub = $("#chatSub");
      if (fresh) {
        sub.textContent = "typing…"; sub.classList.add("typing");
      } else {
        const fresh2 = await fetchPeerLive(peer.uid);
        sub.classList.remove("typing");
        sub.textContent = fresh2.online ? "online" : (fresh2.lastSeen ? `last seen ${fmtTime(fresh2.lastSeen)}` : "");
      }
    });
  }

  async function send() {
    const field = $("#composerField");
    const text = field.innerText.trim();
    if (!text && !pendingAttachment) return;
    const sendBtn = $("#sendBtn");
    sendBtn.disabled = true;

    // Optimistic bubble — shows instantly with plain textContent (no entity issues)
    const optReply = replyingTo ? { ...replyingTo } : null;
    const optEl = _buildOptimisticRow(text, optReply);
    const msgsRoot = $("#messages");
    if (msgsRoot) { msgsRoot.appendChild(optEl); msgsRoot.scrollTop = msgsRoot.scrollHeight; }

    field.innerText = "";
    localStorage.removeItem(`orbit:draft:${chatId}`);
    clearReply();

    try {
      let media = null;
      if (pendingAttachment) {
        toast("Uploading…");
        media = await uploadToCloudinary(pendingAttachment, pendingAttachment.type.startsWith("video") ? "video" : "image");
        pendingAttachment = null;
        const strip = $("#attachPreviewStrip");
        if (strip) { strip.innerHTML = ""; strip.classList.add("hidden"); }
      }

      const _voSend = pendingViewOnce; pendingViewOnce = false;
      const msg = {
        authorUid: state.uid,
        text: text || "",
        media,
        viewOnce: _voSend,
        replyTo: optReply ? {
          id: optReply.id, text: optReply.text || (optReply.media ? "[media]" : ""),
          authorUid: optReply.authorUid, authorName: optReply.authorName || "",
        } : null,
        reactions: {},
        readBy: [state.uid],
        createdAt: serverTimestamp(),
      };
      await addDoc(collection(db, ...messagesPath), msg);

      if (isGroup) {
        await updateDoc(doc(db, "groups", chatId), { lastMessage: text || "[media]", lastMessageAt: serverTimestamp() });
      } else {
        const updateMeta = async (forUid, otherUid, isMe) => {
          const ref = doc(db, "users", forUid, "chats", chatId);
          const exists = (await getDoc(ref)).exists();
          const data = { peerUid: otherUid, lastMessage: text || "[media]", lastFromMe: isMe, updatedAt: serverTimestamp() };
          if (!isMe) data.unread = increment(1);
          if (exists) await updateDoc(ref, data); else await setDoc(ref, { ...data, unread: isMe ? 0 : 1, createdAt: serverTimestamp() });
        };
        await Promise.all([updateMeta(state.uid, peer.uid, true), updateMeta(peer.uid, state.uid, false)]);
        updateDoc(doc(db, "chats", chatId), { [`typing.${state.uid}`]: deleteField() }).catch(() => {});
        // Notify recipient — in-app bell + push notification
        writeNotif(peer.uid, "message", { text: (text || "[media]").slice(0, 60) }).catch(() => {});
        import("./notifications.js").then(({ notifyUser }) =>
          notifyUser(peer.uid, state.me?.name || "New message", text || "Sent you a message", "/#chats")
        ).catch(() => {});
      }
    } catch (err) {
      optEl?.remove();
      field.innerText = text;
      toast("Send failed: " + (err.message || "check Firebase config"));
    } finally {
      const f2 = $("#composerField");
      const hasLeftover = !!f2?.textContent.trim() || !!pendingAttachment;
      sendBtn.disabled = !hasLeftover;
      sendBtn.style.display = hasLeftover ? "" : "none";
      const _mb = document.getElementById("micBtn"); if (_mb) _mb.style.display = hasLeftover ? "none" : "";
      const _sb = document.getElementById("composerStickerInlineBtn");
      if (_sb && !hasLeftover) _sb.classList.remove("hidden");
    }
  }

  function _buildOptimisticRow(msgText, replyTo) {
    const bubble = el("div", { class: "bubble" });
    if (replyTo) {
      bubble.appendChild(el("div", { class: "reply-quote" },
        el("div", { class: "q-name", text: replyTo.authorName || "User" }),
        el("div", { text: (replyTo.text || "").slice(0, 120) || "[media]" }),
      ));
    }
    if (msgText) { const t = el("span", {}); t.textContent = msgText; bubble.appendChild(t); }
    const meta = el("span", { class: "meta" }); meta.textContent = "sending…";
    bubble.appendChild(document.createTextNode(" ")); bubble.appendChild(meta);
    const row = el("div", { class: "msg-row from-me optimistic" });
    row.appendChild(bubble); return row;
  }
};

// =========================================================================
// ─────────────────────────────────────────────────────────────────────────────
// VOICE RECORDING
// ─────────────────────────────────────────────────────────────────────────────
const startVoiceRecord = async (chatId, isGroup) => {
  if (_mediaRecorder) { stopVoiceRecord(chatId, isGroup); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    _audioChunks = [];
    const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/ogg";
    _mediaRecorder = new MediaRecorder(stream, { mimeType: mime });
    _mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) _audioChunks.push(e.data); };
    _mediaRecorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(_audioChunks, { type: _mediaRecorder.mimeType });
      _mediaRecorder = null; _audioChunks = [];
      const micBtn = document.getElementById("micBtn");
      if (micBtn) { micBtn.classList.remove("recording"); micBtn.querySelector("i").className = "ri-mic-line"; }
      _showVoiceDraft(blob, chatId, isGroup);
    };
    _mediaRecorder.start(200);
    const micBtn = document.getElementById("micBtn");
    if (micBtn) { micBtn.classList.add("recording"); micBtn.querySelector("i").className = "ri-stop-circle-line"; }
    toast("Recording… tap mic again to send");
    _recTimerTo = setTimeout(() => stopVoiceRecord(chatId, isGroup), 120000);
  } catch { toast("Microphone access denied"); }
};

const stopVoiceRecord = (chatId, isGroup) => {
  clearTimeout(_recTimerTo);
  if (_mediaRecorder && _mediaRecorder.state !== "inactive") _mediaRecorder.stop();
};

const _showVoiceDraft = (blob, chatId, isGroup) => {
  const _prev = document.getElementById("voiceDraftBar");
  if (_prev) _prev.remove();
  const objUrl = URL.createObjectURL(blob);
  const audio = new Audio(objUrl);
  let _playing = false;
  const playBtn = el("button", { class: "icon-btn vd-play", title: "Preview",
    onclick: () => {
      if (_playing) {
        audio.pause(); audio.currentTime = 0;
        playBtn.querySelector("i").className = "ri-play-fill"; _playing = false;
      } else {
        audio.play();
        playBtn.querySelector("i").className = "ri-pause-fill"; _playing = true;
      }
    }}, el("i", { class: "ri-play-fill" }));
  audio.onended = () => { playBtn.querySelector("i").className = "ri-play-fill"; _playing = false; };
  const bar = el("div", { id: "voiceDraftBar", class: "voice-draft-bar" },
    el("i", { class: "ri-mic-fill vd-icon" }),
    el("span", { class: "vd-label" }, "Voice note ready"),
    playBtn,
    el("button", { class: "icon-btn vd-delete", title: "Delete",
      onclick: () => { audio.pause(); URL.revokeObjectURL(objUrl); bar.remove(); }
    }, el("i", { class: "ri-delete-bin-line" })),
    el("button", { class: "icon-btn vd-send", title: "Send",
      onclick: async () => {
        bar.remove();
        toast("Sending voice note…");
        try {
          const file = new File([blob], "voice.webm", { type: blob.type });
          const up = await uploadToCloudinary(file, "video");
          const colPath = isGroup ? ["groups", chatId, "messages"] : ["chats", chatId, "messages"];
          await addDoc(collection(db, ...colPath), {
            authorUid: state.uid, type: "voice",
            media: { url: up.url, type: "audio", duration: up.duration || 0 },
            createdAt: serverTimestamp(), readBy: [state.uid],
          });
        } catch { toast("Could not send voice note"); }
      }
    }, el("i", { class: "ri-send-plane-fill" })),
  );
  const bottomBar = document.getElementById("chatBottomBar");
  if (bottomBar) bottomBar.insertAdjacentElement("beforebegin", bar);
  else document.body.appendChild(bar);
};

// 8. RENDER MESSAGES (with day dividers, bubbles, reactions, replies)
// =========================================================================
const renderMessages = async (root, snap, { isGroup, chatId, peer }) => {
  const wasNearBottom = root.scrollTop + root.clientHeight >= root.scrollHeight - 80;
  // Save existing video players keyed by src so they don't re-buffer on re-render
  const _savedVids = {};
  root.querySelectorAll(".vid-player").forEach((vp) => {
    const v = vp.querySelector("video");
    if (v?.src) _savedVids[v.src] = vp;
  });
  root.innerHTML = "";

  if (snap.empty) {
    root.appendChild(el("div", { class: "chat-empty", style: "height:100%;" },
      el("i", { class: "ri-emotion-laugh-line" }),
      el("div", {}, "No messages yet — send the first one")));
    return;
  }

  const msgs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  // Resolve authors for groups
  const authorsNeeded = isGroup ? [...new Set(msgs.map((m) => m.authorUid).filter(Boolean))] : [];
  const authorMap = isGroup
    ? Object.fromEntries((await Promise.all(authorsNeeded.map(fetchUser))).filter(Boolean).map((u) => [u.uid, u]))
    : { [peer?.uid]: peer, [state.uid]: state.me };

  let lastDayKey = null;
  let lastAuthor = null;

  for (const m of msgs) {
    const ts = m.createdAt?.toDate?.() || new Date();
    const dayKey = ts.toDateString();
    if (dayKey !== lastDayKey) {
      root.appendChild(el("div", { class: "day-divider", text: fmtDay(m.createdAt) }));
      lastDayKey = dayKey;
      lastAuthor = null;
    }

    if (m.type === "system") {
      root.appendChild(el("div", { class: "system-msg", text: m.text }));
      continue;
    }

    const fromMe = m.authorUid === state.uid;
    const author = authorMap[m.authorUid];
    const showAv = isGroup && !fromMe && lastAuthor !== m.authorUid;

    // Mark as read by me
    if (!m.readBy?.includes(state.uid)) {
      const path = isGroup ? ["groups", chatId, "messages", m.id] : ["chats", chatId, "messages", m.id];
      updateDoc(doc(db, ...path), { readBy: arrayUnion(state.uid) }).catch(() => {});
    }

    const bubble = el("div", { class: "bubble" });
    if (isGroup && !fromMe) bubble.appendChild(el("div", { class: "sender", text: author?.name || "User" }));

    if (m.replyTo) {
      bubble.appendChild(el("div", { class: "reply-quote", onclick: () => jumpToMessage(m.replyTo.id) },
        el("div", { class: "q-name", text: m.replyTo.authorName || authorMap[m.replyTo.authorUid]?.name || "User" }),
        el("div", { text: (m.replyTo.text || "").slice(0, 120) || "[media]" }),
      ));
    }

    if (m.type === "voice" && m.media?.url) {
      bubble.appendChild(buildVoicePlayer(m.media.url));
    } else if (m.media?.url) {
      if (m.viewOnce) {
        if (fromMe) {
          // Sender: show media + small badge
          const _mc = m.media.type === "video"
            ? (_savedVids[m.media.url] || buildVideoPlayer(m.media.url))
            : el("img", { src: m.media.url, loading: "lazy" });
          bubble.appendChild(el("div", { class: "b-media" },
            _mc, el("div", { class: "view-once-badge" },
              el("i", { class: "ri-eye-line" }), " View once")));
        } else if ((m.viewedBy || []).includes(state.uid)) {
          // Already seen — show expired placeholder
          bubble.appendChild(el("div", { class: "b-media" },
            el("div", { class: "view-once-expired" },
              el("i", { class: "ri-eye-off-line" }), " Opened")));
        } else {
          // Not yet seen — solid "Tap to view" box
          // On tap: replace cover directly with raw media (no extra wrapper)
          const _cover = el("div", { class: "view-once-cover" },
            el("i", { class: "ri-eye-line" }),
            el("span", {}, " Tap to view"));
          _cover.addEventListener("click", async () => {
            const _rm = m.media.type === "video"
              ? buildVideoPlayer(m.media.url)
              : el("img", { src: m.media.url });
            // Replace the cover with the raw media element inside the same .b-media wrapper
            _cover.replaceWith(_rm);
            const _vp = isGroup
              ? ["groups", chatId, "messages", m.id]
              : ["chats", chatId, "messages", m.id];
            updateDoc(doc(db, ..._vp), { viewedBy: arrayUnion(state.uid) }).catch(() => {});
          });
          bubble.appendChild(el("div", { class: "b-media" }, _cover));
        }
      } else {
        let mediaContent;
        if (m.media.type === "video") {
          mediaContent = _savedVids[m.media.url] || buildVideoPlayer(m.media.url);
        } else {
          mediaContent = el("img", { src: m.media.url, loading: "lazy" });
        }
        bubble.appendChild(el("div", { class: "b-media" }, mediaContent));
      }
    }

    // Sticker message — remove ALL bubble styling so it's fully transparent like WhatsApp
    if (m.type === "sticker" && m.stickerUrl) {
      bubble.className = "sticker-bubble"; // replace 'bubble' entirely — no bg, no padding, no shadow
      const lp = document.createElement("lottie-player");
      lp.setAttribute("src", m.stickerUrl);
      lp.setAttribute("background", "transparent");
      lp.setAttribute("speed", "1");
      lp.setAttribute("loop", "");
      lp.setAttribute("autoplay", "");
      lp.setAttribute("title", m.stickerName || "Sticker");
      lp.style.cssText = "width:150px;height:150px;display:block;pointer-events:none;";
      bubble.appendChild(lp);
    } else if (m.text) {
      const t = el("span", {});
      if (m.deleted) {
        t.innerHTML = '<i class="ri-error-warning-line"></i> Message deleted';
        t.style.opacity = ".7"; t.style.fontStyle = "italic";
      } else {
        // Render plain text (preserves apostrophes, ampersands etc.) and
        // only promote to innerHTML when the message contains a URL
        t.textContent = m.text;
        const raw = m.text;
        const linked = raw.replace(/(https?:\/\/[^\s]+)/g, (url) => {
          const safe = url.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
          return `<a href="${safe}" target="_blank" rel="noopener" style="color:var(--primary);text-decoration:underline;">${safe}</a>`;
        });
        if (linked !== raw) t.innerHTML = linked;
      }
      bubble.appendChild(t);
    }

    // meta (time, edited, status)
    const meta = el("span", { class: "meta" });
    if (m.editedAt) meta.appendChild(el("span", { class: "edited", text: "edited · " }));
    meta.appendChild(document.createTextNode(fmtTime(m.createdAt)));
    if (fromMe) {
      const seen = (m.readBy || []).filter((u) => u !== state.uid).length > 0;
      meta.appendChild(el("span", { class: "read", html: seen ? '<i class="ri-check-double-line"></i>' : '<i class="ri-check-line"></i>' }));
    }
    bubble.appendChild(document.createTextNode(" "));
    bubble.appendChild(meta);

    // Reactions
    if (m.reactions && Object.keys(m.reactions).length) {
      const counts = {};
      for (const emoji of Object.values(m.reactions)) counts[emoji] = (counts[emoji] || 0) + 1;
      const rx = el("div", { class: "reactions" });
      for (const [emoji, cnt] of Object.entries(counts)) {
        rx.appendChild(el("span", {}, emoji + (cnt > 1 ? " " + cnt : "")));
      }
      bubble.appendChild(rx);
    }

    // Hover actions
    const actions = el("div", { class: "msg-actions" },
      el("button", { title: "React", onclick: (e) => openReactPicker(e, m, isGroup, chatId) }, el("i", { class: "ri-emotion-line" })),
      el("button", { title: "Reply", onclick: () => setReply(m, author?.name) }, el("i", { class: "ri-reply-line" })),
      el("button", { title: "Copy", onclick: () => { navigator.clipboard.writeText(m.text || ""); toast("Copied"); } }, el("i", { class: "ri-file-copy-line" })),
      fromMe && !m.deleted ? el("button", { title: "Edit", onclick: () => editMessage(m, isGroup, chatId) }, el("i", { class: "ri-edit-line" })) : null,
      fromMe ? el("button", { title: "Delete", onclick: () => deleteMessage(m, isGroup, chatId) }, el("i", { class: "ri-delete-bin-line" })) : null,
    );
    bubble.appendChild(actions);

    // Row
    const row = el("div", {
      class: `msg-row ${fromMe ? "from-me" : ""} ${!showAv && !fromMe ? "no-av" : ""}`,
      data: { id: m.id },
      ontouchstart: (e) => { row._tx = e.touches[0].clientX; },
      ontouchmove: (e) => {
        if (row._tx == null) return;
        const dx = e.touches[0].clientX - row._tx;
        if (Math.abs(dx) > 10) row.style.transform = `translateX(${dx * 0.3}px)`;
      },
      ontouchend: (e) => {
        if (row._tx == null) return;
        const dx = (e.changedTouches[0].clientX - row._tx);
        row.style.transform = "";
        if (Math.abs(dx) > 60) setReply(m, author?.name);
        row._tx = null;
      },
    });
    if (!fromMe) row.appendChild(el("img", { class: "av", src: avatarFor(author), style: showAv ? "" : "visibility:hidden;" }));
    row.appendChild(bubble);
    root.appendChild(row);

    lastAuthor = m.authorUid;
  }

  if (wasNearBottom) root.scrollTop = root.scrollHeight;
};

// =========================================================================
// 9. REPLY / EDIT / DELETE / REACT
// =========================================================================
const setReply = (m, authorName) => {
  replyingTo = { ...m, authorName };
  const p = $("#replyPreview");
  p.innerHTML = "";
  p.classList.remove("hidden");
  p.appendChild(el("div", { class: "bar" }));
  p.appendChild(el("div", { class: "info" },
    el("div", { class: "name", text: `Replying to ${authorName || "user"}` }),
    el("div", { class: "text", text: (m.text || (m.media ? "[media]" : "")).split(/\s+/).slice(0,5).join(" ") + ((m.text||"").split(/\s+/).length > 5 ? "…" : "") }),
  ));
  p.appendChild(el("button", { class: "icon-btn", onclick: clearReply }, el("i", { class: "ri-close-line" })));
  $("#composerField")?.focus();
};
const clearReply = () => {
  replyingTo = null;
  $("#replyPreview")?.classList.add("hidden");
};

const editMessage = async (m, isGroup, chatId) => {
  const next = prompt("Edit message", m.text || "");
  if (next == null || next === m.text) return;
  const path = isGroup ? ["groups", chatId, "messages", m.id] : ["chats", chatId, "messages", m.id];
  await updateDoc(doc(db, ...path), { text: next, editedAt: serverTimestamp() });
};

const deleteMessage = async (m, isGroup, chatId) => {
  const choice = confirm("Delete for everyone?\n\nOK = delete for everyone\nCancel = keep");
  if (!choice) return;
  const path = isGroup ? ["groups", chatId, "messages", m.id] : ["chats", chatId, "messages", m.id];
  await updateDoc(doc(db, ...path), { deleted: true, text: "", media: null });
};

const openReactPicker = (e, m, isGroup, chatId) => {
  e.stopPropagation();
  // Close any existing
  $$(".react-picker").forEach((n) => n.remove());
  const quick = ["❤️", "😂", "😮", "😢", "👍", "🔥"];
  const picker = el("div", { class: "react-picker" });
  quick.forEach((emo) => picker.appendChild(el("button", { onclick: async () => {
    const path = isGroup ? ["groups", chatId, "messages", m.id] : ["chats", chatId, "messages", m.id];
    const cur = m.reactions || {};
    const mine = cur[state.uid];
    if (mine === emo) await updateDoc(doc(db, ...path), { [`reactions.${state.uid}`]: deleteField() });
    else await updateDoc(doc(db, ...path), { [`reactions.${state.uid}`]: emo });
    picker.remove();
  }}, emo)));
  e.target.closest(".bubble").appendChild(picker);
  setTimeout(() => document.addEventListener("click", () => picker.remove(), { once: true }), 0);
};

// =========================================================================
// 10. EMOJI PICKER + ATTACHMENTS
// =========================================================================

// ─────────────────────────────────────────────────────────────────────────────
// STICKER PICKER
// ─────────────────────────────────────────────────────────────────────────────
const _sendSticker = async (chatId, sticker, isGroup) => {
  const { addDoc, collection, serverTimestamp } = await import("https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js");
  const { db, state } = await import("./app.js");
  const colPath = isGroup ? ["groups", chatId, "messages"] : ["chats", chatId, "messages"];
  await addDoc(collection(db, ...colPath), {
    type: "sticker",
    stickerUrl: sticker.url,
    stickerName: sticker.name,
    authorUid: state.uid,
    createdAt: serverTimestamp(),
    readBy: [state.uid],
  });
};

const toggleStickerPicker = (chatId, isGroup = false) => {
  // If already open, close it
  const existing = document.getElementById("orbitStickerPicker");
  if (existing) { existing.classList.add("closing"); setTimeout(() => existing.remove(), 220); return; }

  const picker = document.createElement("div");
  picker.id = "orbitStickerPicker";
  picker.className = "sticker-picker";

  // ── KEY FIX: stop ALL clicks inside picker from reaching the outside listener
  // This handles Lottie's shadow DOM — event still bubbles inside regular DOM
  // up to the picker element, which stops it. onOutside never fires for
  // anything inside the sheet.
  picker.addEventListener("click", (e) => e.stopPropagation());

  // Close helper — uses direct closure reference to picker (no getElementById race)
  const closePicker = () => {
    picker.classList.add("closing");
    setTimeout(() => { if (picker.isConnected) picker.remove(); }, 220);
  };

  // WhatsApp-style drag handle
  const handle = document.createElement("div");
  handle.className = "sticker-handle";
  picker.appendChild(handle);

  // Category tabs + grid
  const tabs = document.createElement("div");
  tabs.className = "sticker-tabs";
  const grid = document.createElement("div");
  grid.className = "sticker-grid";

  const showCat = (pack) => {
    tabs.querySelectorAll(".sticker-tab").forEach((t) =>
      t.classList.toggle("active", t.dataset.cat === pack.category));
    grid.innerHTML = "";
    pack.stickers.forEach((s) => {
      const cell = document.createElement("div");
      cell.className = "sticker-cell";
      cell.title = s.name;

      // pointer-events:none on lottie so cell div receives the click cleanly
      const lp = document.createElement("lottie-player");
      lp.setAttribute("src", s.url);
      lp.setAttribute("background", "transparent");
      lp.setAttribute("speed", "1");
      lp.setAttribute("loop", "");
      lp.setAttribute("autoplay", "");
      lp.style.cssText = "width:72px;height:72px;pointer-events:none;display:block;";
      cell.appendChild(lp);

      cell.addEventListener("click", async () => {
        // Remove picker immediately (before async — avoids any DOM timing issues)
        picker.remove();
        try {
          const colPath = isGroup
            ? ["groups", chatId, "messages"]
            : ["chats", chatId, "messages"];
          await addDoc(collection(db, ...colPath), {
            type: "sticker",
            stickerUrl: s.url,
            stickerName: s.name,
            authorUid: state.uid,
            createdAt: serverTimestamp(),
            readBy: [state.uid],
          });
        } catch { toast("Could not send sticker"); }
      });
      grid.appendChild(cell);
    });
  };

  STICKER_PACKS.forEach((pack) => {
    const tab = document.createElement("button");
    tab.className = "sticker-tab";
    tab.dataset.cat = pack.category;
    tab.textContent = pack.category;
    tab.addEventListener("click", () => showCat(pack));
    tabs.appendChild(tab);
  });

  picker.appendChild(tabs);
  picker.appendChild(grid);

  // ── Outside click — bubble phase (not capture) so picker.stopPropagation works
  const onOutside = (e) => {
    if (e.target.closest("[title='Stickers']")) return; // ignore sticker button
    closePicker();
    document.removeEventListener("click", onOutside);
  };
  setTimeout(() => document.addEventListener("click", onOutside), 60);

  // ── Append to document.body — zero layout shift, no insertBefore needed ──
  document.body.appendChild(picker);
  if (STICKER_PACKS[0]) showCat(STICKER_PACKS[0]);
};

let pendingAttachment = null;
let pendingViewOnce = false;

const toggleEmojiPicker = (e) => {
  e.stopPropagation();
  $$(".emoji-picker").forEach((n) => n.remove());
  const picker = el("div", { class: "emoji-picker" });
  EMOJIS.forEach((emo) => picker.appendChild(el("button", { onclick: () => {
    const f = $("#composerField");
    f.focus();
    document.execCommand?.("insertText", false, emo);
    $("#sendBtn").disabled = !f.textContent.trim();
  }}, emo)));
  $("#chatView").appendChild(picker);
  setTimeout(() => document.addEventListener("click", function once(ev) {
    if (!picker.contains(ev.target)) picker.remove();
    else document.addEventListener("click", once, { once: true });
  }, { once: true }), 0);
};

const pickAttachment = (chatId) => {
  const input = el("input", { type: "file", accept: "image/*,video/*", style: "display:none;" });
  document.body.appendChild(input);
  input.click();
  input.onchange = () => {
    pendingAttachment = input.files[0] || null;
    input.remove();
    if (!pendingAttachment) return;

    // Show preview strip
    const strip = $("#attachPreviewStrip");
    if (strip) {
      strip.innerHTML = "";
      strip.classList.remove("hidden");
      const objUrl = URL.createObjectURL(pendingAttachment);
      const preview = pendingAttachment.type.startsWith("video")
        ? el("video", { src: objUrl, muted: "true", playsinline: "" })
        : el("img", { src: objUrl });
      const removeBtn = el("button", { class: "remove", title: "Remove",
        onclick: () => {
          pendingAttachment = null;
          strip.innerHTML = ""; strip.classList.add("hidden");
          const f = $("#composerField");
          $("#sendBtn").disabled = !f?.textContent.trim();
        }
      }, el("i", { class: "ri-close-line" }));
      const _voBtn = el("button", { class: "view-once-toggle", onclick: () => {
        pendingViewOnce = !pendingViewOnce;
        _voBtn.classList.toggle("active", pendingViewOnce);
        _voBtn.querySelector("span").textContent = pendingViewOnce ? "View once • ON" : "View once";
      }}, el("i", { class: "ri-eye-line" }), el("span", {}, "View once"));
      strip.appendChild(preview);
      strip.appendChild(removeBtn);
      strip.appendChild(el("span", { style: "font-size:13px;color:var(--text-dim);", text: pendingAttachment.name }));
      strip.appendChild(_voBtn);
    }
    $("#sendBtn").disabled = false;
  };
};

// =========================================================================
// 11. CUSTOMIZATION DRAWER
// =========================================================================
const openCustomize = (chatId) => {
  const drawer = $("#chatCustomize");
  drawer.classList.remove("hidden");

  // Populate
  const cust = (state.me.chatCustomization || {})[chatId] || {};
  const wpHost = $("#wallpapers");
  wpHost.innerHTML = "";
  WALLPAPERS.forEach((wp) => {
    const tile = el("div", { class: `wallpaper wp-${wp.id} ${cust.wallpaper === wp.id ? "active" : ""}`, title: wp.name,
      onclick: () => saveCust(chatId, { wallpaper: wp.id }) });
    if (wp.id === "none") tile.appendChild(el("span", {}, "None"));
    wpHost.appendChild(tile);
  });

  const swHost = $("#bubbleSwatches");
  swHost.innerHTML = "";
  BUBBLE_COLORS.forEach((c) => {
    const sw = el("div", { class: `swatch ${cust.bubbleColor === c ? "active" : ""}`, style: `background:${c};`,
      onclick: () => saveCust(chatId, { bubbleColor: c }) });
    swHost.appendChild(sw);
  });

  $$("#bubbleShape button").forEach((b) => {
    b.classList.toggle("active", (cust.shape || "rounded") === b.dataset.shape);
    b.onclick = () => saveCust(chatId, { shape: b.dataset.shape });
  });
  $$("#bubbleFont button").forEach((b) => {
    b.classList.toggle("active", (cust.font || "inter") === b.dataset.font);
    b.onclick = () => saveCust(chatId, { font: b.dataset.font });
  });
  const sizeInput = $("#bubbleSize");
  sizeInput.value = cust.size || 15;
  sizeInput.oninput = () => saveCust(chatId, { size: Number(sizeInput.value) });
};

const saveCust = async (chatId, patch) => {
  const cur = (state.me.chatCustomization || {})[chatId] || {};
  const merged = { ...cur, ...patch };
  const updated = { ...(state.me.chatCustomization || {}), [chatId]: merged };
  state.me.chatCustomization = updated;
  applyChatCustomization($("#chatView"), merged);
  // re-render swatches active state
  if (patch.bubbleColor || patch.wallpaper || patch.shape || patch.font) openCustomize(chatId);
  await updateDoc(doc(db, "users", state.uid), { chatCustomization: updated }).catch(() => {});
};

const applyChatCustomization = (view, cust) => {
  if (!view) return;
  const wp = WALLPAPERS.find((w) => w.id === (cust.wallpaper || "none"));
  view.style.setProperty("--chat-wallpaper", wp?.css || "");
  view.style.setProperty("--bubble-size", (cust.size || 15) + "px");
  view.style.setProperty("--bubble-font", FONT_MAP[cust.font || "inter"]);
  view.dataset.shape = cust.shape || "rounded";
  // Inject scoped <style> so bubble colour override wins regardless of sheet specificity
  const bg = cust.bubbleColor || "linear-gradient(135deg, var(--grad-1), var(--grad-2))";
  let st = view.querySelector("style.orbit-cust");
  if (!st) { st = document.createElement("style"); st.className = "orbit-cust"; view.appendChild(st); }
  st.textContent = `#chatView .from-me .bubble { background: ${bg} !important; }`;
};

// =========================================================================
// 12. EXTRAS — search in chat, header menu, jump-to-message, peer live
// =========================================================================
const searchInChat = (chatId, isGroup) => {
  const q1 = prompt("Search messages")?.trim().toLowerCase();
  if (!q1) return;
  const matches = $$(".bubble").filter((b) => b.textContent.toLowerCase().includes(q1));
  if (!matches.length) { toast("No matches"); return; }
  matches[0].scrollIntoView({ behavior: "smooth", block: "center" });
  matches[0].animate(
    [{ outline: "2px solid var(--primary)" }, { outline: "2px solid transparent" }],
    { duration: 1500 },
  );
  toast(`${matches.length} match${matches.length > 1 ? "es" : ""}`);
};

const chatHeaderMenu = ({ isGroup, chatId, peer, group }) => {
  const opts = [];
  const muted = (state.me.mutedChats || []).includes(chatId);
  opts.push({ label: muted ? "Unmute notifications" : "Mute notifications", action: async () =>
    updateDoc(doc(db, "users", state.uid), { mutedChats: muted ? arrayRemove(chatId) : arrayUnion(chatId) }) });

  if (isGroup) {
    opts.push({ label: "Copy invite link", action: async () => {
      await navigator.clipboard.writeText(`${location.origin}${location.pathname}#chats/${chatId}`);
      toast("Invite link copied");
    }});
    opts.push({ label: "View members", action: async () => {
      const names = await Promise.all((group.members || []).map((u) => fetchUser(u).then((x) => x?.name || u)));
      alert("Members:\n" + names.join("\n"));
    }});
    if (group.ownerUid === state.uid) {
      opts.push({ label: "Delete group", action: async () => {
        if (!confirm("Delete group for everyone?")) return;
        await deleteDoc(doc(db, "groups", chatId));
        location.hash = "#chats";
      }});
    } else {
      opts.push({ label: "Leave group", action: async () => {
        await updateDoc(doc(db, "groups", chatId), { members: arrayRemove(state.uid) });
        location.hash = "#chats";
      }});
    }
  } else {
    opts.push({ label: "View profile", action: () => location.hash = `#profile/${peer.uid}` });
    opts.push({ label: "Clear my history", action: async () => {
      if (!confirm("Clear this chat from your side?")) return;
      const qs = await getDocs(collection(db, "chats", chatId, "messages"));
      // (Soft-clear: deletes each from server. For a true 'clear for me', a per-user clear timestamp would be used.)
      const ops = qs.docs.map((d) => deleteDoc(d.ref));
      await Promise.all(ops);
      toast("Cleared");
    }});
  }

  const choice = prompt(opts.map((o, i) => `${i + 1}. ${o.label}`).join("\n") + "\n\nEnter number:");
  const idx = parseInt(choice) - 1;
  if (opts[idx]) opts[idx].action();
};

const jumpToMessage = (id) => {
  const node = $$(`.msg-row`).find((r) => r.dataset.id === id);
  if (!node) { toast("Message not in view — scroll up"); return; }
  node.scrollIntoView({ behavior: "smooth", block: "center" });
  node.querySelector(".bubble")?.animate(
    [{ outline: "2px solid var(--primary)" }, { outline: "2px solid transparent" }],
    { duration: 1500 },
  );
};

const fetchPeerLive = async (uid) => {
  const s = await getDoc(doc(db, "users", uid));
  return s.data() || {};
};
