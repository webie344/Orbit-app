// =========================================================================
// Vibe — app.js
// Firebase init + Auth + Cloudinary + Router + Feed + Groups +
// Profile + Settings + Theme + Verified-by-location.
// Chat + DM logic lives in chat.js (it imports state from this file).
// =========================================================================

import { sfxOrbit, sfxComment, sfxPost } from "./sounds.js";

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
  // AI assistant settings (persisted in localStorage)
  aiName:   localStorage.getItem("vibe:ai_name")   || "Aria",
  aiAvatar: localStorage.getItem("vibe:ai_avatar") || "🤖",
  aiTone:   localStorage.getItem("vibe:ai_tone")   || "friendly",
};

// =========================================================================
// AI ASSISTANT CONSTANTS
// =========================================================================
// Set your Groq API key here or assign window.GROQ_API_KEY before this file loads.
// Get a free key at https://console.groq.com
window.GROQ_API_KEY = window.GROQ_API_KEY || "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";
window.GROQ_MODEL   = window.GROQ_MODEL   || "llama-3.3-70b-versatile";

const AI_TONES = {
  friendly:   { label: "Friendly & Warm",    emoji: "😊" },
  witty:      { label: "Witty & Playful",    emoji: "😄" },
  thoughtful: { label: "Thoughtful & Deep",  emoji: "🧠" },
  calm:       { label: "Calm & Supportive",  emoji: "🌿" },
  bold:       { label: "Bold & Direct",      emoji: "⚡" },
};

const AI_AVATARS = ["🤖","✨","🌟","💫","🎯","🧠","🌙","🔮","💡","🎭","🌊","🦋"];

function getAIChatSystem() {
  const name = state.aiName || "Aria";
  const tone = state.aiTone || "friendly";
  const styles = {
    friendly:   "warm, supportive, and upbeat — like a genuine friend",
    witty:      "playful and clever, with smart humor and banter",
    thoughtful: "reflective and curious, asking follow-up questions and going deep",
    calm:       "soothing, steady, and empathetic",
    bold:       "direct, confident, and to the point",
  };
  return `You are ${name}, an AI assistant built into Orbit — a social platform. You are ${styles[tone] || styles.friendly}.
Rules:
- Keep replies SHORT and conversational (1-3 sentences max unless the user asks for detail).
- Be genuinely helpful and engaging.
- Never be explicit, harmful, or offensive.
- Plain text only — no markdown, no asterisks.
- You can discuss anything: social life, advice, ideas, creative writing, tech, etc.`;
}

// Load / save AI chat history from Firestore (under users/{uid}/ai_chat doc)
async function loadAIHistory() {
  if (!state.uid) return [];
  try {
    const snap = await getDoc(doc(db, "users", state.uid));
    return snap.exists() ? (snap.data().aiMessages || []) : [];
  } catch { return []; }
}
async function saveAIHistory(msgs) {
  if (!state.uid) return;
  try {
    await updateDoc(doc(db, "users", state.uid), { aiMessages: msgs.slice(-60) });
  } catch {}
}

// =========================================================================
// 3. UTILITIES
// =========================================================================
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const _cloudPoster = (url) => {
  try { return url.replace(/\.mp4(\?.*)?$/, ".jpg").replace(/\.webm(\?.*)?$/, ".jpg").replace(/\.mov(\?.*)?$/, ".jpg"); }
  catch { return ""; }
};
// Renders the text/sticker overlay layer created in the create-post studio
// on top of a video (images have overlays already baked in at post time).
function _renderFeedOverlays(wrap, overlays) {
  if (!overlays || !overlays.length) return;
  const layer = el("div", { class: "cr-overlay-layer", style: "pointer-events:none;" });
  const paint = () => {
    layer.innerHTML = "";
    const w = wrap.clientWidth || 320;
    overlays.forEach((ov) => {
      const fontPx = w * ((ov.sizePct * ov.scale) / 100);
      const style = `left:${ov.x}%;top:${ov.y}%;transform:translate(-50%,-50%) rotate(${ov.rotation}deg);font-size:${fontPx}px;` +
        (ov.type === "text" ? `color:${ov.color};` : "");
      layer.appendChild(el("div", { class: `cr-layer ${ov.type}`, style }, ov.type === "text" ? ov.text : ov.icon));
    });
  };
  paint();
  window.addEventListener("resize", paint);
  // Feed posts are torn down via innerHTML replacement, not removal events,
  // so detect detachment lazily and drop the global listener once the layer
  // is no longer in the document (checked opportunistically on next resize).
  const _cleanupOnDetach = () => {
    if (!document.body.contains(layer)) window.removeEventListener("resize", _cleanupOnDetach);
    else paint();
  };
  window.removeEventListener("resize", paint);
  window.addEventListener("resize", _cleanupOnDetach);
  wrap.appendChild(layer);
}

// Browsers block unmuted autoplay until the user has interacted with the
// page at least once. We unlock on the very first tap/click/key anywhere
// (standard pattern) and unmute any songs already playing at that point;
// until then, songs still autoplay — just muted — so they don't silently
// fail to start.
let _audioUnlocked = false;
const _songAudioWrap = new WeakMap(); // audio -> its post's wrapper element, for liveness pruning
["pointerdown", "keydown"].forEach((evt) => {
  document.addEventListener(evt, () => {
    if (_audioUnlocked) return;
    _audioUnlocked = true;
    _activeSongAudios.forEach((a) => { if (!a.paused) a.muted = false; });
  }, { once: true, capture: true });
});

// Attaches an attached song to a post so it just plays quietly in the
// background, TikTok-style — mixed underneath the video's own audio, no
// overlay bar, no mute toggle. Image/carousel posts (no native audio) play
// the song at normal volume while visible.
function _wireSongPlayback(wrap, song, videoEl) {
  if (!song?.url) return;
  const audio = new Audio(song.url);
  audio.loop = true; audio.preload = "none";
  audio.volume = videoEl ? 0.22 : 0.9; // ducked under the clip's own audio when there is one
  _activeSongAudios.add(audio);
  _songAudioWrap.set(audio, wrap);
  const play = () => { audio.muted = !_audioUnlocked; audio.play().catch(() => {}); };
  if (videoEl) {
    // Video keeps its own audio; the song just plays underneath it.
    videoEl.addEventListener("play", () => { audio.currentTime = videoEl.currentTime % (audio.duration || 1e9); play(); });
    videoEl.addEventListener("pause", () => audio.pause());
    videoEl.addEventListener("seeked", () => { audio.currentTime = videoEl.currentTime % (audio.duration || 1e9); });
    videoEl.addEventListener("emptied", () => { audio.pause(); _activeSongAudios.delete(audio); }, { once: true });
  } else {
    const io = new IntersectionObserver((entries) => {
      if (!document.body.contains(wrap)) { audio.pause(); _activeSongAudios.delete(audio); io.disconnect(); return; }
      if (entries[0].isIntersecting) play(); else audio.pause();
    }, { threshold: 0.6 });
    io.observe(wrap);
  }
}

const buildVideoPlayer = (url, opts = {}) => {
  const { song, overlays } = opts;
  const poster = _cloudPoster(url);
  // muted enables browser auto-play-on-scroll; user can unmute via the button
  const video = el("video", { src: url, poster, preload: "metadata", playsinline: "", muted: "", style: "width:100%;display:block;" });
  const playIcon  = el("i", { class: "ri-play-fill" });
  const overlay   = el("div", { class: "vp-overlay" }, el("button", { class: "vp-big-play" }, playIcon));
  const playSmI   = el("i", { class: "ri-play-fill" });
  const playSmBtn = el("button", { class: "vp-btn" }, playSmI);
  const played    = el("div", { class: "vp-played" });
  const seek      = el("div", { class: "vp-seek" }, played);
  const timeEl    = el("span", { class: "vp-time", text: "0:00" });
  // starts muted to match the muted attribute above
  const muteI     = el("i", { class: "ri-volume-mute-line" });
  const muteBtn   = el("button", { class: "vp-btn" }, muteI);
  const fullBtn   = el("button", { class: "vp-btn" }, el("i", { class: "ri-fullscreen-line" }));
  const bar       = el("div", { class: "vp-bar" }, playSmBtn, seek, timeEl, muteBtn, fullBtn);
  // inline style overrides chat.css max-width:320px for post-context players
  const wrap      = el("div", { class: "vid-player", style: "width:100%;max-width:none;" }, video, overlay, bar);

  // ── Controls auto-hide ────────────────────────────────────────────────────
  // Shows bar on any interaction; hides 4 s later while playing.
  // On mobile (no mouseleave), a second touchstart resets the 4 s clock.
  let _hideTimer = null;
  const _scheduleHide = (delay = 4000) => {
    clearTimeout(_hideTimer);
    _hideTimer = setTimeout(() => {
      if (!video.paused) bar.classList.add("vp-bar-hidden");
    }, delay);
  };
  const _showBar = () => {
    bar.classList.remove("vp-bar-hidden");
    if (!video.paused) _scheduleHide();
  };
  // Desktop: show on hover, hide immediately on leave (then timer handles playing)
  wrap.addEventListener("mousemove",  _showBar);
  wrap.addEventListener("mouseleave", () => {
    clearTimeout(_hideTimer);
    if (!video.paused) bar.classList.add("vp-bar-hidden");
  });
  // Mobile: tap wrap to toggle bar visibility; bar auto-hides after 4 s
  wrap.addEventListener("touchstart", (e) => {
    if (e.target.closest(".vp-btn,.vp-seek,.vp-overlay")) return;
    if (bar.classList.contains("vp-bar-hidden")) {
      _showBar();
    } else {
      bar.classList.add("vp-bar-hidden");
    }
  }, { passive: true });

  // _userPaused: set when the user explicitly taps pause, cleared on explicit play.
  // The IntersectionObserver respects this flag and will never auto-resume a
  // video that the user intentionally stopped.
  let _userPaused = false;
  const togglePlay = () => {
    if (video.paused || video.ended) {
      _userPaused = false;
      video.play().catch(() => {});
    } else {
      _userPaused = true;
      video.pause();
    }
  };
  overlay.onclick = togglePlay;
  playSmBtn.onclick = (e) => { e.stopPropagation(); togglePlay(); };
  video.addEventListener("play",  () => {
    playIcon.className = playSmI.className = "ri-pause-fill";
    overlay.classList.add("playing");
    _scheduleHide(4000); // start 4 s hide timer when playback begins
  });
  video.addEventListener("pause", () => {
    playIcon.className = playSmI.className = "ri-play-fill";
    overlay.classList.remove("playing");
    bar.classList.remove("vp-bar-hidden");
    clearTimeout(_hideTimer);
  });
  video.addEventListener("ended", () => {
    playIcon.className = playSmI.className = "ri-play-fill";
    overlay.classList.remove("playing");
    played.style.width = "0%";
    bar.classList.remove("vp-bar-hidden");
    clearTimeout(_hideTimer);
  });
  video.addEventListener("timeupdate", () => {
    const pct = video.duration ? (video.currentTime / video.duration) * 100 : 0;
    played.style.width = pct + "%";
    const s = Math.floor(video.currentTime);
    timeEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  });
  seek.onclick    = (e) => { if (!video.duration) return; const r = seek.getBoundingClientRect(); video.currentTime = ((e.clientX - r.left) / r.width) * video.duration; _showBar(); };
  muteBtn.onclick = (e) => { e.stopPropagation(); video.muted = !video.muted; muteI.className = video.muted ? "ri-volume-mute-line" : "ri-volume-up-line"; _showBar(); };
  fullBtn.onclick = (e) => { e.stopPropagation(); (video.requestFullscreen || video.webkitRequestFullscreen || (() => {})).call(video); };

  // ── Play on scroll into view / pause on scroll out ────────────────────────
  // _wasPlaying remembers whether the video was actively playing the last time
  // it left the viewport.  The IO callback only resumes playback when that flag
  // is true — this prevents orbit/like button clicks from restarting a video
  // the user has paused or that had already finished playing (video.play() on
  // an ended video restarts from 0, which is the root cause of the "replay on
  // action" bug).  _userPaused is also checked so a deliberate manual pause is
  // never overridden by a scroll-triggered IO fire.
  let _wasPlaying = false;
  const _io = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) {
      if (_wasPlaying && !_userPaused) {
        video.play().catch(() => {});
      } else if (video.currentTime === 0 && !_userPaused) {
        // Auto-start only on first encounter (video hasn't been touched yet)
        video.play().catch(() => {});
      }
    } else {
      // Record whether it was playing so we can decide on re-entry
      _wasPlaying = !video.paused && !video.ended;
      video.pause();
    }
  }, { threshold: 0.5 });
  _io.observe(wrap);
  // Clean up observer if the player is ever removed from DOM
  video.addEventListener("emptied", () => _io.disconnect(), { once: true });

  if (overlays) _renderFeedOverlays(wrap, overlays);
  if (song) _wireSongPlayback(wrap, song, video);

  return wrap;
};

// =========================================================================
// VIDEO VIEWER — full-screen modal with prev/next navigation
// Opens when a video in a multi-media post is tapped.
// =========================================================================
let _vvStyleReady = false;
const _injectVVStyles = () => {
  if (_vvStyleReady) return;
  _vvStyleReady = true;
  const s = document.createElement("style");
  s.textContent = `
    .vv-backdrop {
      position: fixed; inset: 0; z-index: 2000;
      background: rgba(0,0,0,0.93);
      display: flex; align-items: center; justify-content: center;
      animation: vvFadeIn .18s ease;
    }
    @keyframes vvFadeIn { from { opacity:0; } to { opacity:1; } }
    .vv-modal {
      position: relative;
      display: flex; flex-direction: column; align-items: center;
      width: 100%; max-width: 900px; max-height: 100dvh;
      padding: 0 48px;
      box-sizing: border-box;
    }
    .vv-header {
      width: 100%; display: flex; align-items: center;
      justify-content: space-between;
      padding: 12px 0 10px;
    }
    .vv-counter {
      font-size: 14px; font-weight: 600;
      color: rgba(255,255,255,0.7);
      letter-spacing: .5px;
    }
    .vv-close {
      background: rgba(255,255,255,0.12);
      border: none; border-radius: 50%;
      width: 36px; height: 36px;
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; color: #fff; font-size: 20px;
      transition: background .15s;
    }
    .vv-close:hover { background: rgba(255,255,255,0.22); }
    .vv-media {
      width: 100%; display: flex; align-items: center; justify-content: center;
      flex: 1; overflow: hidden;
    }
    .vv-media .vid-player {
      width: 100%; max-height: 78dvh; border-radius: 10px; overflow: hidden;
    }
    .vv-media .vid-player video {
      width: 100%; max-height: 78dvh; object-fit: contain; background: #000;
    }
    .vv-media img {
      max-width: 100%; max-height: 78dvh;
      object-fit: contain; border-radius: 10px;
    }
    .vv-nav {
      position: absolute; top: 50%; transform: translateY(-50%);
      background: rgba(255,255,255,0.13);
      border: none; border-radius: 50%;
      width: 42px; height: 42px;
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; color: #fff; font-size: 24px;
      transition: background .15s, opacity .15s;
      z-index: 10;
    }
    .vv-nav:hover  { background: rgba(255,255,255,0.26); }
    .vv-nav:disabled { opacity: .25; cursor: default; pointer-events: none; }
    .vv-prev { left: 6px; }
    .vv-next { right: 6px; }
    .vv-dots {
      display: flex; gap: 6px; padding: 10px 0 14px;
    }
    .vv-dot {
      width: 7px; height: 7px; border-radius: 50%;
      border: none; background: rgba(255,255,255,0.3);
      cursor: pointer; padding: 0; transition: background .15s, transform .15s;
    }
    .vv-dot.active {
      background: #fff; transform: scale(1.25);
    }
    @media (max-width: 600px) {
      .vv-modal { padding: 0 40px; }
      .vv-nav   { width: 34px; height: 34px; font-size: 20px; }
      .vv-prev  { left: 2px; }
      .vv-next  { right: 2px; }
    }
  `;
  document.head.appendChild(s);
};

const openVideoViewer = (mediaItems, startIndex = 0) => {
  _injectVVStyles();
  let cur = startIndex;

  const backdrop  = el("div", { class: "vv-backdrop" });
  const modal     = el("div", { class: "vv-modal" });
  const mediaWrap = el("div", { class: "vv-media" });
  const counterEl = el("div", { class: "vv-counter" });
  const closeBtn  = el("button", { class: "vv-close" }, el("i", { class: "ri-close-line" }));
  const header    = el("div", { class: "vv-header" }, counterEl, closeBtn);
  const prevBtn   = el("button", { class: "vv-nav vv-prev" }, el("i", { class: "ri-arrow-left-s-line" }));
  const nextBtn   = el("button", { class: "vv-nav vv-next" }, el("i", { class: "ri-arrow-right-s-line" }));
  const dotsWrap  = el("div", { class: "vv-dots" });

  const dots = mediaItems.map((_, i) => {
    const d = el("button", { class: `vv-dot${i === startIndex ? " active" : ""}` });
    d.onclick = () => go(i);
    dotsWrap.appendChild(d);
    return d;
  });

  const show = (idx) => {
    // pause any current video
    mediaWrap.querySelectorAll("video").forEach((v) => { try { v.pause(); } catch {} });
    mediaWrap.innerHTML = "";

    const m = mediaItems[idx];
    if (m.type === "video") {
      const player = buildVideoPlayer(m.url);
      mediaWrap.appendChild(player);
      // autoplay after a tick so the DOM is ready
      requestAnimationFrame(() => player.querySelector("video")?.play().catch(() => {}));
    } else {
      mediaWrap.appendChild(el("img", { src: m.url }));
    }

    counterEl.textContent = mediaItems.length > 1 ? `${idx + 1} / ${mediaItems.length}` : "";
    prevBtn.disabled = idx === 0;
    nextBtn.disabled = idx === mediaItems.length - 1;
    dots.forEach((d, i) => d.classList.toggle("active", i === idx));
  };

  const go = (idx) => { cur = idx; show(cur); };

  prevBtn.onclick = (e) => { e.stopPropagation(); if (cur > 0) go(cur - 1); };
  nextBtn.onclick = (e) => { e.stopPropagation(); if (cur < mediaItems.length - 1) go(cur + 1); };
  closeBtn.onclick = () => close();

  const close = () => {
    mediaWrap.querySelectorAll("video").forEach((v) => { try { v.pause(); } catch {} });
    backdrop.remove();
    document.removeEventListener("keydown", onKey);
  };

  const onKey = (e) => {
    if (e.key === "Escape")      close();
    if (e.key === "ArrowLeft"  && cur > 0)                      go(cur - 1);
    if (e.key === "ArrowRight" && cur < mediaItems.length - 1)  go(cur + 1);
  };
  document.addEventListener("keydown", onKey);

  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });

  modal.appendChild(header);
  modal.appendChild(mediaWrap);
  if (mediaItems.length > 1) {
    modal.appendChild(prevBtn);
    modal.appendChild(nextBtn);
    modal.appendChild(dotsWrap);
  }
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
  show(cur);
};
// =========================================================================
// IMAGE ZOOM VIEWER — fullscreen modal with pinch / scroll zoom
// =========================================================================
const openImageZoom = (src) => {
  let scale = 1, originX = 0.5, originY = 0.5;
  let isDragging = false, dragStartX = 0, dragStartY = 0, translateX = 0, translateY = 0;

  const backdrop = document.createElement("div");
  Object.assign(backdrop.style, {
    position: "fixed", inset: "0", zIndex: "3000",
    background: "rgba(0,0,0,0.96)", display: "flex",
    alignItems: "center", justifyContent: "center",
    animation: "vvFadeIn .18s ease",
    cursor: "zoom-out", userSelect: "none",
    WebkitUserSelect: "none",
  });

  const img = document.createElement("img");
  Object.assign(img.style, {
    maxWidth: "100%", maxHeight: "100dvh",
    objectFit: "contain", display: "block",
    transition: "transform .12s ease",
    transformOrigin: "center center",
    cursor: "inherit", willChange: "transform",
    userSelect: "none", WebkitUserDrag: "none",
  });
  img.src = src;
  img.draggable = false;

  const closeBtn = document.createElement("button");
  closeBtn.innerHTML = '<i class="ri-close-line"></i>';
  Object.assign(closeBtn.style, {
    position: "fixed", top: "14px", right: "14px",
    background: "rgba(255,255,255,0.14)", border: "none",
    borderRadius: "50%", width: "38px", height: "38px",
    display: "flex", alignItems: "center", justifyContent: "center",
    color: "#fff", fontSize: "20px", cursor: "pointer", zIndex: "1",
  });

  const zoomHint = document.createElement("div");
  zoomHint.textContent = "Scroll or pinch to zoom";
  Object.assign(zoomHint.style, {
    position: "fixed", bottom: "20px", left: "50%",
    transform: "translateX(-50%)",
    background: "rgba(0,0,0,0.5)", color: "rgba(255,255,255,0.7)",
    padding: "6px 14px", borderRadius: "999px", fontSize: "12px",
    pointerEvents: "none", transition: "opacity .3s",
  });
  setTimeout(() => { zoomHint.style.opacity = "0"; }, 2000);

  const applyTransform = () => {
    img.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
    img.style.transition = isDragging ? "none" : "transform .12s ease";
  };

  const close = () => {
    backdrop.remove();
    document.removeEventListener("keydown", onKey);
  };

  // Scroll-to-zoom (desktop)
  backdrop.addEventListener("wheel", (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.85 : 1.18;
    scale = Math.min(Math.max(scale * delta, 1), 6);
    if (scale === 1) { translateX = 0; translateY = 0; }
    applyTransform();
  }, { passive: false });

  // Click backdrop to close only when not zoomed / not dragging
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop || e.target === img) {
      if (scale <= 1) close();
    }
  });

  // Drag-to-pan (when zoomed)
  img.addEventListener("mousedown", (e) => {
    if (scale <= 1) return;
    isDragging = true;
    dragStartX = e.clientX - translateX;
    dragStartY = e.clientY - translateY;
    img.style.cursor = "grabbing";
    e.preventDefault();
  });
  window.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    translateX = e.clientX - dragStartX;
    translateY = e.clientY - dragStartY;
    applyTransform();
  });
  window.addEventListener("mouseup", () => {
    isDragging = false;
    img.style.cursor = scale > 1 ? "grab" : "inherit";
  });

  // Pinch-to-zoom (mobile)
  let lastDist = 0;
  backdrop.addEventListener("touchstart", (e) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      lastDist = Math.hypot(dx, dy);
    }
  }, { passive: true });
  backdrop.addEventListener("touchmove", (e) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      if (lastDist) {
        scale = Math.min(Math.max(scale * (dist / lastDist), 1), 6);
        if (scale === 1) { translateX = 0; translateY = 0; }
        applyTransform();
      }
      lastDist = dist;
    }
  }, { passive: false });
  backdrop.addEventListener("touchend", () => { lastDist = 0; });

  // Double-tap to toggle 2× zoom
  let _lastTap = 0;
  img.addEventListener("click", () => {
    const now = Date.now();
    if (now - _lastTap < 300) {
      scale = scale > 1 ? 1 : 2.5;
      if (scale === 1) { translateX = 0; translateY = 0; }
      applyTransform();
    }
    _lastTap = now;
  });

  const onKey = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);

  closeBtn.onclick = close;
  backdrop.appendChild(img);
  backdrop.appendChild(closeBtn);
  backdrop.appendChild(zoomHint);
  document.body.appendChild(backdrop);
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
    // COMPATIBILITY ENGINE — Jaccard similarity matching + taste profile
    // =========================================================================
    const TASTE_QUESTIONS = [
    { id: "music",     q: "What's your music vibe?",
      opts: ["Hip-hop / R&B", "Pop", "Rock / Alt", "Electronic / EDM", "Afrobeats / Afropop", "Jazz / Soul", "Classical / Ambient", "Country / Folk"] },
    { id: "shows",     q: "Your go-to watch?",
      opts: ["Reality TV", "Sci-fi / Fantasy", "Drama / Thriller", "Comedy / Sitcoms", "Anime", "Docs & True Crime", "Action / Adventure", "Horror"] },
    { id: "energy",    q: "Your social energy?",
      opts: ["Total introvert", "Mostly introvert", "Balanced", "Mostly extrovert", "Total extrovert"] },
    { id: "humor",     q: "Your humor style?",
      opts: ["Dark & dry", "Sarcastic", "Wholesome & silly", "Puns & wordplay", "Deadpan", "Absurdist"] },
    { id: "dayoff",    q: "Ideal day off?",
      opts: ["Gaming / streaming", "Outdoors / active", "Creative projects", "Socializing", "Reading / learning", "Cooking / food", "Traveling", "Doing nothing"] },
    { id: "values",    q: "What matters most to you?",
      opts: ["Loyalty & trust", "Ambition & growth", "Freedom & independence", "Creativity & self-expression", "Family & community", "Adventure & experiences"] },
    { id: "comms",     q: "How do you communicate?",
      opts: ["Voice notes > texts", "Paragraph texter", "Short & direct", "Memes & reaction GIFs", "Voice / video calls", "Whatever fits the vibe"] },
    { id: "aesthetic", q: "Your aesthetic?",
      opts: ["Minimal & clean", "Dark & moody", "Colorful & chaotic", "Vintage & nostalgic", "Street / urban", "Soft & cozy", "Techy / futuristic"] },
    { id: "goals",     q: "What are you building?",
      opts: ["Career / skills", "A business", "Creative work", "Relationships", "Health & wellness", "Just vibing honestly"] },
    { id: "content",   q: "What do you post / consume?",
      opts: ["Tech & dev", "Art & design", "Fashion & style", "Sports & fitness", "Food & lifestyle", "Politics & news", "Entertainment", "Multiple / everything"] },
    ];

    // Jaccard similarity: intersection / union over two flat arrays
    function jaccardScore(arrA, arrB) {
    if (!arrA?.length || !arrB?.length) return 0;
    const a = new Set(arrA), b = new Set(arrB);
    let inter = 0;
    for (const x of a) if (b.has(x)) inter++;
    const union = a.size + b.size - inter;
    return union === 0 ? 0 : inter / union;
    }

    // Weighted compatibility score 0–100 between two user profile objects
    function computeCompatibility(me, them) {
    let num = 0, den = 0;

    // Taste answers — highest signal (explicit preferences)
    const myA   = Object.values(me?.tasteAnswers  || {}).flat().map(v => v.toLowerCase());
    const theirA = Object.values(them?.tasteAnswers || {}).flat().map(v => v.toLowerCase());
    if (myA.length || theirA.length) { num += 0.45 * jaccardScore(myA, theirA); den += 0.45; }

    // Interests / hashtags
    if ((me?.interests?.length || 0) + (them?.interests?.length || 0)) {
      num += 0.30 * jaccardScore(me.interests || [], them.interests || []); den += 0.30;
    }

    // Liked/reacted posts in common
    if ((me?.likedPosts?.length || 0) + (them?.likedPosts?.length || 0)) {
      num += 0.25 * jaccardScore(me.likedPosts || [], them.likedPosts || []); den += 0.25;
    }

    return den > 0 ? Math.round((num / den) * 100) : 0;
    }

    // Session-level compatibility cache
    const _compatCache = new Map();
    async function getCompatibility(theirUid) {
    if (!state.me || !theirUid || theirUid === state.uid) return 0;
    const key = state.uid + ":" + theirUid;
    if (_compatCache.has(key)) return _compatCache.get(key);
    const them = await fetchUser(theirUid).catch(() => null);
    if (!them) return 0;
    const score = computeCompatibility(state.me, them);
    _compatCache.set(key, score);
    return score;
    }

    // Shared taste items between two user profiles (for "why" signal)
    function sharedTasteItems(me, them) {
    const myA    = Object.values(me?.tasteAnswers  || {}).flat();
    const theirA = Object.values(them?.tasteAnswers || {}).flat();
    const set = new Set(theirA.map(v => v.toLowerCase()));
    return myA.filter(v => set.has(v.toLowerCase()));
    }

    // ── Taste Quiz ─────────────────────────────────────────────────────────────
    const openTasteQuiz = (onComplete) => {
    let current = 0;
    const answers = {};

    const overlay = el("div", { class: "tq-overlay" });
    const card    = el("div", { class: "tq-card" });
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const render = () => {
      card.innerHTML = "";
      const q    = TASTE_QUESTIONS[current];
      const prog = Math.round((current / TASTE_QUESTIONS.length) * 100);

      card.appendChild(el("div", { class: "tq-progress-bar" },
        el("div", { class: "tq-progress-fill", style: "width:" + prog + "%" })
      ));
      card.appendChild(el("div", { class: "tq-count" }, (current + 1) + " / " + TASTE_QUESTIONS.length));
      card.appendChild(el("h2",  { class: "tq-q" }, q.q));

      const opts = el("div", { class: "tq-opts" });
      q.opts.forEach((opt) => {
        const selected = answers[q.id] === opt;
        const btn = el("button", { class: "tq-opt" + (selected ? " selected" : "") }, opt);
        btn.addEventListener("click", () => {
          answers[q.id] = opt;
          if (current < TASTE_QUESTIONS.length - 1) { current++; render(); }
          else { _saveTasteProfile(answers, overlay, onComplete); }
        });
        opts.appendChild(btn);
      });
      card.appendChild(opts);

      if (current > 0) {
        card.appendChild(el("button", { class: "tq-back" }, "← Back",
          // onclick added as listener to avoid el() onclick conflict
        ));
        card.querySelector(".tq-back").addEventListener("click", () => { current--; render(); });
      }
      const skip = el("button", { class: "tq-skip" }, "Skip for now");
      skip.addEventListener("click", () => _saveTasteProfile(answers, overlay, onComplete));
      card.appendChild(skip);
    };

    render();
    };

    // ── Day-one "Your Vibe So Far" summary card ──────────────────────────
    const showVibeSummary = async () => {
      const snap = await getDocs(query(collection(db, "users"), limit(60))).catch(() => null);
      if (!snap) return;
      const others = snap.docs.map(d => ({ uid: d.id, ...d.data() })).filter(u => u.uid !== state.uid && u.name);
      const scored = others
        .map(u => ({ u, score: computeCompatibility(state.me, u) }))
        .filter(x => x.score >= 25)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);

      const overlay = el("div", { class: "vbs-overlay" });
      const card = el("div", { class: "vbs-card" },
        el("div", { class: "vbs-icon" }, "✦"),
        el("div", { class: "vbs-title" }, "Your Vibe Is Set"),
        el("div", { class: "vbs-sub" }, scored.length
          ? "Here's who already matches your taste:"
          : "Post something and we'll start finding your people."),
      );

      if (scored.length) {
        const people = el("div", { class: "vbs-people" });
        scored.forEach(({ u, score }) => {
          let _following = (state.me?.following || []).includes(u.uid);
          const followBtn = el("button", { class: `btn sm${_following ? "" : " primary"}` },
            _following ? "Following" : "Follow");
          followBtn.addEventListener("click", async (e) => {
            e.stopPropagation();
            _following = !_following;
            followBtn.textContent = _following ? "Following" : "Follow";
            followBtn.className = `btn sm${_following ? "" : " primary"}`;
            await updateDoc(doc(db, "users", state.uid), {
              following: _following ? arrayUnion(u.uid) : arrayRemove(u.uid),
            }).catch(() => {});
            await updateDoc(doc(db, "users", u.uid), {
              followers: _following ? arrayUnion(state.uid) : arrayRemove(state.uid),
            }).catch(() => {});
            if (state.me) state.me.following = _following
              ? [...(state.me.following || []), u.uid]
              : (state.me.following || []).filter(x => x !== u.uid);
          });
          people.appendChild(el("div", { class: "vbs-person", onclick: () => { overlay.remove(); location.hash = `#profile/${u.uid}`; }},
            el("img", { class: "vbs-avatar", src: avatarFor(u) }),
            el("div", { class: "vbs-person-info" },
              el("div", { class: "vbs-person-name" }, u.name || "User"),
              el("div", { class: "vbs-person-score" },
                el("i", { class: "ri-fire-fill", style: "color:var(--grad-1)" }),
                ` ${score}% match`),
            ),
            followBtn,
          ));
        });
        card.appendChild(people);
      }

      card.appendChild(el("button", {
        class: "btn primary vbs-done",
        onclick: () => { overlay.remove(); location.hash = "#discover"; }
      }, "Explore Vibe →"));
      overlay.appendChild(card);
      overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
      document.body.appendChild(overlay);
    };

    async function _saveTasteProfile(answers, overlay, onComplete) {
    overlay?.remove();
    if (!state.uid || !Object.keys(answers).length) {
      if (typeof onComplete === "function") onComplete(null);
      return;
    }
    try {
      const interests = [...new Set(
        Object.values(answers).flat().map(v => v.toLowerCase().replace(/[^a-z0-9]/g, "_"))
      )];
      await updateDoc(doc(db, "users", state.uid), {
        tasteAnswers: answers,
        interests,
        tasteProfiledAt: serverTimestamp(),
      });
      if (state.me) { state.me.tasteAnswers = answers; state.me.interests = interests; }
      state.cache.users.delete(state.uid);
      toast("✨ Taste profile saved! We'll use this to find your people.");
      if (typeof onComplete === "function") onComplete(answers);
      // Show day-one summary after a brief delay so toast is visible first
      setTimeout(() => showVibeSummary().catch(() => {}), 800);
    } catch (err) {
      console.warn("saveTasteProfile:", err);
      toast("Couldn't save taste profile — try again");
      if (typeof onComplete === "function") onComplete(null);
    }
    }

    // Show taste profile summary sheet
    const openTasteProfileSheet = () => {
    const answers = state.me?.tasteAnswers || {};
    const chips   = Object.values(answers).flat();
    if (!chips.length) { openTasteQuiz(() => {}); return; }

    const modal = el("div", { class: "taste-profile-modal" });
    const sheet = el("div", { class: "taste-profile-sheet" });
    const closeBtn = el("button", { class: "icon-btn" }, el("i", { class: "ri-close-line" }));
    closeBtn.addEventListener("click", () => modal.remove());
    sheet.appendChild(el("div", { class: "tps-header" },
      el("h3", {}, "✦ Your Taste Map"),
      closeBtn,
    ));
    const chipsEl = el("div", { class: "tps-chips" });
    chips.slice(0, 20).forEach(c => chipsEl.appendChild(el("span", { class: "tps-chip" }, c)));
    sheet.appendChild(chipsEl);
    const retake = el("button", { class: "btn primary tps-retake" }, "Retake quiz");
    retake.addEventListener("click", () => { modal.remove(); openTasteQuiz(() => {}); });
    sheet.appendChild(retake);
    modal.appendChild(sheet);
    modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
    document.body.appendChild(modal);
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
  localStorage.setItem("vibe:theme", theme);
  $("#themeToggle")?.querySelector("i")?.classList.toggle("ri-sun-line", theme === "dark");
  $("#themeToggle")?.querySelector("i")?.classList.toggle("ri-moon-line", theme === "light");
};
const initTheme = () => applyTheme(localStorage.getItem("vibe:theme") || "dark");
const toggleTheme = () =>
  applyTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");

// =========================================================================
// 6. AUTH FLOW
// =========================================================================
const showOnboarding = () => {
  $("#onboarding").classList.remove("hidden");
  $("#auth").classList.add("hidden");
  $("#app").classList.add("hidden");
  $("#boot").classList.add("hidden");

  const slides = $$(".ob-slide", document.getElementById("onboarding"));
  const dots   = $$(".ob-dot",   document.getElementById("onboarding"));
  let current  = 0;

  const goTo = (i) => {
    slides[current].classList.remove("active");
    dots[current].classList.remove("active");
    current = i;
    slides[current].classList.add("active");
    dots[current].classList.add("active");
    const nextBtn = $("#obNext");
    if (nextBtn) nextBtn.innerHTML = current === slides.length - 1
      ? 'Get Started <i class="ri-rocket-line"></i>'
      : 'Next <i class="ri-arrow-right-line"></i>';
  };

  $("#obNext")?.addEventListener("click", () => {
    if (current < slides.length - 1) { goTo(current + 1); }
    else { finishOnboarding(); }
  });
  $("#obSkip")?.addEventListener("click", finishOnboarding);

  // Touch/swipe support
  let touchStartX = 0;
  const obEl = document.getElementById("onboarding");
  obEl.addEventListener("touchstart", (e) => { touchStartX = e.touches[0].clientX; }, { passive: true });
  obEl.addEventListener("touchend", (e) => {
    const dx = touchStartX - e.changedTouches[0].clientX;
    if (Math.abs(dx) > 40) {
      if (dx > 0 && current < slides.length - 1) goTo(current + 1);
      else if (dx < 0 && current > 0) goTo(current - 1);
    }
  }, { passive: true });
};

const finishOnboarding = () => {
  localStorage.setItem("vibe_onboarded", "1");
  $("#onboarding").classList.add("hidden");
  showAuth();
};

const showAuth = () => { $("#auth").classList.remove("hidden"); $("#app").classList.add("hidden"); $("#boot").classList.add("hidden"); $("#onboarding").classList.add("hidden"); };
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
    // Welcome notification for new users
    await addDoc(collection(db, "notifications", user.uid, "items"), {
      type: "welcome",
      text: `Welcome to Vibe, ${profile.name.split(" ")[0]}! 👋 Explore groups, join spaces, and connect with people who actually get you.`,
      read: false,
      createdAt: serverTimestamp(),
    }).catch(() => {});
    return { ...profile, _isNew: true };
  }
  // mark online + lastSeen
  await updateDoc(ref, { online: true, lastSeen: serverTimestamp() });
  // ── Streak tracking ─────────────────────────────────────────────────────
  const _today = new Date().toISOString().slice(0, 10);
  const _sd = snap.data();
  const _lastStreakDate = _sd.lastStreakDate || null;
  const _streakCount = _sd.streakCount || 0;
  let _newStreak = _streakCount;
  if (_lastStreakDate !== _today) {
    const _yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    _newStreak = _lastStreakDate === _yesterday ? _streakCount + 1 : 1;
    await updateDoc(ref, { streakCount: _newStreak, lastStreakDate: _today });
  }
  return { uid: user.uid, ...snap.data(), online: true, streakCount: _newStreak };
};

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    state.me = null; state.uid = null;
    if (!localStorage.getItem("vibe_onboarded")) { showOnboarding(); } else { showAuth(); }
    return;
  }
  state.uid = user.uid;
  state.me = await ensureUserDoc(user);
  $("#meAvatar").src = avatarFor(state.me);
  _hideAuthLoader(); // dismiss branded loader if sign-in/up triggered it
  showApp();
  startMyProfileListener();
  startNotifListener();
  startSuggestions();
  router(); // initial route
  watchOfflineOnUnload();
  startNewsBot(); // kick off official news/sport/social bot (throttled to every 5 h)
  // Show onboarding modal for brand-new users; otherwise prompt incomplete profiles
  if (state.me._isNew) {
    showOnboardingModal();
    // After onboarding, launch taste quiz so new user has a profile immediately
    setTimeout(() => {
      if (!state.me?.tasteAnswers) {
        openTasteQuiz(async (answers) => {
          if (answers) await _showFirstMatchPreview();
        });
      }
    }, 1800);
  } else {
    checkProfileSetup();
    // Existing user with no taste profile — prompt once per session
    if (!state.me?.tasteAnswers && !sessionStorage.getItem("vibe:tq_prompted")) {
      sessionStorage.setItem("vibe:tq_prompted", "1");
      setTimeout(() => openTasteQuiz(() => {}), 3000);
    }
  }
  // Notify chat module
  document.dispatchEvent(new CustomEvent("vibe:auth-ready", { detail: state.me }));
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
    if (which === "signup") {
      // Show feature-overview onboarding before the actual sign-up form
      $("#signinForm").classList.add("hidden");
      $("#signupForm").classList.add("hidden");
      $("#signupOnboard").classList.remove("hidden");
      return;
    }
    // Sign-in tab: hide everything else, show sign-in
    $("#signupOnboard").classList.add("hidden");
    $("#signupForm").classList.add("hidden");
    $("#signinForm").classList.remove("hidden");
  });
});

// "Create my account" inside the pre-signup onboard → reveal the real sign-up form
document.getElementById("onboardGetStarted")?.addEventListener("click", () => {
  $("#signupOnboard").classList.add("hidden");
  $("#signupForm").classList.remove("hidden");
});

// ── Orbit-branded auth loader ────────────────────────────────────────────
// Creates (or reuses) a full-screen overlay with the animated logo mark so
// users see branded feedback instead of a frozen form during sign-in/up.
function _showAuthLoader(label = "Signing in…") {
  let overlay = document.getElementById("vibeAuthLoader");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "vibeAuthLoader";
    overlay.innerHTML = `
      <div class="oal-inner">
        <div class="oal-logo-wrap">
          <div class="oal-pulse-ring oal-ring-1"></div>
          <div class="oal-pulse-ring oal-ring-2"></div>
          <div class="oal-logo-icon">✦</div>
        </div>
        <div class="oal-brand">Vibe</div>
        <div class="oal-label" id="oalLabel"></div>
      </div>`;
    document.body.appendChild(overlay);
  }
  overlay.querySelector("#oalLabel").textContent = label;
  overlay.classList.remove("oal-hidden");
}
function _hideAuthLoader() {
  const overlay = document.getElementById("vibeAuthLoader");
  if (overlay) {
    overlay.classList.add("oal-hidden");
    // Remove from DOM after fade-out so it doesn't block future interactions
    setTimeout(() => overlay.remove(), 350);
  }
}

$("#signinForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  _showAuthLoader("Signing in…");
  try {
    await signInWithEmailAndPassword(auth, fd.get("email"), fd.get("password"));
    // Loader stays visible — Firebase auth state change will trigger the app
  } catch (err) {
    _hideAuthLoader();
    toast(err.message.replace("Firebase: ", ""));
  }
});

$("#signupForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const name = fd.get("name"), username = fd.get("username");
  _showAuthLoader("Creating your Vibe…");
  try {
    const cred = await createUserWithEmailAndPassword(auth, fd.get("email"), fd.get("password"));
    await updateProfile(cred.user, { displayName: name });
    await ensureUserDoc(cred.user, { name, username });
    // Loader stays visible — auth state listener will navigate to the app
  } catch (err) {
    _hideAuthLoader();
    toast(err.message.replace("Firebase: ", ""));
  }
});

$("#googleBtn").addEventListener("click", async () => {
  _showAuthLoader("Connecting with Google…");
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
    // Loader stays — auth state listener handles navigation
  } catch (err) {
    _hideAuthLoader();
    toast(err.message.replace("Firebase: ", ""));
  }
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
    const iconMap = { orbit:"ri-fire-fill", follow:"ri-user-follow-fill", message:"ri-chat-1-fill", comment:"ri-chat-4-fill", commentLike:"ri-heart-fill", groupMessage:"ri-group-2-fill", call:"ri-phone-fill", newPost:"ri-file-add-fill", postConfirm:"ri-checkbox-circle-fill" };
    const colMap  = { orbit:"var(--grad-2)", follow:"var(--primary)", message:"var(--good)", comment:"var(--grad-3)", commentLike:"var(--danger)", groupMessage:"var(--good)", call:"var(--primary)", newPost:"var(--grad-1)", postConfirm:"var(--good)" };
    snap.docs.forEach((d) => {
      const n = { id: d.id, ...d.data() };
      const ic = iconMap[n.type] || "ri-notification-3-fill";
      const co = colMap[n.type]  || "var(--primary)";
      const txt = n.text || (n.fromName || "Someone") + " " + ({ orbit:"orbited your post", follow:"followed you", message:"sent you a message", comment:"commented on your post", commentLike:"liked your comment", groupMessage:"sent a message in your group", call:"called you", newPost:"shared a new post", postConfirm:"Your post is live!" }[n.type] || "interacted");
      const item = el("div", { class: "notif-item" + (n.read ? "" : " unread") },
        el("i", { class: ic, style: "color:" + co + ";font-size:20px;flex-shrink:0;margin-top:2px;" }),
        el("div", { style: "min-width:0;" }, el("div", { class: "ni-text" }, txt), el("div", { class: "ni-time" }, fmtTime(n.createdAt))),
      );
      item.addEventListener("click", () => {
        updateDoc(doc(db, "notifications", state.uid, "items", n.id), { read: true }).catch(() => {});
        panel.remove();
        if (n.type === "message" && n.fromUid) location.hash = "#chats/" + n.fromUid;
        else if (n.type === "groupMessage" && n.groupId) location.hash = "#chats/" + n.groupId;
        else if (n.type === "follow"  && n.fromUid) location.hash = "#profile/" + n.fromUid;
        else if ((n.type === "comment" || n.type === "commentLike" || n.type === "newPost" || n.type === "postConfirm") && n.postId) location.hash = "#post/" + n.postId;
        else if (n.type === "call") location.hash = "#chats";
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
$("#notifBtn").addEventListener("click", () => { location.hash = "#notifications"; });

// =========================================================================
// 7. ROUTER
// =========================================================================
// "reels" removed — videos live in the feed as regular posts
const routes = ["feed", "chats", "ai-chat", "groups", "explore", "saved", "settings", "profile", "post", "profile-u", "spaces", "challenges", "mentorship", "notifications", "learn"];

// Feed DOM caching — lets us restore the feed instantly when navigating
// back from a post without re-rendering or re-shuffling.
let _feedScrollY = 0;
let _feedCachedNode = null; // detached feed DOM preserved during post visit
let _feedUnsub = null;      // kept alive so the cached node stays fresh

// Attached-song <audio> elements are created detached from the DOM (so
// querySelectorAll("audio") can't find them) — track them here so they can
// still be paused on navigation.
const _activeSongAudios = new Set();

// Stops every playing <video>/<audio> in the app — called on every route
// change so a clip or attached song doesn't keep playing in the background
// after the user navigates away from the post that started it.
function _pauseAllMedia(exceptEl = null) {
  document.querySelectorAll("video, audio").forEach((m) => {
    if (m === exceptEl) return;
    try { m.pause(); } catch {}
  });
  _activeSongAudios.forEach((a) => {
    if (a !== exceptEl) { try { a.pause(); } catch {} }
    // Prune entries whose post node has been removed from the DOM (e.g. the
    // feed re-rendered) so the set doesn't grow unbounded across a session.
    const wrap = _songAudioWrap.get(a);
    if (wrap && !document.body.contains(wrap)) _activeSongAudios.delete(a);
  });
}

const router = () => {
  _pauseAllMedia();
  const hash = (location.hash || "#feed").replace(/^#/, "");
  const [route, ...rest] = hash.split("/");
  const target = routes.includes(route) ? route : "feed";
  const prevRoute = content._currentRoute;

  $$(".nav-item, .bn").forEach((b) => b.classList.toggle("active", b.dataset.route === target));

  // ── Leaving the feed ──────────────────────────────────────────────────
  if (prevRoute === "feed") {
    // Save scroll position
    _feedScrollY = content.scrollTop || 0;
    // Detach the feed node before clearing innerHTML so we don't destroy it
    const feedNode = content.firstElementChild;
    if (feedNode) {
      content.removeChild(feedNode);
      _feedCachedNode = feedNode;
    }
    // Only keep unsub alive when going to a post (might come back)
    // Kill it when navigating elsewhere (fresh feed on return)
    if (target !== "post") {
      if (_feedUnsub) { _feedUnsub(); _feedUnsub = null; }
      _feedCachedNode = null;
    }
  }

  // Cancel previous non-feed route unsub
  if (prevRoute !== "feed" && content._unsub) {
    content._unsub();
    content._unsub = null;
  }

  content.innerHTML = "";
  content._currentRoute = target;

  // ── Entering the feed ─────────────────────────────────────────────────
  if (target === "feed") {
    if (prevRoute === "post" && _feedCachedNode) {
      // Restore cached feed without re-rendering (preserves shuffle order)
      content.appendChild(_feedCachedNode);
      content._unsub = _feedUnsub;
      const sy = _feedScrollY;
      requestAnimationFrame(() => { content.scrollTop = sy; });
      _feedCachedNode = null;
    } else {
      // Fresh navigation — discard old cache, re-render with new shuffle
      if (_feedUnsub) { _feedUnsub(); _feedUnsub = null; }
      _feedCachedNode = null;
      renderFeed(content);
    }
    return;
  }

  switch (target) {
    case "chats":
      if (rest[0] === "ai") {
        renderAIChat(content);
      } else {
        document.dispatchEvent(new CustomEvent("vibe:open-chats", { detail: { peerUid: rest[0] || null } }));
        // Inject AI entry at top of chat list after chat.js renders
        setTimeout(() => _injectAIChatEntry(), 350);
      }
      break;
    case "ai-chat":    renderAIChat(content); break;
    case "groups":     renderGroups(content); break;
    case "explore":    renderExplore(content, rest[0] === "tag" ? rest[1] : null); break;
    case "saved":      renderSaved(content); break;
    case "settings":   renderSettings(content); break;
    case "profile":    renderProfile(content, rest[0] || state.uid); break;
    case "profile-u":  renderProfileByUsername(content, rest[0]); break;
    case "post":       renderPostDetail(content, rest[0]); break;
    case "spaces":         import("./features.js").then(m => rest[0] ? m.renderSpacePage(content, rest[0]) : m.renderSpaces(content)); break;
    case "challenges":     import("./features.js").then(m => m.renderChallenges(content)); break;
    case "mentorship":     import("./features.js").then(m => m.renderMentorship(content)); break;
    case "notifications":  import("./additional.js").then(m => m.renderNotifications(content)); break;
    case "learn":
      import("./features.js").then(m => {
        if (rest[0] && rest[1]) m.renderChapterPage(content, rest[0], rest[1]);
        else if (rest[0])       m.renderTrackPage(content, rest[0]);
        else                    m.renderLearn(content);
      }); break;
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



    // ── Compat card helper (used in Explore) ──────────────────────────────────
    const _appendCompatCard = (scroller, u, score) => {
    let iFollow = (state.me?.following || []).includes(u.uid);
    const circumference = 2 * Math.PI * 15.9;
    const dash = score > 0 ? (score / 100) * circumference : 0;
    const gap  = circumference - dash;

    const card = el("div", { class: "compat-card", onclick: () => location.hash = "#profile/" + u.uid });
    const ring = el("div", { class: "compat-score-ring" });
    ring.innerHTML = '<svg viewBox="0 0 36 36">' +
      '<circle class="ring-bg"   cx="18" cy="18" r="15.9"/>' +
      '<circle class="ring-fill" cx="18" cy="18" r="15.9" style="stroke-dasharray:' + dash.toFixed(1) + ' ' + gap.toFixed(1) + ';stroke-dashoffset:25;"/>' +
      '</svg>';
    ring.appendChild(el("img", { src: u.photoURL || ("https://api.dicebear.com/7.x/shapes/svg?seed=" + u.uid), alt: u.name || "User" }));
    if (score > 0) ring.appendChild(el("span", { class: "compat-score-label" }, score + "%"));
    card.appendChild(ring);
    card.appendChild(el("div", { class: "compat-name" }, u.name || "User"));

    const sharedItems = sharedTasteItems(state.me, u);
    if (sharedItems.length) {
      card.appendChild(el("div", { class: "compat-shared" }, "Both into: " + sharedItems.slice(0, 2).join(", ")));
    } else if (score > 0) {
      card.appendChild(el("div", { class: "compat-shared" }, score + "% taste overlap"));
    } else {
      card.appendChild(el("div", { class: "compat-shared" }, "Discover their vibe"));
    }

    const followBtn = el("button", { class: "btn sm " + (iFollow ? "ghost" : "primary") + " compat-follow-btn" },
      iFollow ? "Following" : "Follow");
    followBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const meRef = doc(db, "users", state.uid);
      const themRef = doc(db, "users", u.uid);
      const batch = writeBatch(db);
      if (iFollow) { batch.update(meRef, { following: arrayRemove(u.uid) }); batch.update(themRef, { followers: arrayRemove(state.uid) }); }
      else          { batch.update(meRef, { following: arrayUnion(u.uid) }); batch.update(themRef, { followers: arrayUnion(state.uid) }); }
      await batch.commit().catch(() => {});
      state.cache.users.delete(u.uid); state.cache.users.delete(state.uid);
      iFollow = !iFollow;
      followBtn.className = "btn sm " + (iFollow ? "ghost" : "primary") + " compat-follow-btn";
      followBtn.textContent = iFollow ? "Following" : "Follow";
    });
    card.appendChild(followBtn);
    scroller.appendChild(card);
    };

    // ── First match preview — shown after new users complete taste quiz ─────────
    const _showFirstMatchPreview = async () => {
    if (!state.uid || !state.me?.tasteAnswers) return;
    try {
      const snap = await getDocs(query(collection(db, "users"), limit(60)));
      const candidates = snap.docs
        .map(d => ({ uid: d.id, ...d.data() }))
        .filter(u => u.uid !== state.uid);
      if (!candidates.length) return;

      const scored = candidates.map(u => ({ u, score: computeCompatibility(state.me, u) }));
      scored.sort((a, b) => b.score - a.score);
      const best = scored[0];
      if (!best || best.score === 0) return;

      const { u, score } = best;
      const sharedItems = sharedTasteItems(state.me, u);
      const why = sharedItems.length
        ? "You both vibe with: " + sharedItems.slice(0, 2).join(", ")
        : score + "% taste compatibility";

      // Insert as first card in feed if feed is visible
      const feedList = document.querySelector(".feed-list");
      if (!feedList) return;

      const card = el("div", { class: "first-match-card", onclick: () => location.hash = "#profile/" + u.uid },
        el("img", { class: "avatar md", src: u.photoURL || ("https://api.dicebear.com/7.x/shapes/svg?seed=" + u.uid) }),
        el("div", { class: "fmc-meta" },
          el("div", { class: "fmc-label" }, "✦ Your First Match"),
          el("div", { class: "fmc-name" }, u.name || "User"),
          el("div", { class: "fmc-why" }, why),
        ),
        el("div", { class: "fmc-score" }, score + "%"),
      );
      feedList.insertBefore(card, feedList.firstChild);
    } catch (err) {
      console.warn("_showFirstMatchPreview:", err);
    }
    };

    // =========================================================================
// MUTUALS — Daily & All-Time mutual score engine
// Computes closeness from shared orbits + shared comment threads
// =========================================================================
const computeMutuals = async (dayOnly = false) => {
  if (!state.uid) return [];
  const cutoff = dayOnly ? Date.now() - 86400000 : 0;

  // 1. Posts this user orbited
  const orbitedSnap = await getDocs(
    query(collection(db, "posts"), where("orbits", "array-contains", state.uid), limit(40))
  ).catch(() => null);
  if (!orbitedSnap) return [];

  const relevantPosts = orbitedSnap.docs
    .filter(d => !dayOnly || (d.data().createdAt?.toMillis?.() || 0) >= cutoff)
    .map(d => ({ id: d.id, ...d.data() }));

  if (!relevantPosts.length) return [];

  // 2. Detect which of those posts the current user also commented on
  const commentedPostIds = new Set();
  await Promise.all(relevantPosts.map(async (p) => {
    const cSnap = await getDocs(
      query(collection(db, "posts", p.id, "comments"), where("authorUid", "==", state.uid), limit(1))
    ).catch(() => null);
    if (cSnap && !cSnap.empty) commentedPostIds.add(p.id);
  }));

  // 3. Score each other uid by shared orbits
  const scores = {};
  relevantPosts.forEach(p => {
    const bonus = commentedPostIds.has(p.id) ? 1.5 : 1;
    (p.orbits || []).filter(uid => uid !== state.uid).forEach(uid => {
      if (!scores[uid]) scores[uid] = { orbit: 0, comment: 0 };
      scores[uid].orbit += bonus;
    });
  });

  // 4. Score by shared comment threads
  await Promise.all([...commentedPostIds].map(async (postId) => {
    const cSnap = await getDocs(
      query(collection(db, "posts", postId, "comments"), limit(20))
    ).catch(() => null);
    if (!cSnap) return;
    cSnap.docs.forEach(d => {
      const uid = d.data().authorUid;
      if (uid && uid !== state.uid) {
        if (!scores[uid]) scores[uid] = { orbit: 0, comment: 0 };
        scores[uid].comment += 2;
      }
    });
  }));

  // 5. Compute percentage
  const maxPossible = Math.max(relevantPosts.length * 2.5 + commentedPostIds.size * 2, 1);
  const ranked = Object.entries(scores)
    .map(([uid, s]) => ({
      uid,
      raw: s.orbit + s.comment,
      pct: Math.min(99, Math.round(((s.orbit + s.comment) / maxPossible) * 100)),
    }))
    .filter(x => x.raw >= 1)
    .sort((a, b) => b.raw - a.raw)
    .slice(0, 20);

  // 6. Fetch profiles
  const users = await Promise.all(ranked.map(r => fetchUser(r.uid)));
  return ranked.map((r, i) => ({ ...r, user: users[i] })).filter(r => r.user);
};

const renderMutuals = async (container, dayOnly = true) => {
  container.innerHTML = "";
  container.appendChild(el("div", { class: "empty" },
    el("i", { class: "ri-loader-4-line", style: "animation:spin 1s linear infinite;" }),
    el("div", { class: "t" }, "Finding your mutuals…"),
  ));

  const mutuals = await computeMutuals(dayOnly);
  container.innerHTML = "";

  if (!mutuals.length) {
    container.appendChild(el("div", { class: "empty" },
      el("i", { class: "ri-team-line" }),
      el("div", { class: "t" }, dayOnly ? "No daily mutuals yet" : "No mutuals found"),
      el("div", {}, dayOnly
        ? "Orbit & comment on posts to discover who you vibe with today."
        : "Start orbiting posts to find people who share your taste."),
    ));
    return;
  }

  if (dayOnly) {
    const dateStr = new Date().toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
    container.appendChild(el("div", { class: "mutuals-date-badge" },
      el("i", { class: "ri-calendar-2-line" }), `  Today · ${dateStr}`,
    ));
  }

  const list = el("div", { class: "mutuals-list" });
  mutuals.forEach(({ uid, pct, user }) => {
    const dash = pct;
    const gap  = 100 - pct;
    const ringHtml = `<svg viewBox="0 0 36 36" class="mutual-ring-svg"><circle class="mutual-ring-bg" cx="18" cy="18" r="15.9" fill="none"/><circle class="mutual-ring-fill" cx="18" cy="18" r="15.9" fill="none" style="stroke-dasharray:${dash} ${gap};stroke-dashoffset:25;"/></svg><span class="mutual-pct-label">${pct}%</span>`;
    const card = el("div", { class: "mutual-card" },
      el("div", { class: "mutual-av-wrap", onclick: () => location.hash = `#profile/${uid}` },
        el("img", { class: "mutual-avatar", src: avatarFor(user) }),
        el("div", { class: "mutual-ring-wrap", html: ringHtml }),
      ),
      el("div", { class: "mutual-info", onclick: () => location.hash = `#profile/${uid}` },
        el("div", { class: "mutual-name" },
          user.name || "User",
          user.verified ? el("span", { class: "verified", html: '<i class="ri-check-line"></i>' }) : null,
        ),
        el("div", { class: "mutual-uname" }, `@${user.username || "user"}`),
        user.bio ? el("div", { class: "mutual-bio" }, user.bio.slice(0, 80)) : null,
        el("div", { class: "mutual-match" },
          el("i", { class: "ri-fire-fill" }),
          ` ${pct}% mutual ${dayOnly ? "today" : "overlap"}`,
        ),
      ),
      el("button", {
        class: "btn primary sm mutual-msg-btn",
        onclick: (e) => { e.stopPropagation(); location.hash = `#chats/${uid}`; },
      }, el("i", { class: "ri-chat-3-line" }), " Message"),
    );
    list.appendChild(card);
  });
  container.appendChild(list);
};

// =========================================================================
// 8. FEED — flat IG/FB style with separator lines + Trending lane
// Videos posted are regular posts — no separate Reels section.
// Feed shuffles on every fresh visit via scored + random jitter sort.
// =========================================================================
const renderFeed = (root) => {
  const wrap = el("div", { class: "feed-wrap" });

  const stub = el("div", { class: "composer-stub" },
    el("img", { class: "avatar sm", src: avatarFor(state.me), style: "cursor:pointer;", onclick: (e) => { e.stopPropagation(); location.hash = `#profile/${state.uid}`; } }),
    el("button", { onclick: () => openCreatePost() }, `What's on your vibe, ${(state.me?.name || "there").split(" ")[0]}?`)
  );
  wrap.appendChild(stub);

  // ── Doing Now button row ────────────────────────────────────────────────
  const doingNowRow = el("div", { class: "doing-now-row" },
    el("button", { class: "doing-now-btn", onclick: () => openDoingNowModal() },
      el("i", { class: "ri-camera-line" }), " What are you doing now?")
  );
  wrap.appendChild(doingNowRow);

  // Feed main content wrapper
  const feedMainContent = el("div", { class: "feed-main-content" });
  wrap.appendChild(feedMainContent);

  // Posts container
  const list = el("div", { class: "feed-list" });
  list.appendChild(el("div", { class: "empty" },
    el("i", { class: "ri-loader-4-line" }),
    el("div", { class: "t" }, "Loading your vibe"),
  ));
  feedMainContent.appendChild(list);
  root.appendChild(wrap);

  const q = query(collection(db, "posts"), orderBy("createdAt", "desc"), limit(50));
  let _lastPostIds = "";
  const unsub = onSnapshot(q, async (snap) => {
    const _newIds = snap.docs.map(d => d.id).join(",");
    if (_newIds === _lastPostIds && list.children.length > 0) return;
    _lastPostIds = _newIds;
    list.innerHTML = "";
    if (snap.empty) {
      list.appendChild(el("div", { class: "empty" },
        el("i", { class: "ri-planet-line" }),
        el("div", { class: "t" }, "Your vibe is quiet"),
        el("div", {}, "Be the first to post — tap Create above."),
      ));
      return;
    }

    const posts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    // resolve authors
    const authors = await Promise.all([...new Set(posts.map((p) => p.authorUid))].map(fetchUser));
    const byUid = Object.fromEntries(authors.filter(Boolean).map((u) => [u.uid, u]));

    // ── Algorithm: compatibility-first ranking ──────────────────────────────
    // Primary signal = taste compatibility (Jaccard match 0–100).
    // Secondary = following, hashtag overlap, engagement, recency jitter.
    const _following = state.me?.following || [];
    const _interests = state.me?.interests || [];

    // Pre-compute compatibility scores for all unique authors (parallel)
    const _uniqueAuthors = [...new Set(posts.map(p => p.authorUid).filter(u => u && u !== state.uid))];
    const _compatScores = {};
    await Promise.all(_uniqueAuthors.map(async (uid) => {
      _compatScores[uid] = await getCompatibility(uid).catch(() => 0);
    }));

    const _scored = posts.map((p) => {
      let score = 0;
      const compat = _compatScores[p.authorUid] || 0;
      score += compat * 0.9;                             // compatibility is the spine
      if (_following.includes(p.authorUid)) score += 35;
      if (_interests.some((tag) => (p.hashtags || []).includes(tag))) score += 20;
      score += Math.min((p.orbitCount || 0) * 1.5 + (p.commentCount || 0), 25);
      score += Math.max(0, 15 - Math.floor(((Date.now() - (p.createdAt?.toMillis?.() || Date.now())) / 3600000)));
      score += Math.random() * 10; // freshness jitter
      return { p, score, compat };
    });
    _scored.sort((a, b) => b.score - a.score);

    // Taste map banner — shown once above the feed for users with a taste profile
    if (!list._tasteMapShown && state.me?.tasteAnswers && Object.keys(state.me.tasteAnswers).length) {
      list._tasteMapShown = true;
      const banner = el("div", { class: "taste-map-banner" },
        el("div", { class: "tmb-icon" }, "✦"),
        el("div", { class: "tmb-body" },
          el("div", { class: "tmb-title" }, "Your Taste Map"),
          el("div", { class: "tmb-sub" }, "See what you're into — and who matches."),
        ),
        el("i", { class: "ri-arrow-right-line", style: "color:var(--text-mute);flex-shrink:0;" }),
      );
      banner.addEventListener("click", openTasteProfileSheet);
      list.appendChild(banner);
    }

    const _suggTypes = ["people", "groups", "spaces"];
    let _suggShown = 0;
    for (let idx = 0; idx < _scored.length; idx++) {
      const { p, compat } = _scored[idx];
      const postEl = renderPost(p, byUid[p.authorUid], { hideComments: true });
      list.appendChild(postEl);

      // "Why you're seeing this" signal — shown for any meaningful compatibility
      if (compat >= 40 && byUid[p.authorUid] && p.authorUid !== state.uid) {
        const firstName = (byUid[p.authorUid].name || "them").split(" ")[0];
        const shared = sharedTasteItems(state.me, byUid[p.authorUid]);
        const label = shared.length
          ? `You and ${firstName} both vibe with: ${shared[0]}`
          : `${compat}% taste match with ${firstName}`;
        postEl.appendChild(el("div", { class: "why-signal" },
          el("i", { class: "ri-fire-fill" }),
          label
        ));
      }

      // Suggestion card at post 4, then every 7 after that
      if (idx === 4 || (idx > 4 && (idx - 4) % 7 === 0)) {
        const type = _suggTypes[_suggShown % 3];
        _suggShown++;
        if (type === "people") list.appendChild(renderInlinePeopleSuggestion());
        else if (type === "groups") list.appendChild(renderInlineGroupSuggestion());
        else list.appendChild(renderInlineSpaceSuggestion());
      }
    }
  });

  // store unsub globally and on root so route changes can clean up
  _feedUnsub = unsub;
  root._unsub = unsub;
};


// =========================================================================
// 8a. MEDIA CAROUSEL / GRID
// 1 item  → single full-width image or video player
// 2 items → side-by-side grid (Facebook-style)
// 3 items → 1 large left + 2 stacked right (Facebook-style)
// 4+      → swipeable carousel
// =========================================================================
const _makeGridCell = (m, spanRows = false, _allItems = [], _idx = 0, _postId = null) => {
  const cellStyle = [
    "position:relative;overflow:hidden;cursor:pointer;",
    spanRows ? "grid-row:1/3;" : "",
  ].join("");
  const cell = el("div", { style: cellStyle });

  const _navigateToPost = (e) => {
    e.stopPropagation();
    if (_postId) location.hash = `#post/${_postId}`;
  };

  if (m.type === "video") {
    const vid = el("video", {
      src: m.url,
      poster: _cloudPoster(m.url),
      preload: "metadata",
      playsinline: "",
      style: "width:100%;height:100%;object-fit:cover;display:block;cursor:pointer;",
    });
    const overlay = el("div", {
      class: "media-grid-play",
      style: "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.18);",
    }, el("i", { class: "ri-play-circle-fill", style: "font-size:44px;color:#fff;filter:drop-shadow(0 2px 10px rgba(0,0,0,0.5));" }));
    // Clicking navigates to post detail instead of opening modal
    vid.addEventListener("click", _navigateToPost);
    overlay.addEventListener("click", _navigateToPost);
    cell.appendChild(vid);
    cell.appendChild(overlay);
  } else {
    const img = el("img", { src: m.url, loading: "lazy", style: "width:100%;height:100%;object-fit:cover;display:block;" });
    img.addEventListener("click", _navigateToPost);
    cell.appendChild(img);
  }
  return cell;
};

const renderMediaCarousel = (mediaRaw, postId = null, opts = {}) => {
  const { detailView = false, song = null } = opts;
  const items = Array.isArray(mediaRaw) ? mediaRaw : (mediaRaw ? [mediaRaw] : []);
  if (!items.length) return null;
  // A song attaches at the post level; if the media itself isn't a single
  // video (which syncs playback directly), sync the song to the whole
  // media block scrolling into view instead.
  const _wireStandaloneSong = (node) => { if (song) _wireSongPlayback(node, song, null); return node; };

  // ── Detail view: all items stacked vertically (Facebook-style) ──
  if (detailView && items.length > 1) {
    const stack = el("div", { class: "post-media-stack", style: "display:flex;flex-direction:column;gap:4px;position:relative;" });
    let sawVideo = false;
    items.forEach((m) => {
      if (m.type === "video") {
        sawVideo = true;
        const player = buildVideoPlayer(m.url, { song, overlays: m.overlays });
        player.style.borderRadius = "0";
        stack.appendChild(player);
      } else {
        const img = el("img", {
          src: m.url, loading: "lazy",
          style: "width:100%;display:block;max-height:85vh;object-fit:contain;background:#000;cursor:zoom-in;",
        });
        img.addEventListener("click", () => openImageZoom(m.url));
        stack.appendChild(img);
      }
    });
    if (song && !sawVideo) _wireStandaloneSong(stack);
    return stack;
  }

  // ── Single item ────────────────────────────────────────────────
  if (items.length === 1) {
    const m = items[0];
    if (m.type === "video") {
      // Full-width, no side border-radius so it stretches edge-to-edge
      const player = buildVideoPlayer(m.url, { song, overlays: m.overlays });
      player.style.borderRadius = "0";
      const wrap = el("div", { class: "post-media", style: "border-radius:0;overflow:hidden;" });
      wrap.appendChild(player);
      return wrap;
    }
    const singleImg = el("img", { src: m.url, loading: "lazy", style: detailView ? "cursor:zoom-in;" : "" });
    if (detailView) singleImg.addEventListener("click", () => openImageZoom(m.url));
    const wrap = el("div", { class: "post-media", style: "position:relative;" }, singleImg);
    if (song) _wireStandaloneSong(wrap);
    return wrap;
  }

  // ── 2 items: side-by-side ──────────────────────────────────────
  if (items.length === 2) {
    const grid = el("div", {
      class: "post-media",
      style: "display:grid;grid-template-columns:1fr 1fr;gap:2px;border-radius:12px;overflow:hidden;height:280px;position:relative;",
    });
    items.forEach((m, i) => grid.appendChild(_makeGridCell(m, false, items, i, postId)));
    if (song) _wireStandaloneSong(grid);
    return grid;
  }

  // ── 3 items: 1 large left + 2 stacked right ────────────────────
  if (items.length === 3) {
    const grid = el("div", {
      class: "post-media",
      style: "display:grid;grid-template-columns:2fr 1fr;grid-template-rows:140px 140px;gap:2px;border-radius:12px;overflow:hidden;position:relative;",
    });
    items.forEach((m, i) => grid.appendChild(_makeGridCell(m, i === 0, items, i, postId)));
    if (song) _wireStandaloneSong(grid);
    return grid;
  }

  // ── 4+ items: swipeable carousel ──────────────────────────────
  let cur = 0;
  const slides = items.map((m, i) => {
    const slide = el("div", { class: "carousel-slide", style: i === 0 ? "" : "display:none;" });
    if (m.type === "video") {
      const player = buildVideoPlayer(m.url, { overlays: m.overlays });
      // Clicking anywhere on the player navigates to the post detail
      if (postId) {
        const overlay = player.querySelector(".vp-overlay");
        if (overlay) overlay.onclick = (e) => { e.stopPropagation(); location.hash = `#post/${postId}`; };
        const fullBtn = player.querySelector(".vp-btn:last-child");
        if (fullBtn) fullBtn.onclick = (e) => { e.stopPropagation(); location.hash = `#post/${postId}`; };
      }
      slide.appendChild(player);
    } else {
      const img = el("img", { src: m.url, loading: "lazy", style: postId ? "cursor:pointer;" : "" });
      if (postId) img.onclick = (e) => { e.stopPropagation(); location.hash = `#post/${postId}`; };
      slide.appendChild(img);
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
  const wrap = el("div", { class: "post-media carousel", style: "position:relative;" }, ...slides, dotsWrap);
  if (song) _wireStandaloneSong(wrap);

  // Touch swipe support
  let _swipeStartX = 0;
  let _swipeStartY = 0;
  wrap.addEventListener("touchstart", (e) => {
    _swipeStartX = e.touches[0].clientX;
    _swipeStartY = e.touches[0].clientY;
  }, { passive: true });
  wrap.addEventListener("touchend", (e) => {
    const dx = e.changedTouches[0].clientX - _swipeStartX;
    const dy = e.changedTouches[0].clientY - _swipeStartY;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
      e.stopPropagation();
      go(dx < 0 ? cur + 1 : cur - 1);
    }
  }, { passive: true });

  // Mouse drag support (desktop)
  let _mouseStartX = 0;
  let _mouseDragging = false;
  wrap.addEventListener("mousedown", (e) => { _mouseStartX = e.clientX; _mouseDragging = true; });
  wrap.addEventListener("mouseup", (e) => {
    if (!_mouseDragging) return;
    _mouseDragging = false;
    const dx = e.clientX - _mouseStartX;
    if (Math.abs(dx) > 40) { e.stopPropagation(); go(dx < 0 ? cur + 1 : cur - 1); }
  });
  wrap.addEventListener("mouseleave", () => { _mouseDragging = false; });

  return wrap;
};

// =========================================================================
// openDoingNowModal — "What are you doing now?" composer (kind: doingNow)
// =========================================================================
const openDoingNowModal = () => {
  let _doingNowFile = null;

  const overlay = el("div", { class: "modal doing-now-modal", style: "z-index:1050;" });
  const card = el("div", { class: "modal-card" });

  card.appendChild(el("div", { class: "modal-head" },
    el("h3", {}, "What are you doing now?"),
    el("button", { class: "icon-btn", onclick: () => overlay.remove() }, el("i", { class: "ri-close-line" }))
  ));

  const body = el("div", { class: "compose-pane", style: "gap:14px;" });

  // Photo preview / picker
  const photoPreview = el("div", { class: "dn-photo-preview",
    style: "width:100%;aspect-ratio:1;background:var(--bg-elev-2);border-radius:14px;border:1.5px dashed var(--line);display:flex;align-items:center;justify-content:center;overflow:hidden;cursor:pointer;position:relative;" });
  photoPreview.appendChild(el("div", { style: "display:flex;flex-direction:column;align-items:center;gap:8px;color:var(--text-mute);" },
    el("i", { class: "ri-image-add-line", style: "font-size:32px;" }),
    el("span", { style: "font-size:13px;font-weight:600;" }, "Tap to add photo")
  ));
  const photoInput = el("input", { type: "file", accept: "image/*" });
  photoInput.style.display = "none";
  photoInput.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    _doingNowFile = file;
    const previewUrl = URL.createObjectURL(file);
    photoPreview.innerHTML = "";
    photoPreview.appendChild(el("img", { src: previewUrl, style: "width:100%;height:100%;object-fit:cover;" }));
    const changeBtn = el("button", { style: "position:absolute;bottom:8px;right:8px;background:rgba(0,0,0,.55);color:#fff;border-radius:999px;padding:4px 10px;font-size:12px;font-weight:600;" }, "Change");
    changeBtn.addEventListener("click", (ev) => { ev.stopPropagation(); photoInput.click(); });
    photoPreview.appendChild(changeBtn);
  });
  photoPreview.addEventListener("click", () => photoInput.click());
  body.appendChild(photoPreview);
  body.appendChild(photoInput);

  // Status text
  const statusInput = el("input", { type: "text", placeholder: "Add a short status… (e.g. 'Making coffee ☕')", maxlength: 80 });
  body.appendChild(statusInput);

  const submitBtn = el("button", { class: "btn primary block" }, el("i", { class: "ri-send-plane-line" }), " Share moment");
  submitBtn.addEventListener("click", async () => {
    const text = statusInput.value.trim();
    if (!_doingNowFile && !text) { toast("Add a photo or status text"); return; }
    submitBtn.disabled = true;
    submitBtn.textContent = "Sharing…";
    try {
      const postData = {
        kind: "doingNow",
        text: text || "",
        authorUid: state.uid,
        createdAt: serverTimestamp(),
        orbits: [], orbitCount: 0, commentCount: 0, views: 0,
      };
      if (_doingNowFile) {
        const up = await uploadToCloudinary(_doingNowFile, "image");
        postData.media = [{ type: "image", url: up.url }];
        postData.doingNowPhoto = up.url;
      }
      await addDoc(collection(db, "posts"), postData);
      sfxPost();
      toast("Moment shared! 📸");
      overlay.remove();
    } catch { toast("Failed to share moment"); submitBtn.disabled = false; submitBtn.textContent = "Share moment"; }
  });
  body.appendChild(submitBtn);
  card.appendChild(body);
  overlay.appendChild(card);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
};

const renderPost = (p, author, opts = {}) => {
  const iOrbited = (p.orbits || []).includes(state.uid);
  const isMine = p.authorUid === state.uid;
  const trending = (p.orbitCount || 0) >= 3;
  const { hideComments = false, detailView: _detailView = false } = opts;

  // View-count tracking: count once per session per post (skip own posts)
  if (!isMine && p.id) {
    if (!state._viewedPosts) state._viewedPosts = new Set();
    if (!state._viewedPosts.has(p.id)) {
      state._viewedPosts.add(p.id);
      updateDoc(doc(db, "posts", p.id), { views: increment(1) }).catch(() => {});
    }
  }

  const post = el("article", { class: `post${trending ? " is-trending" : ""}` });

  // ── "Doing Now" posts render as a circular moment card ──────────────────
  if (p.kind === "doingNow") {
    const _photo = Array.isArray(p.media) ? p.media[0]?.url : p.media?.url;
    const nowCard = el("article", { class: "post post-now-card", onclick: () => location.hash = `#post/${p.id}` });
    if (_photo) nowCard.appendChild(el("img", { class: "now-card-photo", src: _photo, loading: "lazy" }));
    const _overlay = el("div", { class: "now-card-overlay" },
      el("div", { class: "now-card-author" },
        el("img", { class: "avatar xs", src: avatarFor(author) }),
        el("span", {}, author?.name || "User"),
      ),
    );
    if (p.text) _overlay.appendChild(el("div", { class: "now-card-text" }, p.text));
    nowCard.appendChild(_overlay);
    nowCard.appendChild(el("div", { style: "padding:6px 12px 4px;font-size:11px;color:var(--text-mute);" }, fmtTime(p.createdAt)));
    return nowCard;
  }

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
    p.song ? el("div", { class: "post-song-tag", title: `${p.song.name} — ${p.song.artist}` },
      el("i", { class: "ri-music-2-fill" }),
      el("span", {}, `${p.song.name} · ${p.song.artist}`),
    ) : null,
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
        // Keep caches for both profiles fresh so follower/following counts
        // update immediately anywhere they're rendered without a full reload.
        state.cache.users.delete(author.uid);
        state.cache.users.delete(state.uid);
        if (_isFollowing) {
          writeNotif(author.uid, "follow", {}).catch(() => {});
          import("./notifications.js").then(({ notifyUser }) =>
            notifyUser(author.uid, state.me?.name || "Someone", "started following you", "/#profile/" + state.uid, state.me?.photoURL || "")
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
      const body = el("div", { class: "post-text" });
      const TRUNC_LEN = 280;
      if (!_detailView && p.text.length > TRUNC_LEN) {
        let expanded = false;
        const shortText = p.text.slice(0, TRUNC_LEN).trim();
        const paint = () => {
          body.innerHTML = linkify(expanded ? p.text : shortText + "… ");
          const moreBtn = el("span", { class: "see-more-btn", text: expanded ? "See less" : "See more" });
          moreBtn.addEventListener("click", (e) => { e.stopPropagation(); expanded = !expanded; paint(); });
          body.appendChild(moreBtn);
        };
        paint();
      } else {
        body.innerHTML = linkify(p.text);
        body.onclick = () => location.hash = `#post/${p.id}`;
      }
      post.appendChild(body);
    }
  }

  // Media (single, grid, or carousel)
  const carousel = renderMediaCarousel(p.media, p.id, { detailView: _detailView, song: p.song });
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
    if (_iOrbited) sfxOrbit();
    orbitIcon.className = _iOrbited ? "ri-fire-fill" : "ri-fire-line";
    orbitCount.textContent = String((p.orbitCount || 0) + (_iOrbited ? 1 : -1));
    orbitBtn.classList.toggle("active", _iOrbited);
    await updateDoc(doc(db, "posts", p.id), {
      orbits: _iOrbited ? arrayUnion(state.uid) : arrayRemove(state.uid),
      orbitCount: increment(_iOrbited ? 1 : -1),
    }).catch(() => {});
    // Send notification to post author when orbiting (not for own posts)
    if (_iOrbited && author?.uid && author.uid !== state.uid) {
      writeNotif(author.uid, "orbit", {
        postId: p.id,
        text: `${state.me?.name || "Someone"} orbited your post`,
      }).catch(() => {});
      const _thumb = Array.isArray(p.media) ? p.media[0]?.url : p.media?.url;
      import("./notifications.js").then(({ notifyUser }) =>
        notifyUser(author.uid, state.me?.name || "Someone", "orbited your post", "/#post/" + p.id, state.me?.photoURL || "", _thumb || "")
      ).catch(() => {});
    }
  }}, orbitIcon, el("span", {}, "Vibe · "), orbitCount);

  const saveIcon = (state.me?.saved || []).includes(p.id) ? "ri-bookmark-fill" : "ri-bookmark-line";

  const viewsBadge = el("span", { class: "post-act post-views", title: "Views" },
    el("i", { class: "ri-eye-line" }),
    " " + String(p.views || 0),
  );

  const actions = el("div", { class: "post-actions" },
    el("div", { class: "post-actions-left" },
      el("button", { class: "post-act", onclick: (e) => { e.stopPropagation(); location.hash = `#post/${p.id}`; }},
        el("i", { class: "ri-chat-1-line" }),
        String(p.commentCount || 0),
      ),
      el("button", { class: "post-act", onclick: async (e) => {
        e.stopPropagation();
        const url = `${location.origin}${location.pathname}#post/${p.id}`;
        try { await navigator.share?.({ title: "Vibe", text: p.text || "Check this out", url }); }
        catch { await navigator.clipboard.writeText(url); toast("Link copied"); }
      }},
        el("i", { class: "ri-share-forward-line" }),
        "Share",
      ),
      el("button", { class: "post-act", onclick: (e) => { e.stopPropagation(); toggleSave(p.id); } },
        el("i", { class: saveIcon }),
      ),
    ),
    el("div", { class: "post-actions-right" },
      viewsBadge,
      orbitBtn,
    ),
  );
  post.appendChild(actions);

  if (!hideComments) {
    // Comments preview (top 5)
    const cBox = el("div", { class: "comments hidden" });
    post.appendChild(cBox);

    // Track reply state
    let _replyTo = null; // { uid, name }

    const replyBanner = el("div", { class: "reply-banner hidden" },
      el("span", { class: "reply-banner-text" }, ""),
      el("button", { class: "reply-cancel-btn", onclick: () => {
        _replyTo = null;
        replyBanner.classList.add("hidden");
        cForm.querySelector("input").placeholder = "Write a comment…";
        cForm.querySelector("input").value = "";
      }}, el("i", { class: "ri-close-line" })),
    );
    post.appendChild(replyBanner);

    // ── Comment media + voice-note state ────────────────────────
    let _cmtMediaFile = null;
    let _cmtAudioBlob = null;
    let _cmtRecorder  = null;
    let _cmtRecording = false;

    const cmtMediaInput = el("input", { type: "file", accept: "image/*,video/*" });
    cmtMediaInput.style.display = "none";
    post.appendChild(cmtMediaInput);

    const cmtAttachPreview = el("div", { class: "cmt-attach-preview hidden" });
    post.appendChild(cmtAttachPreview);

    const clearCmtAttach = () => {
      _cmtMediaFile = null; _cmtAudioBlob = null;
      cmtAttachPreview.innerHTML = ""; cmtAttachPreview.classList.add("hidden");
    };

    const showCmtMediaPreview = (file) => {
      cmtAttachPreview.innerHTML = ""; cmtAttachPreview.classList.remove("hidden");
      const isVideo = file.type.startsWith("video");
      const url = URL.createObjectURL(file);
      const thumb = isVideo
        ? el("video", { src: url, muted: "", preload: "metadata", style: "width:72px;height:72px;object-fit:cover;border-radius:10px;display:block;" })
        : el("img",  { src: url, style: "width:72px;height:72px;object-fit:cover;border-radius:10px;display:block;" });
      const rmBtn = el("button", { type: "button", class: "cmt-attach-remove",
        html: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>` });
      rmBtn.addEventListener("click", clearCmtAttach);
      cmtAttachPreview.appendChild(el("div", { class: "cmt-attach-thumb" }, thumb, rmBtn));
    };

    const showCmtAudioPreview = (blob) => {
      cmtAttachPreview.innerHTML = ""; cmtAttachPreview.classList.remove("hidden");
      const url = URL.createObjectURL(blob);
      const audio = el("audio", { src: url, controls: true, style: "height:28px;max-width:160px;" });
      const rmBtn = el("button", { type: "button", class: "cmt-attach-remove",
        html: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>` });
      rmBtn.addEventListener("click", clearCmtAttach);
      cmtAttachPreview.appendChild(el("div", { class: "cmt-attach-audio" }, audio, rmBtn));
    };

    cmtMediaInput.addEventListener("change", (e) => {
      const file = e.target.files?.[0]; if (!file) return;
      _cmtMediaFile = file; _cmtAudioBlob = null;
      showCmtMediaPreview(file); cmtMediaInput.value = "";
    });

    // Media button (image/video)
    const cmtMediaBtn = el("button", {
      type: "button", class: "icon-btn cmt-icon-btn", title: "Add photo or video",
      html: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
    });
    cmtMediaBtn.addEventListener("click", (e) => { e.stopPropagation(); cmtMediaInput.click(); });

    // Mic button (voice note)
    const SVG_MIC  = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`;
    const SVG_STOP = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="3"/></svg>`;
    const cmtMicBtn = el("button", { type: "button", class: "icon-btn cmt-icon-btn", title: "Record voice note", html: SVG_MIC });
    cmtMicBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (_cmtRecording) { _cmtRecorder?.stop(); return; }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const chunks = [];
        _cmtRecorder = new MediaRecorder(stream);
        _cmtRecorder.ondataavailable = (ev) => { if (ev.data.size > 0) chunks.push(ev.data); };
        _cmtRecorder.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          _cmtAudioBlob = new Blob(chunks, { type: "audio/webm" });
          _cmtMediaFile = null; _cmtRecording = false;
          cmtMicBtn.innerHTML = SVG_MIC; cmtMicBtn.style.color = ""; cmtMicBtn.classList.remove("recording");
          showCmtAudioPreview(_cmtAudioBlob);
        };
        _cmtRecorder.start(); _cmtRecording = true;
        cmtMicBtn.innerHTML = SVG_STOP; cmtMicBtn.style.color = "var(--danger)"; cmtMicBtn.classList.add("recording");
        clearCmtAttach();
      } catch { toast("Microphone access denied"); }
    });

    const cForm = el("form", { class: "comment-form" });
    const cFormRow = el("div", { class: "comment-form-row" },
      el("img", { class: "avatar xs", src: avatarFor(state.me), style: "cursor:pointer;", onclick: () => location.hash = `#profile/${state.uid}` }),
      el("input", { type: "text", placeholder: "Write a comment…" }),
      cmtMediaBtn,
      cmtMicBtn,
      el("button", { class: "icon-btn", type: "submit" }, el("i", { class: "ri-send-plane-fill" })),
    );
    cForm.appendChild(cFormRow);

    cForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = cForm.querySelector("input");
      const text = input.value.trim();
      if (!text && !_cmtMediaFile && !_cmtAudioBlob) return;
      const submitBtn = cForm.querySelector("button[type='submit']");
      submitBtn.disabled = true;
      try {
        const commentData = {
          text: text || "", authorUid: state.uid, createdAt: serverTimestamp(), likes: [],
          ..._replyTo ? { replyToUid: _replyTo.uid, replyToName: _replyTo.name, replyToUsername: _replyTo.username } : {},
        };
        if (_cmtMediaFile) {
          const kind = _cmtMediaFile.type.startsWith("video") ? "video" : "image";
          const up = await uploadToCloudinary(_cmtMediaFile, kind);
          commentData.mediaUrl = up.url; commentData.mediaType = kind;
        } else if (_cmtAudioBlob) {
          const audioFile = new File([_cmtAudioBlob], "voice.webm", { type: "audio/webm" });
          const up = await uploadToCloudinary(audioFile, "video");
          commentData.audioUrl = up.url;
        }
        input.value = ""; _replyTo = null;
        replyBanner.classList.add("hidden"); input.placeholder = "Write a comment…";
        clearCmtAttach();
        // Optimistic UI
        cBox.classList.remove("hidden");
        cBox.appendChild(el("div", { class: "comment" },
          el("img", { class: "avatar xs", src: avatarFor(state.me), onclick: () => location.hash = `#profile/${state.uid}` }),
          el("div", { class: "body" },
            el("div", { class: "name" }, state.me?.name || "User"),
            commentData.text ? el("div", { class: "text", text: commentData.text }) : null,
          ),
        ));
        sfxComment();
        await addDoc(collection(db, "posts", p.id, "comments"), commentData);
        await updateDoc(doc(db, "posts", p.id), { commentCount: increment(1) });
        const notifSnippet = commentData.text ? `"${commentData.text.slice(0, 60)}"` : commentData.mediaType ? "📷 sent a photo" : "🎙️ sent a voice note";
        if (author?.uid && author.uid !== state.uid) {
          writeNotif(author.uid, "comment", { postId: p.id, text: `${state.me?.name || "Someone"} commented: ${notifSnippet}` }).catch(() => {});
          const _thumb = Array.isArray(p.media) ? p.media[0]?.url : p.media?.url;
          import("./notifications.js").then(({ notifyUser }) =>
            notifyUser(author.uid, state.me?.name || "Someone", "commented on your post", "/#post/" + p.id, state.me?.photoURL || "", _thumb || "")
          ).catch(() => {});
        }
        if (commentData.replyToUid && commentData.replyToUid !== state.uid && commentData.replyToUid !== author?.uid) {
          writeNotif(commentData.replyToUid, "commentReply", { postId: p.id, text: `${state.me?.name || "Someone"} replied to your comment: ${notifSnippet}` }).catch(() => {});
          import("./notifications.js").then(({ notifyUser }) =>
            notifyUser(commentData.replyToUid, state.me?.name || "Someone", "replied to your comment", "/#post/" + p.id, state.me?.photoURL || "")
          ).catch(() => {});
        }
      } catch { toast("Failed to send comment"); } finally { submitBtn.disabled = false; }
    });
    post.appendChild(cForm);

    const renderFeedComment = (c, a) => {
      const isLiked = (c.likes || []).includes(state.uid);
      const likeCountEl = el("span", { text: String((c.likes || []).length || "") });
      const likeIconEl = el("i", { class: isLiked ? "ri-heart-fill" : "ri-heart-line", style: isLiked ? "color:var(--danger);" : "" });
      let _liked = isLiked;
      const likeBtn = el("button", { class: "cmt-like-btn", onclick: async (e) => {
        e.stopPropagation();
        _liked = !_liked;
        likeIconEl.className = _liked ? "ri-heart-fill" : "ri-heart-line";
        likeIconEl.style.color = _liked ? "var(--danger)" : "";
        const newCount = (c.likes?.length || 0) + (_liked ? 1 : -1);
        likeCountEl.textContent = newCount > 0 ? String(newCount) : "";
        await updateDoc(doc(db, "posts", p.id, "comments", c.id), {
          likes: _liked ? arrayUnion(state.uid) : arrayRemove(state.uid),
        }).catch(() => {});
        if (_liked && a?.uid && a.uid !== state.uid) {
          writeNotif(a.uid, "commentLike", { postId: p.id, text: `${state.me?.name || "Someone"} liked your comment` }).catch(() => {});
          import("./notifications.js").then(({ notifyUser }) =>
            notifyUser(a.uid, state.me?.name || "Someone", "liked your comment", "/#post/" + p.id, state.me?.photoURL || "")
          ).catch(() => {});
        }
      }}, likeIconEl, likeCountEl);

      const replyBtn = el("button", { class: "cmt-reply-btn", onclick: () => {
        _replyTo = { uid: a?.uid, name: a?.name || "user", username: a?.username || "" };
        replyBanner.querySelector(".reply-banner-text").textContent = `Replying to @${a?.username || a?.name || "user"}`;
        replyBanner.classList.remove("hidden");
        cForm.querySelector("input").placeholder = `Reply to @${a?.username || a?.name || "user"}…`;
        cForm.querySelector("input").focus();
      }}, "Reply");

      return el("div", { class: "comment" },
        el("img", { class: "avatar xs", src: avatarFor(a), onclick: () => location.hash = `#profile/${a?.uid}` }),
        el("div", { class: "body" },
          el("div", { class: "name" }, a?.name || "User",
            a?.verified ? el("span", { class: "verified", html: '<i class="ri-check-line"></i>' }) : null),
          (c.replyToUsername || c.replyToName) ? el("div", { class: "reply-to-label" }, el("i", { class: "ri-corner-down-right-line" }), el("a", { class: "mention", href: `#profile-u/${c.replyToUsername || c.replyToName}` }, `@${c.replyToUsername || c.replyToName}`)) : null,
          c.text ? el("div", { class: "text", text: c.text }) : null,
          c.mediaUrl ? el("div", { class: "cmt-media", onclick: (e) => { e.stopPropagation(); c.mediaType === "video" ? openVideoViewer([{ type: "video", url: c.mediaUrl }], 0) : openImageZoom(c.mediaUrl); }},
            c.mediaType === "video"
              ? el("div", { class: "cmt-media-video-wrap" },
                  el("video", { src: c.mediaUrl, muted: "", preload: "metadata", style: "max-width:200px;max-height:150px;object-fit:cover;display:block;" }),
                  el("div", { class: "cmt-media-video-play", html: `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg>` }),
                )
              : el("img", { src: c.mediaUrl, loading: "lazy", style: "max-width:200px;max-height:150px;object-fit:cover;display:block;" }),
          ) : null,
          c.audioUrl ? el("div", { class: "cmt-voice-note" },
            el("span", { html: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>` }),
            el("audio", { src: c.audioUrl, controls: true, style: "height:28px;max-width:150px;" }),
          ) : null,
          el("div", { class: "cmt-meta-row" }, replyBtn, likeBtn),
        ),
      );
    };

    onSnapshot(query(collection(db, "posts", p.id, "comments"), orderBy("createdAt", "desc"), limit(5)),
      async (snap) => {
        cBox.innerHTML = "";
        if (snap.empty) { cBox.classList.add("hidden"); return; }
        cBox.classList.remove("hidden");
        const comments = snap.docs.map((d) => ({ id: d.id, ...d.data() })).reverse();
        const authors = await Promise.all([...new Set(comments.map((c) => c.authorUid))].map(fetchUser));
        const map = Object.fromEntries(authors.filter(Boolean).map((u) => [u.uid, u]));
        comments.forEach((c) => cBox.appendChild(renderFeedComment(c, map[c.authorUid])));
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

  // Render the post card with media stacked vertically in detail view
  root.appendChild(renderPost(p, author, { hideComments: true, detailView: true }));

  // Full comments section
  const cmtSection = el("div", { class: "detail-comments" });
  root.appendChild(cmtSection);

  const cmtHead = el("div", { class: "detail-cmt-head" }, "Comments");
  cmtSection.appendChild(cmtHead);

  const cList = el("div", { class: "detail-cmt-list" });
  cmtSection.appendChild(cList);

  // Track reply state for detail view
  let _detailReplyTo = null;
  const detailReplyBanner = el("div", { class: "reply-banner hidden" },
    el("span", { class: "reply-banner-text" }, ""),
    el("button", { class: "reply-cancel-btn", onclick: () => {
      _detailReplyTo = null;
      detailReplyBanner.classList.add("hidden");
      cmtSection.querySelector("input").placeholder = "Write a comment…";
      cmtSection.querySelector("input").value = "";
    }}, el("i", { class: "ri-close-line" })),
  );
  cmtSection.appendChild(detailReplyBanner);

  // ── Twitter / X style comment renderer ──────────────────────────────────
  // Layout: avatar column (with optional thread line) + body column
  // Header: Name · @username · time on one line
  // Actions: Reply | Like (count) | Share — spread horizontally
  const renderDetailComment = (c, a, compatPct = 0) => {
    const isLiked = (c.likes || []).includes(state.uid);
    let _liked = isLiked;
    const likeCountEl = el("span", { class: "tw-act-count", text: (c.likes?.length || 0) > 0 ? String(c.likes.length) : "" });
    const likeIconEl  = el("i",    { class: isLiked ? "ri-heart-fill" : "ri-heart-line" });

    const likeBtn = el("button", { class: `tw-act-btn${isLiked ? " tw-liked" : ""}`, onclick: async (ev) => {
      ev.stopPropagation();
      _liked = !_liked;
      likeIconEl.className = _liked ? "ri-heart-fill" : "ri-heart-line";
      likeBtn.classList.toggle("tw-liked", _liked);
      const newCount = (c.likes?.length || 0) + (_liked ? 1 : -1);
      likeCountEl.textContent = newCount > 0 ? String(newCount) : "";
      await updateDoc(doc(db, "posts", p.id, "comments", c.id), {
        likes: _liked ? arrayUnion(state.uid) : arrayRemove(state.uid),
      }).catch(() => {});
      if (_liked && a?.uid && a.uid !== state.uid) {
        writeNotif(a.uid, "commentLike", { postId: p.id, text: `${state.me?.name || "Someone"} liked your comment` }).catch(() => {});
        import("./notifications.js").then(({ notifyUser }) =>
          notifyUser(a.uid, state.me?.name || "Someone", "liked your comment", "/#post/" + p.id, state.me?.photoURL || "")
        ).catch(() => {});
      }
    }}, likeIconEl, likeCountEl);

    const replyCountEl = el("span", { class: "tw-act-count" });
    const replyBtn = el("button", { class: "tw-act-btn", onclick: () => {
      _detailReplyTo = { uid: a?.uid, name: a?.name || "user", username: a?.username || "" };
      detailReplyBanner.querySelector(".reply-banner-text").textContent = `Replying to @${a?.username || a?.name || "user"}`;
      detailReplyBanner.classList.remove("hidden");
      const inp = cmtSection.querySelector("input");
      inp.placeholder = `Reply to @${a?.username || a?.name || "user"}…`;
      inp.focus();
    }}, el("i", { class: "ri-chat-1-line" }), replyCountEl);

    const shareBtn = el("button", { class: "tw-act-btn", onclick: async () => {
      const url = `${location.origin}${location.pathname}#post/${p.id}`;
      try { await navigator.share?.({ title: "Vibe", text: c.text || "", url }); }
      catch { await navigator.clipboard.writeText(url); toast("Link copied"); }
    }}, el("i", { class: "ri-share-forward-line" }));

    // Avatar column — with thread line connecting to next reply if present
    const avatarCol = el("div", { class: "tw-av-col" },
      el("img", {
        class: "tw-av",
        src: avatarFor(a),
        onclick: (e) => { e.stopPropagation(); location.hash = `#profile/${a?.uid}`; }
      }),
    );

    // Compatibility badge (only for well-matched commenters)
    const compatBadge = compatPct >= 50
      ? el("span", { class: "tw-compat-badge" }, `✦ ${compatPct}%`)
      : null;

    // Reply-to label
    const replyLabel = (c.replyToUsername || c.replyToName)
      ? el("div", { class: "tw-reply-label" },
          el("span", { class: "tw-reply-at" }, `Replying to @${c.replyToUsername || c.replyToName}`)
        )
      : null;

    // Media block
    let mediaEl = null;
    if (c.mediaUrl) {
      mediaEl = el("div", { class: "tw-cmt-media", onclick: (ev) => {
        ev.stopPropagation();
        c.mediaType === "video" ? openVideoViewer([{ type: "video", url: c.mediaUrl }], 0) : openImageZoom(c.mediaUrl);
      }},
        c.mediaType === "video"
          ? el("div", { class: "cmt-media-video-wrap" },
              el("video", { src: c.mediaUrl, muted: "", preload: "metadata" }),
              el("div", { class: "cmt-media-video-play", html: `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg>` }),
            )
          : el("img", { src: c.mediaUrl, loading: "lazy" }),
      );
    } else if (c.audioUrl) {
      mediaEl = el("div", { class: "cmt-voice-note" },
        el("span", { html: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>` }),
        el("audio", { src: c.audioUrl, controls: true, style: "height:28px;max-width:180px;" }),
      );
    }

    return el("div", { class: "tw-comment" },
      avatarCol,
      el("div", { class: "tw-body" },
        el("div", { class: "tw-header" },
          el("span", { class: "tw-name" }, a?.name || "User"),
          a?.verified ? el("span", { class: "verified", html: '<i class="ri-check-line"></i>' }) : null,
          el("span", { class: "tw-username" }, `@${a?.username || "user"}`),
          el("span", { class: "tw-dot" }, "·"),
          el("span", { class: "tw-time" }, fmtTime(c.createdAt)),
          compatBadge,
        ),
        replyLabel,
        c.text ? el("div", { class: "tw-text" }, c.text) : null,
        mediaEl,
        el("div", { class: "tw-actions" },
          replyBtn,
          likeBtn,
          shareBtn,
        ),
      ),
    );
  };

  const DETAIL_CMT_PAGE = 5;
  let _detailCmtSnap = null;

  const loadDetailComments = async (showAll = false) => {
    const q = showAll
      ? query(collection(db, "posts", p.id, "comments"), orderBy("createdAt", "asc"), limit(200))
      : query(collection(db, "posts", p.id, "comments"), orderBy("createdAt", "asc"), limit(DETAIL_CMT_PAGE));
    if (_detailCmtSnap) _detailCmtSnap();
    _detailCmtSnap = onSnapshot(q, async (snap) => {
      cList.innerHTML = "";
      if (snap.empty) {
        cList.appendChild(el("div", { class: "tw-cmt-empty" },
          el("i", { class: "ri-chat-3-line" }),
          el("div", {}, "No comments yet — be the first to reply!")
        ));
        return;
      }
      const comments = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const auths = await Promise.all([...new Set(comments.map((c) => c.authorUid))].map(fetchUser));
      const map = Object.fromEntries(auths.filter(Boolean).map((u) => [u.uid, u]));

      // ── Rank comments by compatibility with viewer ────────────────────────
      // Taste-compatible commenters surface first; fall back to chronological.
      const uniqueCommenters = [...new Set(comments.map(c => c.authorUid).filter(u => u && u !== state.uid))];
      const cmtCompatMap = {};
      await Promise.all(uniqueCommenters.map(async uid => {
        cmtCompatMap[uid] = await getCompatibility(uid).catch(() => 0);
      }));
      const ranked = [...comments].sort((a, b) => {
        const ca = cmtCompatMap[a.authorUid] || 0;
        const cb = cmtCompatMap[b.authorUid] || 0;
        if (Math.abs(ca - cb) > 10) return cb - ca;          // compat-first
        return (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0); // then chrono
      });

      ranked.forEach((c) => {
        const compat = cmtCompatMap[c.authorUid] || 0;
        cList.appendChild(renderDetailComment(c, map[c.authorUid], compat));
      });

      // "Load more" button
      if (!showAll && snap.docs.length >= DETAIL_CMT_PAGE) {
        const total = p.commentCount || 0;
        const remaining = total - snap.docs.length;
        const loadMoreBtn = el("button", { class: "load-more-cmts-btn", onclick: () => loadDetailComments(true) },
          el("i", { class: "ri-arrow-down-s-line" }),
          remaining > 0 ? ` View ${remaining} more comment${remaining !== 1 ? "s" : ""}` : " View all comments",
        );
        cList.appendChild(loadMoreBtn);
      }
    });
  };

  loadDetailComments(false);

  // ── Detail comment: media + voice-note state ────────────────
  let _dCmtMediaFile = null;
  let _dCmtAudioBlob = null;
  let _dCmtRecorder  = null;
  let _dCmtRecording = false;

  const dCmtMediaInput = el("input", { type: "file", accept: "image/*,video/*" });
  dCmtMediaInput.style.display = "none";

  const dCmtAttachPreview = el("div", { class: "cmt-attach-preview hidden" });

  const clearDCmtAttach = () => {
    _dCmtMediaFile = null; _dCmtAudioBlob = null;
    dCmtAttachPreview.innerHTML = ""; dCmtAttachPreview.classList.add("hidden");
  };

  const showDCmtMediaPreview = (file) => {
    dCmtAttachPreview.innerHTML = ""; dCmtAttachPreview.classList.remove("hidden");
    const isVideo = file.type.startsWith("video");
    const url = URL.createObjectURL(file);
    const thumb = isVideo
      ? el("video", { src: url, muted: "", preload: "metadata", style: "width:72px;height:72px;object-fit:cover;border-radius:10px;display:block;" })
      : el("img",  { src: url, style: "width:72px;height:72px;object-fit:cover;border-radius:10px;display:block;" });
    const rmBtn = el("button", { type: "button", class: "cmt-attach-remove",
      html: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>` });
    rmBtn.addEventListener("click", clearDCmtAttach);
    dCmtAttachPreview.appendChild(el("div", { class: "cmt-attach-thumb" }, thumb, rmBtn));
  };

  const showDCmtAudioPreview = (blob) => {
    dCmtAttachPreview.innerHTML = ""; dCmtAttachPreview.classList.remove("hidden");
    const url = URL.createObjectURL(blob);
    const audio = el("audio", { src: url, controls: true, style: "height:28px;max-width:160px;" });
    const rmBtn = el("button", { type: "button", class: "cmt-attach-remove",
      html: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>` });
    rmBtn.addEventListener("click", clearDCmtAttach);
    dCmtAttachPreview.appendChild(el("div", { class: "cmt-attach-audio" }, audio, rmBtn));
  };

  dCmtMediaInput.addEventListener("change", (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    _dCmtMediaFile = file; _dCmtAudioBlob = null;
    showDCmtMediaPreview(file); dCmtMediaInput.value = "";
  });

  const dCmtMediaBtn = el("button", {
    type: "button", class: "icon-btn cmt-icon-btn", title: "Add photo or video",
    html: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
  });
  dCmtMediaBtn.addEventListener("click", (e) => { e.stopPropagation(); dCmtMediaInput.click(); });

  const D_SVG_MIC  = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`;
  const D_SVG_STOP = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="3"/></svg>`;
  const dCmtMicBtn = el("button", { type: "button", class: "icon-btn cmt-icon-btn", title: "Record voice note", html: D_SVG_MIC });
  dCmtMicBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (_dCmtRecording) { _dCmtRecorder?.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks = [];
      _dCmtRecorder = new MediaRecorder(stream);
      _dCmtRecorder.ondataavailable = (ev) => { if (ev.data.size > 0) chunks.push(ev.data); };
      _dCmtRecorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        _dCmtAudioBlob = new Blob(chunks, { type: "audio/webm" });
        _dCmtMediaFile = null; _dCmtRecording = false;
        dCmtMicBtn.innerHTML = D_SVG_MIC; dCmtMicBtn.style.color = ""; dCmtMicBtn.classList.remove("recording");
        showDCmtAudioPreview(_dCmtAudioBlob);
      };
      _dCmtRecorder.start(); _dCmtRecording = true;
      dCmtMicBtn.innerHTML = D_SVG_STOP; dCmtMicBtn.style.color = "var(--danger)"; dCmtMicBtn.classList.add("recording");
      clearDCmtAttach();
    } catch { toast("Microphone access denied"); }
  });

  const cForm = el("form", { class: "comment-form detail-cmt-form" });
  cForm.appendChild(dCmtMediaInput);
  cForm.appendChild(dCmtAttachPreview);
  const dFormRow = el("div", { class: "comment-form-row" },
    el("img", { class: "avatar xs", src: avatarFor(state.me), style: "cursor:pointer;", onclick: () => location.hash = `#profile/${state.uid}` }),
    el("input", { type: "text", placeholder: "Write a comment…" }),
    dCmtMediaBtn,
    dCmtMicBtn,
    el("button", { class: "icon-btn", type: "submit" }, el("i", { class: "ri-send-plane-fill" })),
  );
  cForm.appendChild(dFormRow);

  cForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = cForm.querySelector("input");
    const text = input.value.trim();
    if (!text && !_dCmtMediaFile && !_dCmtAudioBlob) return;
    const submitBtn = cForm.querySelector("button[type='submit']");
    submitBtn.disabled = true;
    try {
      const commentData = {
        text: text || "", authorUid: state.uid, createdAt: serverTimestamp(), likes: [],
        ..._detailReplyTo ? { replyToUid: _detailReplyTo.uid, replyToName: _detailReplyTo.name, replyToUsername: _detailReplyTo.username } : {},
      };
      if (_dCmtMediaFile) {
        const kind = _dCmtMediaFile.type.startsWith("video") ? "video" : "image";
        const up = await uploadToCloudinary(_dCmtMediaFile, kind);
        commentData.mediaUrl = up.url; commentData.mediaType = kind;
      } else if (_dCmtAudioBlob) {
        const audioFile = new File([_dCmtAudioBlob], "voice.webm", { type: "audio/webm" });
        const up = await uploadToCloudinary(audioFile, "video");
        commentData.audioUrl = up.url;
      }
      input.value = ""; _detailReplyTo = null;
      detailReplyBanner.classList.add("hidden"); input.placeholder = "Write a comment…";
      clearDCmtAttach(); sfxComment();
      await addDoc(collection(db, "posts", p.id, "comments"), commentData);
      await updateDoc(doc(db, "posts", p.id), { commentCount: increment(1) });
      const notifSnippet = commentData.text ? `"${commentData.text.slice(0, 60)}"` : commentData.mediaType ? "📷 sent a photo" : "🎙️ sent a voice note";
      if (author?.uid && author.uid !== state.uid) {
        writeNotif(author.uid, "comment", { postId: p.id, text: `${state.me?.name || "Someone"} commented: ${notifSnippet}` }).catch(() => {});
        const _thumb = Array.isArray(p.media) ? p.media[0]?.url : p.media?.url;
        import("./notifications.js").then(({ notifyUser }) =>
          notifyUser(author.uid, state.me?.name || "Someone", "commented on your post", "/#post/" + p.id, state.me?.photoURL || "", _thumb || "")
        ).catch(() => {});
      }
      if (commentData.replyToUid && commentData.replyToUid !== state.uid && commentData.replyToUid !== author?.uid) {
        writeNotif(commentData.replyToUid, "commentReply", { postId: p.id, text: `${state.me?.name || "Someone"} replied to your comment: ${notifSnippet}` }).catch(() => {});
        import("./notifications.js").then(({ notifyUser }) =>
          notifyUser(commentData.replyToUid, state.me?.name || "Someone", "replied to your comment", "/#post/" + p.id, state.me?.photoURL || "")
        ).catch(() => {});
      }
    } catch { toast("Failed to send comment"); } finally { submitBtn.disabled = false; }
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

  // ── Hashtag view ────────────────────────────────────────────────────────
  if (hashtagFilter) {
    root.appendChild(el("div", { class: "section-head" },
      el("button", { class: "icon-btn", style: "margin-right:8px;", onclick: () => history.back() },
        el("i", { class: "ri-arrow-left-line" })),
      el("h2", {}, `#${hashtagFilter}`),
    ));
    const grid = el("div", { class: "grid-3" });
    root.appendChild(grid);
    onSnapshot(
      query(collection(db, "posts"), where("hashtags", "array-contains", hashtagFilter.toLowerCase()), limit(60)),
      (snap) => {
        grid.innerHTML = "";
        if (snap.empty) {
          grid.appendChild(el("div", { class: "empty", style: "grid-column:1/-1;" },
            el("i", { class: "ri-hashtag" }),
            el("div", { class: "t" }, `No posts tagged #${hashtagFilter}`)));
          return;
        }
        [...snap.docs]
          .sort((a, b) => (b.data().createdAt?.seconds || 0) - (a.data().createdAt?.seconds || 0))
          .forEach((d) => {
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
            cell.appendChild(el("span", { class: "cell-views" }, el("i", { class: "ri-eye-line" }), " " + String(p.views || 0)));
            grid.appendChild(cell);
          });
      }
    );
    return;
  }

  // ── Full Discover page ───────────────────────────────────────────────────

  // Hero search bar
  const searchHero = el("div", { class: "disc-search-hero" });
  const searchInput = el("input", { type: "text", class: "disc-search-input", placeholder: "Search people, posts, hashtags…" });
  const searchResults = el("div", { class: "disc-search-results hidden" });
  searchHero.appendChild(el("div", { class: "disc-search-box" },
    el("i", { class: "ri-search-2-line" }), searchInput, el("span", { class: "disc-search-kbd" }, "⌘K")
  ));
  searchHero.appendChild(searchResults);
  root.appendChild(searchHero);

  // Search logic (people + hashtags in one list)
  let _debounce = null;
  const _runSearch = async (raw) => {
    const q1 = raw.trim().toLowerCase();
    searchResults.innerHTML = "";
    if (!q1) { searchResults.classList.add("hidden"); return; }
    searchResults.classList.remove("hidden");

    // Hashtag shortcut row
    if (q1.startsWith("#") || /^[a-z]/.test(q1)) {
      const tag = q1.startsWith("#") ? q1.slice(1) : q1;
      searchResults.appendChild(el("div", { class: "dsr-item dsr-tag",
          onclick: () => location.hash = `#explore/${tag}` },
        el("div", { class: "dsr-tag-icon" }, el("i", { class: "ri-hashtag" })),
        el("div", {}, el("div", { class: "dsr-primary" }, `#${tag}`), el("div", { class: "dsr-sub" }, "See all posts"))
      ));
    }

    const snap = await getDocs(query(collection(db, "users"), orderBy("username"), limit(200))).catch(() => null);
    if (!snap) return;
    const matches = snap.docs.map(d => ({ uid: d.id, ...d.data() }))
      .filter(u => u.uid !== state.uid &&
        ((u.name || "").toLowerCase().includes(q1) || (u.username || "").toLowerCase().includes(q1)))
      .slice(0, 8);
    matches.forEach((u) => {
      searchResults.appendChild(el("div", { class: "dsr-item", onclick: () => location.hash = `#profile/${u.uid}` },
        el("img", { class: "dsr-avatar", src: avatarFor(u) }),
        el("div", {},
          el("div", { class: "dsr-primary" }, u.name || "User"),
          el("div", { class: "dsr-sub" }, "@" + (u.username || "user"))
        )
      ));
    });
    if (!matches.length && !q1.startsWith("#")) {
      searchResults.appendChild(el("div", { class: "dsr-empty" }, `No results for "${raw}"`));
    }
  };
  searchInput.addEventListener("input", () => {
    clearTimeout(_debounce);
    _debounce = setTimeout(() => _runSearch(searchInput.value), 220);
  });
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { searchResults.classList.add("hidden"); searchInput.blur(); }
  });
  document.addEventListener("click", (e) => {
    if (!searchHero.contains(e.target)) searchResults.classList.add("hidden");
  });
  // Keyboard shortcut ⌘K / Ctrl+K
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); searchInput.focus(); }
  });

  // Trending hashtag chips
  const tagsSection = el("div", { class: "disc-tags-section" });
  tagsSection.appendChild(el("div", { class: "disc-section-label" },
    el("i", { class: "ri-hashtag" }), "Trending topics"
  ));
  const tagsRow = el("div", { class: "disc-tags-row" });
  tagsSection.appendChild(tagsRow);
  root.appendChild(tagsSection);

  // Pull top hashtags from recent posts client-side
  getDocs(query(collection(db, "posts"), orderBy("createdAt", "desc"), limit(100))).then((snap) => {
    const freq = {};
    snap.docs.forEach(d => {
      (d.data().hashtags || []).forEach(t => { freq[t] = (freq[t] || 0) + 1; });
    });
    const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 14);
    if (!sorted.length) { tagsSection.classList.add("hidden"); return; }
    sorted.forEach(([tag, count]) => {
      tagsRow.appendChild(el("button", {
        class: "disc-tag-chip",
        onclick: () => location.hash = `#explore/${tag}`
      }, `#${tag}`, el("span", { class: "disc-tag-count" }, String(count))));
    });
  }).catch(() => tagsSection.classList.add("hidden"));

  // ── "Matches Your Vibe" compat grid — only shown when taste profile exists
  if (state.me?.tasteAnswers && Object.keys(state.me.tasteAnswers).length) {
    const mvWrap = el("div", { class: "disc-mv-wrap" });
    mvWrap.appendChild(el("div", { class: "disc-section-label disc-mv-label" },
      el("span", { class: "disc-mv-icon" }, "✦"), " Matches Your Vibe"
    ));
    const mvGrid = el("div", { class: "grid-3 disc-mv-grid" });
    const mvEmpty = el("div", { class: "disc-mv-loading" },
      el("i", { class: "ri-loader-4-line", style: "animation:spin 1s linear infinite" }),
    );
    mvGrid.appendChild(mvEmpty);
    mvWrap.appendChild(mvGrid);
    root.appendChild(mvWrap);

    getDocs(query(collection(db, "posts"), orderBy("createdAt", "desc"), limit(80))).then(async (snap) => {
      const posts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const authorUids = [...new Set(posts.map(p => p.authorUid).filter(u => u && u !== state.uid))];
      // Compute compat for up to 30 authors in parallel (session cache makes this cheap)
      const compatMap = {};
      await Promise.all(authorUids.slice(0, 30).map(async uid => {
        compatMap[uid] = await getCompatibility(uid).catch(() => 0);
      }));
      const scored = posts
        .filter(p => p.authorUid !== state.uid && (compatMap[p.authorUid] || 0) >= 30)
        .map(p => ({ p, compat: compatMap[p.authorUid] || 0 }))
        .sort((a, b) => b.compat - a.compat)
        .slice(0, 18);

      mvGrid.innerHTML = "";
      if (!scored.length) { mvWrap.remove(); return; }

      scored.forEach(({ p: post, compat }) => {
        const cell = el("div", { class: "cell mv-cell", onclick: () => location.hash = `#post/${post.id}` });
        const mediaItems = Array.isArray(post.media) ? post.media : (post.media ? [post.media] : []);
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
          cell.appendChild(el("div", { class: "cell-text", text: (post.text || "").slice(0, 80) }));
        }
        if (post.text) cell.appendChild(el("div", { class: "cell-overlay", text: (post.text || "").slice(0, 55) }));
        cell.appendChild(el("span", { class: "cell-compat-badge" }, `✦ ${compat}%`));
        mvGrid.appendChild(cell);
      });
    }).catch(() => mvWrap.remove());
  }

  // Section header: Trending posts
  root.appendChild(el("div", { class: "disc-section-label disc-trending-label" },
    el("i", { class: "ri-fire-fill" }), "Trending right now"
  ));

  // Post grid — sorted by engagement score (orbits + likes + views)
  const grid = el("div", { class: "grid-3" });
  root.appendChild(grid);

  onSnapshot(
    query(collection(db, "posts"), orderBy("orbitCount", "desc"), limit(60)),
    (snap) => {
      grid.innerHTML = "";
      if (snap.empty) {
        grid.appendChild(el("div", { class: "empty", style: "grid-column:1/-1;" },
          el("i", { class: "ri-compass-3-line" }),
          el("div", { class: "t" }, "Nothing trending yet"),
          el("div", {}, "Be the first to post something amazing.")));
        return;
      }
      // Composite score: orbits ×3 + likes ×2 + views ×0.1 + recency boost
      const now = Date.now() / 1000;
      const docs = [...snap.docs].sort((a, b) => {
        const score = (d) => {
          const data = d.data();
          const age = now - (data.createdAt?.seconds || now);
          const recency = Math.exp(-age / (60 * 60 * 48)); // 48h half-life
          return (data.orbitCount || 0) * 3 + (data.likes?.length || 0) * 2 + (data.views || 0) * 0.1 + recency * 10;
        };
        return score(b) - score(a);
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
        const eng = (p.orbitCount || 0) + (p.likes?.length || 0);
        cell.appendChild(el("span", { class: "cell-views" },
          eng > 0
            ? [el("i", { class: "ri-fire-fill", style: "color:var(--grad-1)" }), ` ${eng}`]
            : [el("i", { class: "ri-eye-line" }), ` ${p.views || 0}`]
        ));
        grid.appendChild(cell);
      });
    }
  );

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
    posts.forEach((p) => list.appendChild(renderPost(p, map[p.authorUid], { hideComments: true })));
  });
};

// =========================================================================
// 12. PROFILE
// =========================================================================
// Activity picker — current activity status on profile
// =========================================================================
const ACTIVITY_PRESETS = [
  { emoji: "📖", label: "Reading" },
  { emoji: "🎵", label: "Listening to music" },
  { emoji: "☕", label: "Having coffee" },
  { emoji: "💻", label: "Coding" },
  { emoji: "🏋️", label: "Working out" },
  { emoji: "🎮", label: "Gaming" },
  { emoji: "🍳", label: "Cooking" },
  { emoji: "✈️", label: "Travelling" },
  { emoji: "🧘", label: "Meditating" },
  { emoji: "🎨", label: "Creating" },
  { emoji: "😴", label: "Resting" },
  { emoji: "🌿", label: "In nature" },
];

const openActivityPicker = (u) => {
  const overlay = el("div", { class: "modal activity-picker-modal", style: "z-index:1100;" });
  const card = el("div", { class: "modal-card", style: "max-width:380px;" });
  card.appendChild(el("div", { class: "modal-head" },
    el("h3", {}, "What are you doing?"),
    el("button", { class: "icon-btn", onclick: () => overlay.remove() }, el("i", { class: "ri-close-line" }))
  ));
  const grid = el("div", { style: "display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:16px;" });
  ACTIVITY_PRESETS.forEach((act) => {
    const btn = el("button", { class: `activity-option${(u.currentActivity?.label === act.label) ? " active" : ""}` });
    btn.appendChild(el("span", { style: "font-size:22px;display:block;margin-bottom:4px;" }, act.emoji));
    btn.appendChild(el("span", { style: "font-size:11px;font-weight:600;color:var(--text-dim);" }, act.label));
    btn.addEventListener("click", async () => {
      await updateDoc(doc(db, "users", state.uid), { currentActivity: act });
      if (state.me) state.me.currentActivity = act;
      toast("Activity updated!");
      overlay.remove();
      state.cache.users.delete(state.uid);
      router();
    });
    grid.appendChild(btn);
  });
  const clearBtn = el("button", { class: "btn ghost block", style: "margin:0 16px 16px;" });
  clearBtn.textContent = "Clear activity";
  clearBtn.addEventListener("click", async () => {
    await updateDoc(doc(db, "users", state.uid), { currentActivity: null });
    if (state.me) state.me.currentActivity = null;
    toast("Activity cleared");
    overlay.remove();
    state.cache.users.delete(state.uid);
    router();
  });
  card.appendChild(grid);
  card.appendChild(clearBtn);
  overlay.appendChild(card);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
};

// =========================================================================
// Tracks the live listener for whichever profile tab (Posts / Media) is
// currently rendered, so posting or switching tabs never leaves a stale
// listener running and the visible tab always reflects Firestore live.
let _profileTabUnsub = null;

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
  let _iFollow = (state.me.following || []).includes(uid);

  // Live-update follower count in-place — no full page re-render on follow/unfollow
  const followersCountEl = el("strong", {}, String((u.followers || []).length));

  let profileFollowBtn = null;
  if (!isMe) {
    profileFollowBtn = el("button", { class: `btn ${_iFollow ? "ghost" : "primary"}` }, _iFollow ? "Following" : "Follow");
    profileFollowBtn.addEventListener("click", async () => {
      const prev = _iFollow;
      _iFollow = !_iFollow;
      profileFollowBtn.textContent = _iFollow ? "Following" : "Follow";
      profileFollowBtn.className = `btn ${_iFollow ? "ghost" : "primary"}`;
      const curCount = parseInt(followersCountEl.textContent) || 0;
      followersCountEl.textContent = String(Math.max(0, curCount + (_iFollow ? 1 : -1)));
      const meRef = doc(db, "users", state.uid);
      const themRef = doc(db, "users", uid);
      const batch = writeBatch(db);
      if (_iFollow) {
        batch.update(meRef, { following: arrayUnion(uid) });
        batch.update(themRef, { followers: arrayUnion(state.uid) });
      } else {
        batch.update(meRef, { following: arrayRemove(uid) });
        batch.update(themRef, { followers: arrayRemove(state.uid) });
      }
      await batch.commit().catch(() => {
        // Revert optimistic update on failure
        _iFollow = prev;
        profileFollowBtn.textContent = _iFollow ? "Following" : "Follow";
        profileFollowBtn.className = `btn ${_iFollow ? "ghost" : "primary"}`;
        followersCountEl.textContent = String(curCount);
        toast("Failed to update follow status");
      });
      state.cache.users.delete(uid);
      state.cache.users.delete(state.uid);
      if (state.me) {
        state.me.following = _iFollow
          ? [...new Set([...(state.me.following || []), uid])]
          : (state.me.following || []).filter((x) => x !== uid);
      }
      if (_iFollow) {
        writeNotif(uid, "follow", {}).catch(() => {});
        import("./notifications.js").then(({ notifyUser }) =>
          notifyUser(uid, state.me?.name || "Someone", "started following you", "/#profile/" + state.uid, state.me?.photoURL || "")
        ).catch(() => {});
      }
    });
  }

  root.appendChild(el("div", { class: "profile-head" },
    el("img", { class: "avatar xl", src: avatarFor(u) }),
    el("div", {},
      el("div", { class: "name-row" }, u.name,
        u.verified ? el("span", { class: "verified lg", title: "Location verified", html: '<i class="ri-check-line"></i>' }) : null),
      el("div", { class: "uname" }, "@" + u.username),
      (u.streakCount && u.streakCount > 0) ? el("div", { class: "streak-badge" }, `🔥 ${u.streakCount} day${u.streakCount !== 1 ? "s" : ""} streak`) : null,
      el("div", { class: `activity-chip${isMe ? " tappable" : ""}`,
        onclick: isMe ? () => openActivityPicker(u) : undefined },
        u.currentActivity
          ? `${u.currentActivity.emoji} ${u.currentActivity.label}`
          : (isMe ? "＋ Set activity" : null)
      ),
      el("div", { class: "stats" },
        el("div", { class: "stat" }, followersCountEl, el("span", {}, "followers")),
        el("div", { class: "stat" }, el("strong", {}, String((u.following || []).length)), el("span", {}, "following")),
      ),
      u.bio ? el("div", { class: "bio", text: u.bio }) : null,
      el("div", { class: "profile-actions" },
        isMe
          ? el("button", { class: "btn ghost", onclick: () => openProfileEditModal() }, el("i", { class: "ri-edit-line" }), "Edit profile")
          : profileFollowBtn,
        !isMe ? el("button", { class: "btn ghost", onclick: () => location.hash = `#chats/${uid}` },
          el("i", { class: "ri-chat-3-line" }), "Message") : null,
        isMe && !u.verified ? el("button", { class: "btn ghost", onclick: requestLocationVerification },
          el("i", { class: "ri-shield-check-line" }), "Get verified") : null,
      ),
    ),
  ));

  // Academy badges — visible to all users who earned them
  const academySection = el("div", { class: "profile-academy-section" });
  root.appendChild(academySection);
  import("./features.js").then((m) => {
    m.renderLearnBadges(academySection, uid);
  }).catch(() => {});

  // Tabs: Posts | Media | About | Mutuals
  const tabs = el("div", { class: "profile-tabs" },
    el("button", { class: "profile-tab active", "data-ptab": "posts" }, "Posts"),
    el("button", { class: "profile-tab", "data-ptab": "media" }, "Media"),
    el("button", { class: "profile-tab", "data-ptab": "about" }, "About"),
    el("button", { class: "profile-tab", "data-ptab": "mutuals" },
      el("i", { class: "ri-team-line" }), " Mutuals"),
  );
  root.appendChild(tabs);
  const body = el("div", {});
  root.appendChild(body);

  const renderTab = async (which) => {
    // Kill any live listener from the previously active tab (Posts/Media)
    // before switching, so we never have two snapshot listeners fighting
    // over the same `body` element.
    if (_profileTabUnsub) { _profileTabUnsub(); _profileTabUnsub = null; }

    body.innerHTML = "";
    body.appendChild(el("div", { class: "empty" },
      el("i", { class: "ri-loader-4-line", style: "animation:spin 1s linear infinite;" }),
      el("div", { class: "t" }, "Loading…")));

    if (which === "posts") {
      // Live listener — any post created, edited, or deleted by this user
      // reflects on their profile immediately, without needing to leave
      // and re-enter the page.
      _profileTabUnsub = onSnapshot(
        query(collection(db, "posts"), where("authorUid", "==", uid), limit(60)),
        (snap) => {
          body.innerHTML = "";
          if (snap.empty) {
            body.appendChild(el("div", { class: "empty" }, el("i", { class: "ri-image-line" }), el("div", { class: "t" }, "No posts yet")));
            return;
          }
          const posts = snap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

          const profFeed = el("div", { class: "profile-feed-list" }); body.appendChild(profFeed);
          posts.forEach((p) => profFeed.appendChild(renderPost(p, u)));
        },
        () => {}
      );

    } else if (which === "media") {
      // Show all posts that have media (images or videos) in a grid — also live
      _profileTabUnsub = onSnapshot(
        query(collection(db, "posts"), where("authorUid", "==", uid), limit(60)),
        (snap) => {
          body.innerHTML = "";
          if (snap.empty) {
            body.appendChild(el("div", { class: "empty" }, el("i", { class: "ri-image-line" }), el("div", { class: "t" }, "No media yet")));
            return;
          }
          const posts = snap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .filter((p) => p.media && (Array.isArray(p.media) ? p.media.length > 0 : true))
            .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

          if (!posts.length) {
            body.appendChild(el("div", { class: "empty" }, el("i", { class: "ri-image-line" }), el("div", { class: "t" }, "No media yet")));
            return;
          }
          const grid = el("div", { class: "grid-3 portrait-grid" }); body.appendChild(grid);
          posts.forEach((p) => {
            const mediaItems = Array.isArray(p.media) ? p.media : (p.media ? [p.media] : []);
            if (!mediaItems.length) return;
            const m = mediaItems[0];
            const cell = el("div", { class: "cell portrait-cell", onclick: () => location.hash = `#post/${p.id}` });
            if (m.type === "video") {
              cell.appendChild(el("video", { src: m.url, muted: "", playsinline: "", preload: "metadata" }));
              cell.appendChild(el("span", { class: "cell-badge" }, el("i", { class: "ri-play-fill" })));
            } else {
              cell.appendChild(el("img", { src: m.url, loading: "lazy" }));
              if (mediaItems.length > 1) cell.appendChild(el("span", { class: "cell-badge" }, el("i", { class: "ri-image-2-line" })));
            }
            grid.appendChild(cell);
          });
        },
        () => {}
      );

    } else if (which === "about") {
      body.innerHTML = "";
      const aboutWrap = el("div", { class: "settings" },
        el("div", { class: "group" },
          el("h3", {}, "About"),
          el("div", { class: "row" }, el("div", { class: "label" }, el("div", { class: "t" }, "Joined"), el("div", { class: "d" }, fmtTime(u.createdAt) || "—"))),
          u.location ? el("div", { class: "row" }, el("div", { class: "label" }, el("div", { class: "t" }, "Verified location"), el("div", { class: "d" }, u.location.city || `${u.location.lat?.toFixed(2)}, ${u.location.lng?.toFixed(2)}`))) : null,
          el("div", { class: "row" }, el("div", { class: "label" }, el("div", { class: "t" }, "Status"), el("div", { class: "d" }, u.online ? "Online now" : `Last seen ${fmtTime(u.lastSeen)}`))),
        ),
      );
      // ── Taste profile answers ─────────────────────────────────────────────
      if (u.tasteAnswers && Object.keys(u.tasteAnswers).length) {
        const tasteSection = el("div", { class: "taste-about-section" },
          el("div", { class: "taste-about-title" }, el("i", { class: "ri-sparkling-2-fill" }), " Taste Profile"),
        );
        TASTE_QUESTIONS.forEach((q) => {
          const answers = u.tasteAnswers[q.id];
          if (!answers || !answers.length) return;
          tasteSection.appendChild(el("div", { class: "taste-about-group" },
            el("div", { class: "taste-about-label" }, q.q),
            el("div", { class: "taste-about-chips" },
              ...answers.map((a) => el("span", { class: "taste-about-chip" }, a))
            ),
          ));
        });
        aboutWrap.appendChild(tasteSection);
      }
      body.appendChild(aboutWrap);
    } else if (which === "mutuals") {
      body.innerHTML = "";
      const mutualsWrap = el("div", { style: "padding: 0 0 16px;" });
      body.appendChild(mutualsWrap);
      renderMutuals(mutualsWrap, false);
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
            : "Allow Vibe to read your location once. We only store an approximate area, never live tracking."),

            // Taste quiz button in settings
            el("div", { class: "settings-row" },
              el("div", { class: "settings-row-label" },
                el("i", { class: "ri-heart-3-line", style: "color:var(--grad-1);" }),
                el("div", {},
                  el("div", { class: "settings-row-title" }, "Taste Profile"),
                  el("div", { class: "settings-row-sub" }, state.me?.tasteAnswers ? "Edit your taste matches" : "Set up compatibility matching"),
                ),
              ),
              el("button", { class: "btn sm primary", onclick: () => openTasteProfileSheet() }, "Open"),
            ),
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
          el("div", { class: "d" }, "Get pings for new messages and Vibes.")),
        el("button", { class: "btn ghost", onclick: async () => {
          const p = await Notification.requestPermission();
          toast(p === "granted" ? "Notifications enabled" : "Notifications denied");
        }}, "Enable"),
      ),
      el("div", { class: "row" },
        el("div", { class: "label" },
          el("div", { class: "t" }, "Test group notification"),
          el("div", { class: "d" }, "Send yourself a test push notification for a group message.")),
        el("button", { class: "btn ghost", onclick: () => {
          import("./notifications.js").then((m) => m.sendTestGroupNotification());
        }}, "Send test"),
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
// 14. COMPOSE MODAL — posts, groups, build, project
// =========================================================================
const composeModal = $("#composeModal");
const openCompose = (which = "group") => {
  if ((which === "build" || which === "project") && !state.me?.isPro) {
    import("./features.js").then((m) => m.showGoProModal()).catch(() => {});
    return;
  }
  composeModal.classList.remove("hidden");
  $$(".ct").forEach((b) => b.classList.toggle("active", b.dataset.ctab === which));
  $$(".compose-pane").forEach((p) => p.classList.toggle("hidden", !p.id.startsWith(which)));
};
// "Post" now opens the dedicated full-page creation studio (see section 14c)
// instead of the group/build/project modal above.
$("#composeBtn")?.addEventListener("click", () => openCreatePost());
$("#composeBtnMobile")?.addEventListener("click", () => openCreatePost());
$$(".ct").forEach((b) => b.addEventListener("click", () => openCompose(b.dataset.ctab)));

document.addEventListener("click", (e) => {
  if (e.target.matches("[data-close-modal]") || e.target.closest("[data-close-modal]")) {
    composeModal.classList.add("hidden");
  }
  if (e.target.matches("[data-close-drawer]") || e.target.closest("[data-close-drawer]")) {
    $("#chatCustomize").classList.add("hidden");
  }
});

// Plain image/video posts are now created via the dedicated full-page
// studio (openCreatePost, section 14c below) instead of a modal form.

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
// 14c. CREATE-POST STUDIO — dedicated full-page flow for image/video posts:
// pick or record media, add text/sticker overlays, attach a song, write a
// caption, then publish. Replaces the old "Post" tab in the compose modal.
// =========================================================================

// Music search uses the Internet Archive's public catalog — no API key,
// signup, or billing required (see crSearchMusic below).
const CR_STICKERS = ["🔥","❤️","⭐","👍","🎉","😂","💯","✨","🙌","😍","👏","🥳","😎","💜","🎶","⚡"];
const CR_TEXT_COLORS = ["#ffffff","#000000","#ff5c7a","#ffb04a","#3fdca0","#5cd3ff","#e63950","#ff5cae"];

let crState = null;
const _crFreshState = () => ({
  step: "pick",           // pick | cam | editor | music | details
  slides: [],             // [{ type:'image'|'video', file, url, overlays:[] }]
  song: null,             // { id, name, artist, url, duration }
  caption: "",
  location: null,
  activeSlide: 0,
  selectedLayerId: null,
  camStream: null,
  camRecorder: null,
  camChunks: [],
  camTimer: null,
  camFacing: "user",      // "user" | "environment"
  camAudio: null,         // audio-only MediaStream kept separate from preview
  isRecordedVideo: false, // true only when video was recorded inside the app
});

const crLayerId = () => "l" + Math.random().toString(36).slice(2, 9);

function openCreatePost() {
  if (crState) return; // already open
  _pauseAllMedia(); // don't let a background post's video/song keep playing under the studio
  crState = _crFreshState();
  const root = el("div", { class: "cr-root", id: "crRoot" });
  document.body.appendChild(root);
  crRenderShell(root);
  crGoto("pick");
}

function crClose() {
  if (!crState) return;
  crStopCamera();
  crStopPreview();
  // Editor previews (looping muted video slides) don't route through the
  // feed's media registry, so stop them explicitly on close.
  $("#crRoot")?.querySelectorAll("video, audio").forEach((m) => { try { m.pause(); } catch {} });
  crState.slides.forEach((s) => { try { URL.revokeObjectURL(s.url); } catch {} });
  crState = null;
  $("#crRoot")?.remove();
}

let _crShellRefs = null;
function crRenderShell(root) {
  const closeBtn = el("button", { class: "cr-head-close", onclick: () => crClose() }, el("i", { class: "ri-close-line" }));
  const backBtn = el("button", { class: "cr-head-close", style: "display:none;", onclick: () => crBack() }, el("i", { class: "ri-arrow-left-line" }));
  const title = el("div", { class: "cr-head-title", text: "New post" });
  const nextBtn = el("button", { class: "cr-head-btn primary", style: "display:none;" }, "Next");
  const head = el("div", { class: "cr-head" }, el("div", { style: "display:flex;align-items:center;gap:8px;" }, backBtn, closeBtn), title, nextBtn);
  const stepsWrap = el("div", { class: "cr-steps" });
  root.appendChild(head);
  root.appendChild(stepsWrap);
  _crShellRefs = { head, backBtn, closeBtn, title, nextBtn, stepsWrap };
}

function crBack() {
  // Music step only applies when a video was recorded in-app
  const order = crState.isRecordedVideo
    ? ["pick", "editor", "music", "details"]
    : ["pick", "editor", "details"];
  if (crState.step === "cam") { crStopCamera(); crGoto("pick"); return; }
  const idx = order.indexOf(crState.step);
  if (idx <= 0) { crClose(); return; }
  crGoto(order[idx - 1]);
}

function crGoto(step) {
  crState.step = step;
  const { stepsWrap, backBtn, nextBtn, title } = _crShellRefs;
  stepsWrap.innerHTML = "";
  backBtn.style.display = step === "pick" ? "none" : "";
  nextBtn.style.display = "none";
  if (step === "pick") { title.textContent = "New post"; stepsWrap.appendChild(crBuildPickStep()); }
  else if (step === "cam") { title.textContent = "Record video"; stepsWrap.appendChild(crBuildCamStep()); }
  else if (step === "editor") {
    title.textContent = "Edit";
    stepsWrap.appendChild(crBuildEditorStep());
    nextBtn.style.display = ""; nextBtn.textContent = "Next"; nextBtn.onclick = () => crState.isRecordedVideo ? crGoto("music") : crGoto("details");
  } else if (step === "music") {
    title.textContent = "Add music";
    stepsWrap.appendChild(crBuildMusicStep());
    nextBtn.style.display = ""; nextBtn.textContent = "Next"; nextBtn.onclick = () => crGoto("details");
  } else if (step === "details") {
    title.textContent = "Share";
    stepsWrap.appendChild(crBuildDetailsStep());
    nextBtn.style.display = ""; nextBtn.textContent = "Post"; nextBtn.onclick = () => crSubmitPost(nextBtn);
  }
}

// ---------------- Step 1: pick media ----------------
function crBuildPickStep() {
  const fileInput = el("input", { type: "file", accept: "image/*,video/*", multiple: true, hidden: true });
  fileInput.addEventListener("change", (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    // Uploaded media is never "recorded in-app" — always reset the flag so
    // the music step is correctly skipped for gallery picks and image sets.
    crState.isRecordedVideo = false;
    const hasVideo = files.some((f) => f.type.startsWith("video/"));
    if (hasVideo) {
      const f = files.find((f) => f.type.startsWith("video/"));
      crState.slides = [{ type: "video", file: f, url: URL.createObjectURL(f), overlays: [] }];
    } else {
      crState.slides = files.slice(0, 10).map((f) => ({ type: "image", file: f, url: URL.createObjectURL(f), overlays: [] }));
    }
    crState.activeSlide = 0;
    crGoto("editor");
  });
  const step = el("div", { class: "cr-step active" },
    el("div", { class: "cr-pick" },
      el("div", { class: "cr-pick-title" }, "Create a post"),
      el("div", { class: "cr-pick-sub" }, "Photos, a video, or a carousel — add text, stickers and a song next."),
      el("div", { class: "cr-pick-grid" },
        el("button", { class: "cr-pick-opt", onclick: () => fileInput.click() },
          el("i", { class: "ri-image-add-line" }), el("span", {}, "Photos / video")),
        el("button", { class: "cr-pick-opt", onclick: () => crGoto("cam") },
          el("i", { class: "ri-camera-line" }), el("span", {}, "Record video")),
      ),
      el("div", { class: "cr-pick-hint" }, "Pick multiple photos to make a swipeable carousel."),
      fileInput,
    ),
  );
  return step;
}

// ---------------- Camera recording ----------------
function crStopCamera() {
  if (crState?.camTimer) { clearInterval(crState.camTimer); crState.camTimer = null; }
  if (crState?.camRecorder && crState.camRecorder.state !== "inactive") { try { crState.camRecorder.stop(); } catch {} }
  if (crState?.camStream) { crState.camStream.getTracks().forEach((t) => t.stop()); crState.camStream = null; }
  // Stop the separate audio stream too — it holds the mic open otherwise
  if (crState?.camAudio) { crState.camAudio.getTracks().forEach((t) => t.stop()); crState.camAudio = null; }
}

function crBuildCamStep() {
  const video = el("video", { autoplay: true, playsinline: true });
  // The preview element must NEVER carry audio tracks.
  // Setting srcObject to a video-only stream (see startStream below) is the
  // only reliable way to prevent mic → speaker → mic feedback on mobile.
  // Setting these properties is a belt-and-suspenders backup.
  video.muted  = true;
  video.volume = 0;

  const timer   = el("div", { class: "cr-cam-timer" }, el("span", { class: "dot" }), el("span", { class: "t" }, "0:00"));
  const recBtn  = el("button", { class: "cr-rec-btn" });
  const flipBtn = el("button", { class: "cr-cam-flip", title: "Switch camera" }, el("i", { class: "ri-camera-switch-line" }));
  const cam = el("div", { class: "cr-cam" },
    video, timer,
    el("button", { class: "cr-cam-close", onclick: () => { crStopCamera(); crGoto("pick"); } }, el("i", { class: "ri-close-line" })),
    flipBtn,
    el("div", { class: "cr-cam-bar" }, recBtn),
  );
  const step = el("div", { class: "cr-step active" }, cam);

  // crState.camStream  → video-only stream shown in the preview element
  // crState.camAudio   → audio-only stream (mic) kept separate
  // MediaRecorder combines both — the preview element never has audio tracks,
  // which is the root cause of the screeching feedback loop.

  const startStream = (facing, { isFlip = false } = {}) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      toast("Camera not available on this device");
      if (!isFlip) crGoto("pick");
      return;
    }
    // Request video and audio as separate streams so the preview element
    // only ever receives video tracks (zero chance of audio feedback).
    //
    // For flips we use { exact: facing } so the browser is FORCED to return
    // the other physical camera.  Without "exact", facingMode is treated as a
    // preference hint and many mobile browsers simply return the already-open
    // front camera, making the flip button appear to do nothing.
    // If the device only has one camera, the { exact } request will reject;
    // we then fall back to a non-exact request so at least the stream stays live.
    const videoConstraint = isFlip
      ? { facingMode: { exact: facing } }
      : { facingMode: facing };

    const getVideoStream = () =>
      navigator.mediaDevices.getUserMedia({ video: videoConstraint })
        .catch((err) => {
          if (isFlip && (err.name === "OverconstrainedError" || err.name === "NotFoundError")) {
            // Device likely has only one camera — try without exact
            return navigator.mediaDevices.getUserMedia({ video: { facingMode: facing } });
          }
          return Promise.reject(err);
        });

    Promise.all([
      getVideoStream(),
      // Reuse the existing audio stream when just flipping the camera so the
      // user doesn't get a second microphone permission prompt.
      crState.camAudio
        ? Promise.resolve(crState.camAudio)
        : navigator.mediaDevices.getUserMedia({ audio: true }),
    ]).then(([videoStream, audioStream]) => {
      // Safe to stop the old video stream now that the new one is ready
      if (crState.camStream) crState.camStream.getTracks().forEach((t) => t.stop());
      crState.camStream = videoStream;
      crState.camAudio  = audioStream;

      // Preview element gets video-only — no audio track ever touches it
      video.srcObject = videoStream;
      video.muted     = true;
      video.volume    = 0;
    }).catch(() => {
      if (isFlip) {
        crState.camFacing = crState.camFacing === "user" ? "environment" : "user";
        toast("Couldn't switch camera — your device may only have one");
      } else {
        toast("Camera or microphone access denied");
        crGoto("pick");
      }
    });
  };

  startStream(crState.camFacing || "user");

  // Flip between front and back — blocked while recording is active
  flipBtn.addEventListener("click", () => {
    if (crState.camRecorder?.state === "recording") { toast("Stop recording before switching camera"); return; }
    crState.camFacing = crState.camFacing === "user" ? "environment" : "user";
    startStream(crState.camFacing, { isFlip: true });
  });

  let seconds = 0;
  recBtn.addEventListener("click", () => {
    if (!crState.camStream) return;
    if (!crState.camRecorder || crState.camRecorder.state === "inactive") {
      crState.camChunks = [];
      const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus") ? "video/webm;codecs=vp9,opus" : "video/webm";
      // Combine the video-only preview stream with the separate audio stream
      // so the recording has both tracks but the preview element stays silent.
      const recTracks = [
        ...crState.camStream.getVideoTracks(),
        ...(crState.camAudio ? crState.camAudio.getAudioTracks() : []),
      ];
      const rec = new MediaRecorder(new MediaStream(recTracks), { mimeType: mime });
      rec.ondataavailable = (ev) => { if (ev.data.size) crState.camChunks.push(ev.data); };
      rec.onstop = () => {
        const blob = new Blob(crState.camChunks, { type: "video/webm" });
        const file = new File([blob], `orbit-recording-${Date.now()}.webm`, { type: "video/webm" });
        crState.slides = [{ type: "video", file, url: URL.createObjectURL(file), overlays: [] }];
        crState.activeSlide = 0;
        crState.isRecordedVideo = true; // mark as recorded — enables music step
        crStopCamera();
        crGoto("editor");
      };
      rec.start();
      crState.camRecorder = rec;
      recBtn.classList.add("recording");
      seconds = 0; timer.classList.add("show");
      crState.camTimer = setInterval(() => {
        seconds++;
        timer.querySelector(".t").textContent = `0:${String(seconds).padStart(2, "0")}`;
        if (seconds >= 60) recBtn.click(); // 60s cap
      }, 1000);
    } else {
      recBtn.classList.remove("recording");
      timer.classList.remove("show");
      if (crState.camTimer) { clearInterval(crState.camTimer); crState.camTimer = null; }
      crState.camRecorder.stop();
    }
  });
  return step;
}

// ---------------- Step 2: overlay editor ----------------
function crFontPx(ov, stageWidth) { return stageWidth * ((ov.sizePct * ov.scale) / 100); }

function crBuildEditorStep() {
  const stage = el("div", { class: "cr-stage" });
  const overlayLayer = el("div", { class: "cr-overlay-layer" });
  const dotsNav = el("div", { class: "cr-slides-nav" });
  const thumbstrip = el("div", { class: "cr-stage-thumbstrip" });
  const layerControls = el("div", { class: "cr-layer-controls" });
  const stickerPanel = el("div", { class: "cr-sticker-panel", style: "display:none;" });

  const step = el("div", { class: "cr-step active" },
    el("div", { class: "cr-editor" },
      crState.slides.length > 1 ? dotsNav : null,
      el("div", { class: "cr-stage-wrap" }, stage),
      crState.slides.length > 1 || crState.slides[0]?.type === "image" ? thumbstrip : null,
      stickerPanel,
      layerControls,
      el("div", { class: "cr-editor-toolbar" },
        el("button", { class: "cr-tool-btn", onclick: () => crAddTextLayer(stage, overlayLayer) }, el("i", { class: "ri-text" }), "Text"),
        el("button", { class: "cr-tool-btn", onclick: () => { stickerPanel.style.display = stickerPanel.style.display === "none" ? "flex" : "none"; } }, el("i", { class: "ri-emotion-happy-line" }), "Sticker"),
        crState.slides[0]?.type === "image" ? el("button", { class: "cr-tool-btn", onclick: () => crAddMoreImages() }, el("i", { class: "ri-add-circle-line" }), "Add photo") : null,
      ),
    ),
  );

  CR_STICKERS.forEach((emo) => {
    stickerPanel.appendChild(el("button", { class: "cr-sticker-opt", onclick: () => { crAddStickerLayer(stage, overlayLayer, emo); stickerPanel.style.display = "none"; } }, emo));
  });

  function paintDots() {
    dotsNav.innerHTML = "";
    crState.slides.forEach((_, i) => dotsNav.appendChild(el("div", { class: "cr-slide-dot" + (i === crState.activeSlide ? " active" : "") })));
  }
  function paintThumbs() {
    thumbstrip.innerHTML = "";
    crState.slides.forEach((s, i) => {
      const t = s.type === "video"
        ? el("video", { src: s.url, class: "cr-stage-thumb" + (i === crState.activeSlide ? " active" : ""), muted: true })
        : el("img", { src: s.url, class: "cr-stage-thumb" + (i === crState.activeSlide ? " active" : "") });
      t.addEventListener("click", () => { crState.activeSlide = i; crState.selectedLayerId = null; paintStage(); });
      thumbstrip.appendChild(t);
    });
    if (crState.slides[0]?.type === "image" && crState.slides.length < 10) {
      thumbstrip.appendChild(el("div", { class: "cr-stage-thumb-add", onclick: () => crAddMoreImages() }, el("i", { class: "ri-add-line" })));
    }
  }
  function paintLayerControls() {
    const slide = crState.slides[crState.activeSlide];
    const ov = slide.overlays.find((o) => o.id === crState.selectedLayerId);
    layerControls.innerHTML = "";
    if (!ov) { layerControls.classList.remove("show"); return; }
    layerControls.classList.add("show");
    const sizeInput = el("input", { type: "range", min: "40", max: "260", value: String(Math.round(ov.scale * 100)) });
    sizeInput.addEventListener("input", () => { ov.scale = Number(sizeInput.value) / 100; paintStage(); });
    const rotInput = el("input", { type: "range", min: "-180", max: "180", value: String(ov.rotation) });
    rotInput.addEventListener("input", () => { ov.rotation = Number(rotInput.value); paintStage(); });
    layerControls.appendChild(el("label", {}, "Size", sizeInput));
    layerControls.appendChild(el("label", {}, "Rotate", rotInput));
    if (ov.type === "text") {
      const colorInput = el("input", { type: "color", value: ov.color });
      colorInput.addEventListener("input", () => { ov.color = colorInput.value; paintStage(); });
      layerControls.appendChild(colorInput);
    }
    layerControls.appendChild(el("button", { class: "icon-btn", onclick: () => {
      slide.overlays = slide.overlays.filter((o) => o.id !== ov.id);
      crState.selectedLayerId = null;
      paintStage();
    } }, el("i", { class: "ri-delete-bin-line" })));
  }

  function paintStage() {
    stage.innerHTML = "";
    const slide = crState.slides[crState.activeSlide];
    const media = slide.type === "video"
      ? el("video", { src: slide.url, muted: true, loop: true, autoplay: true, playsinline: true })
      : el("img", { src: slide.url });
    stage.appendChild(media);
    stage.appendChild(overlayLayer);
    overlayLayer.innerHTML = "";
    const rect = () => stage.getBoundingClientRect();
    slide.overlays.forEach((ov) => {
      // Note: the layer's scale is already baked into its px font-size below
      // (via crFontPx), so the CSS transform only handles position + rotation.
      const layer = el("div", {
        class: `cr-layer ${ov.type}` + (ov.id === crState.selectedLayerId ? " selected" : ""),
        style: `left:${ov.x}%;top:${ov.y}%;transform:translate(-50%,-50%) rotate(${ov.rotation}deg);` +
          (ov.type === "text" ? `color:${ov.color};` : ""),
      },
        ov.type === "text" ? el("span", { text: ov.text, contenteditable: false }) : ov.icon,
        el("button", { class: "cr-layer-del", onclick: (e) => { e.stopPropagation(); slide.overlays = slide.overlays.filter((o) => o.id !== ov.id); crState.selectedLayerId = null; paintStage(); } }, el("i", { class: "ri-close-line" })),
      );
      layer.style.fontSize = crFontPx(ov, rect().width || 320) + "px";

      // Track drag vs tap: a movement < 6px in either axis is treated as a tap
      let dragging = false, moved = false, sx = 0, sy = 0, ox = 0, oy = 0;
      layer.addEventListener("pointerdown", (e) => {
        crState.selectedLayerId = ov.id;
        paintLayerControls();
        $$(".cr-layer", overlayLayer).forEach((l) => l.classList.remove("selected"));
        layer.classList.add("selected");
        dragging = true; moved = false;
        sx = e.clientX; sy = e.clientY; ox = ov.x; oy = ov.y;
        layer.setPointerCapture(e.pointerId);
      });
      layer.addEventListener("pointermove", (e) => {
        if (!dragging) return;
        if (Math.abs(e.clientX - sx) > 6 || Math.abs(e.clientY - sy) > 6) moved = true;
        if (!moved) return; // ignore sub-threshold micro-jitter
        const r = rect();
        ov.x = Math.min(96, Math.max(4, ox + ((e.clientX - sx) / r.width) * 100));
        ov.y = Math.min(96, Math.max(4, oy + ((e.clientY - sy) / r.height) * 100));
        layer.style.left = ov.x + "%"; layer.style.top = ov.y + "%";
      });
      layer.addEventListener("pointerup", () => {
        // Single tap (no real movement) on a text layer → open inline editor
        if (!moved && ov.type === "text") {
          const span = layer.querySelector("span");
          span.contentEditable = "true";
          span.focus();
          try { const sel = getSelection(); sel.selectAllChildren(span); } catch {}
          span.addEventListener("blur", () => {
            ov.text = span.textContent.trim() || "Tap to edit";
            span.contentEditable = "false";
            span.textContent = ov.text;
          }, { once: true });
        }
        dragging = false;
      });
      overlayLayer.appendChild(layer);
    });
    paintDots(); paintThumbs(); paintLayerControls();
  }

  crAddMoreImages = () => {
    const input = el("input", { type: "file", accept: "image/*", multiple: true, hidden: true });
    input.addEventListener("change", (e) => {
      const files = Array.from(e.target.files || []).slice(0, 10 - crState.slides.length);
      files.forEach((f) => crState.slides.push({ type: "image", file: f, url: URL.createObjectURL(f), overlays: [] }));
      paintStage();
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  };

  paintStage();
  return step;
}

// Reassigned each time the editor step is built (needs access to that
// step's local paintStage closure); declared once at module scope so the
// toolbar/thumbstrip buttons above can reference it before it's built.
let crAddMoreImages = () => {};

function crAddTextLayer(stage) {
  const slide = crState.slides[crState.activeSlide];
  const ov = { id: crLayerId(), type: "text", text: "Tap to edit", x: 50, y: 50, rotation: 0, scale: 1, sizePct: 9, color: "#ffffff" };
  slide.overlays.push(ov);
  crState.selectedLayerId = ov.id;
  crGoto("editor"); // re-render this step to pick up the new layer immediately
}
function crAddStickerLayer(stage, overlayLayer, emo) {
  const slide = crState.slides[crState.activeSlide];
  const ov = { id: crLayerId(), type: "sticker", icon: emo, x: 50, y: 50, rotation: 0, scale: 1, sizePct: 14 };
  slide.overlays.push(ov);
  crState.selectedLayerId = ov.id;
  crGoto("editor");
}

// ---------------- Step 3: music ----------------
let _crPreviewAudio = null;
function crBuildMusicStep() {
  const results = el("div", {});
  const searchInput = el("input", { type: "text", placeholder: "Search songs, artists, moods…" });
  const step = el("div", { class: "cr-step active" },
    el("div", { class: "cr-music" },
      el("div", {
        class: "cr-music-none" + (!crState.song ? " active" : ""),
        onclick: () => { crState.song = null; crStopPreview(); crBuildMusicStepPaint(results); },
      }, el("i", { class: "ri-forbid-line" }), "No music"),
      el("div", { class: "cr-music-search" }, el("i", { class: "ri-search-line" }), searchInput),
      results,
    ),
  );
  let t = null;
  searchInput.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => crSearchMusic(searchInput.value.trim(), results), 350);
  });
  crSearchMusic("", results);
  return step;
}
function crStopPreview() { if (_crPreviewAudio) { _crPreviewAudio.pause(); _crPreviewAudio = null; } }

// iTunes Search API needs no API key/signup, is CORS-enabled for direct
// browser calls, and covers real current commercial catalog (Asake, Ariana
// Grande, Burna Boy, etc.) — each result gives a real 30s preview clip
// (previewUrl) we can play/attach, which is what TikTok/Reels-style song
// pickers use under the hood too.
const ITUNES_DEFAULT_TERMS = ["afrobeats", "hip hop", "pop hits", "top 40"];
async function crSearchMusic(qText, results) {
  results.innerHTML = `<div class="cr-music-empty"><i class="ri-loader-4-line"></i> Loading…</div>`;
  try {
    const term = qText || ITUNES_DEFAULT_TERMS[Math.floor(Math.random() * ITUNES_DEFAULT_TERMS.length)];
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=music&entity=song&limit=25`;
    const r = await fetch(url);
    const j = await r.json();
    const docs = (j.results || []).filter((t) => t.previewUrl);
    results.innerHTML = "";
    if (!docs.length) { results.appendChild(el("div", { class: "cr-music-empty" }, "No tracks found — try a different search")); return; }
    docs.forEach((doc) => results.appendChild(crTrackRow(doc, results)));
  } catch {
    results.innerHTML = "";
    results.appendChild(el("div", { class: "cr-music-empty" }, "Couldn't load music right now"));
  }
}
function crTrackRow(doc, results) {
  const id = String(doc.trackId);
  const isActive = crState.song?.id === id;
  const title = doc.trackName || "Untitled";
  const creator = doc.artistName || "Unknown artist";
  const url = doc.previewUrl;
  const playIcon = el("i", { class: "ri-play-fill" });
  const playBtn = el("button", { class: "cr-track-play" }, playIcon);
  const pickBtn = el("button", { class: "cr-track-pick" }, isActive ? "Selected" : "Use");
  const artImg = doc.artworkUrl60
    ? el("img", { src: doc.artworkUrl60, alt: "" })
    : el("i", { class: "ri-music-2-fill" });
  const row = el("div", { class: "cr-track" + (isActive ? " active" : "") },
    el("div", { class: "cr-track-art" }, artImg),
    el("div", { class: "cr-track-info" }, el("div", { class: "n" }, title), el("div", { class: "a" }, creator)),
    playBtn,
    pickBtn,
  );
  playBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (_crPreviewAudio && _crPreviewAudio._identifier === id && !_crPreviewAudio.paused) {
      crStopPreview(); playIcon.className = "ri-play-fill"; return;
    }
    crStopPreview();
    _crPreviewAudio = new Audio(url);
    _crPreviewAudio._identifier = id;
    _crPreviewAudio.play().catch(() => { toast("Couldn't play that track"); });
    playIcon.className = "ri-pause-fill";
    _crPreviewAudio.addEventListener("ended", () => { playIcon.className = "ri-play-fill"; });
  });
  pickBtn.addEventListener("click", () => {
    crState.song = { id, name: title, artist: creator, url };
    crStopPreview();
    crBuildMusicStepPaint(results);
  });
  return row;
}
function crBuildMusicStepPaint(results) {
  crSearchMusic("", results);
}

// ---------------- Step 4: details + publish ----------------
function crBuildDetailsStep() {
  const thumbSlide = crState.slides[0];
  const caption = el("textarea", { placeholder: "Write a caption… use #hashtags and @mentions" });
  caption.value = crState.caption;
  caption.addEventListener("input", () => { crState.caption = caption.value; });

  const locRow = el("div", { class: "cr-details-row" },
    el("div", { class: "l" }, el("i", { class: "ri-map-pin-line" }), "Tag location"),
    el("div", { class: "v" }, crState.location?.city || "Not tagged"),
  );
  locRow.addEventListener("click", () => {
    if (!("geolocation" in navigator)) { toast("Location not available on this device/browser"); return; }
    // Geolocation only works in a secure context (https, or localhost) —
    // fail fast with a clear message instead of silently hanging forever.
    if (!window.isSecureContext) {
      toast("Location requires HTTPS — this page is loaded over an insecure connection");
      return;
    }
    const valueEl = locRow.querySelector(".v");
    valueEl.textContent = "Locating…";
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const { latitude: lat, longitude: lng } = pos.coords;
      let city = null;
      // Helper: fetch with a hard timeout so a stalled reverse-geocode
      // never leaves the UI stuck on "Locating…" indefinitely.
      const fetchWithTimeout = (url, opts = {}, ms = 6000) => {
        const ctrl = new AbortController();
        const tid  = setTimeout(() => ctrl.abort(), ms);
        return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(tid));
      };
      // 1st attempt: BigDataCloud (free, no API key, CORS-safe)
      try {
        const r = await fetchWithTimeout(
          `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`
        );
        if (r.ok) { const j = await r.json(); city = j.city || j.locality || j.principalSubdivision || null; }
      } catch {}
      // 2nd attempt: Nominatim fallback if BigDataCloud returned nothing
      if (!city) {
        try {
          const r2 = await fetchWithTimeout(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=10`,
            { headers: { "Accept-Language": "en" } }
          );
          if (r2.ok) {
            const j2 = await r2.json();
            city = j2.address?.city || j2.address?.town || j2.address?.village || j2.address?.state || null;
          }
        } catch {}
      }
      crState.location = { lat: Math.round(lat * 100) / 100, lng: Math.round(lng * 100) / 100, city };
      valueEl.textContent = city || `${lat.toFixed(3)}, ${lng.toFixed(3)}`;
      toast("📍 Location tagged" + (city ? `: ${city}` : ""));
    }, (err) => {
      const msg = err.code === 1 ? "Location access denied — enable it in your browser/site settings"
        : err.code === 2 ? "Couldn't determine your location — check your connection and try again"
        : "Location timed out — move to a clearer area and try again";
      toast(msg);
      valueEl.textContent = crState.location?.city || "Not tagged";
    }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 0 });
  });

  // Music is only available for videos recorded in-app (not uploads or images)
  const musicRow = crState.isRecordedVideo
    ? el("div", { class: "cr-details-row" },
        el("div", { class: "l" }, el("i", { class: "ri-music-2-line" }), "Music"),
        el("div", { class: "v" }, crState.song ? `${crState.song.name} — ${crState.song.artist}` : "None"),
      )
    : null;
  if (musicRow) musicRow.addEventListener("click", () => crGoto("music"));

  // ── Hashtag prompt — quick-select mood/interest tags ─────────────────────
  const QUICK_TAGS = ["#music","#art","#film","#food","#fashion","#tech","#gaming","#travel","#books","#fitness","#mood","#photography","#design","#nature","#comedy"];
  const tagChipsRow = el("div", { class: "cr-tag-chips" });
  QUICK_TAGS.forEach(tag => {
    const chip = el("button", { type: "button", class: "cr-tag-chip" }, tag);
    // Pre-highlight if caption already contains this tag
    if (crState.caption.includes(tag)) chip.classList.add("active");
    chip.addEventListener("click", () => {
      const isActive = chip.classList.toggle("active");
      if (isActive) {
        if (!crState.caption.includes(tag)) {
          crState.caption = (crState.caption.trim() + " " + tag).trim();
          caption.value = crState.caption;
        }
      } else {
        crState.caption = crState.caption.replace(new RegExp(tag.replace("#","\\#") + "\\b", "g"), "").replace(/\s{2,}/g, " ").trim();
        caption.value = crState.caption;
      }
    });
    tagChipsRow.appendChild(chip);
  });

  const tagPrompt = el("div", { class: "cr-tag-prompt" },
    el("div", { class: "cr-tag-prompt-label" },
      el("i", { class: "ri-hashtag" }), " Vibe tags"),
    tagChipsRow,
    el("div", { class: "cr-tag-hint" }, "Tags help us match your post to people who'll love it."),
  );

  return el("div", { class: "cr-step active" },
    el("div", { class: "cr-details" },
      el("div", { class: "cr-details-preview" },
        thumbSlide.type === "video"
          ? el("video", { src: thumbSlide.url, class: "cr-details-thumb", muted: true })
          : el("img", { src: thumbSlide.url, class: "cr-details-thumb" }),
        el("div", { style: "flex:1;color:var(--text-mute);font-size:13px;" },
          crState.slides.length > 1 ? `${crState.slides.length} photos in this post` : (thumbSlide.type === "video" ? "1 video" : "1 photo")),
      ),
      caption,
      tagPrompt,
      locRow,
      musicRow,
    ),
  );
}

// Bake all overlays for an image slide into a single flattened image file
// (video overlays are NOT baked — they're stored as metadata and rendered
// live over the <video> element during playback; see wireFeedOverlays).
function crFlattenImageSlide(slide) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      slide.overlays.forEach((ov) => {
        ctx.save();
        const px = (ov.x / 100) * canvas.width, py = (ov.y / 100) * canvas.height;
        ctx.translate(px, py);
        ctx.rotate((ov.rotation * Math.PI) / 180);
        const fontPx = crFontPx(ov, canvas.width);
        if (ov.type === "text") {
          ctx.font = `800 ${fontPx}px "Plus Jakarta Sans", sans-serif`;
          ctx.fillStyle = ov.color; ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.shadowColor = "rgba(0,0,0,.5)"; ctx.shadowBlur = fontPx * 0.15;
          ctx.fillText(ov.text, 0, 0);
        } else {
          ctx.font = `${fontPx}px sans-serif`;
          ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText(ov.icon, 0, 0);
        }
        ctx.restore();
      });
      canvas.toBlob((blob) => resolve(new File([blob], slide.file.name.replace(/\.\w+$/, "") + "-edited.png", { type: "image/png" })), "image/png", 0.95);
    };
    img.onerror = reject;
    img.src = slide.url;
  });
}

async function crSubmitPost(btn) {
  if (!crState.slides.length) { toast("Pick a photo or video first"); return; }
  btn.disabled = true; btn.textContent = "Posting…";
  try {
    toast("Uploading…");
    let media;
    if (crState.slides[0].type === "video") {
      const slide = crState.slides[0];
      const uploaded = await uploadToCloudinary(slide.file, "video");
      if (slide.overlays.length) uploaded.overlays = slide.overlays;
      media = uploaded;
    } else if (crState.slides.length === 1) {
      const flat = await crFlattenImageSlide(crState.slides[0]);
      media = await uploadToCloudinary(flat, "image");
    } else {
      const flats = await Promise.all(crState.slides.map(crFlattenImageSlide));
      media = await Promise.all(flats.map((f) => uploadToCloudinary(f, "image")));
    }
    const text = crState.caption.trim();
    const hashtags = extractHashtags(text);
    const postData = {
      authorUid: state.uid, text, media, hashtags,
      orbits: [], orbitCount: 0, commentCount: 0, createdAt: serverTimestamp(),
    };
    if (crState.location) postData.location = crState.location;
    if (crState.song && crState.isRecordedVideo) postData.song = crState.song; // only recorded videos carry music
    const newPostRef = await addDoc(collection(db, "posts"), postData);
    sfxPost();
    toast("Posted!");
    crClose();
    addDoc(collection(db, "notifications", state.uid, "items"), {
      type: "postConfirm", postId: newPostRef.id, text: "Your post is live!", read: false, createdAt: serverTimestamp(),
    }).catch(() => {});
    (async () => {
      let followers = state.me?.followers || [];
      try {
        const freshSnap = await getDoc(doc(db, "users", state.uid));
        if (freshSnap.exists()) followers = freshSnap.data().followers || followers;
      } catch {}
      followers = followers.slice(0, 200);
      if (!followers.length) return;
      const preview = (text || "shared new media").slice(0, 60);
      const postThumb = Array.isArray(media) ? media[0]?.url : media?.url;
      const { notifyUser } = await import("./notifications.js");
      followers.forEach((uid) => {
        writeNotif(uid, "newPost", { postId: newPostRef.id, text: `${state.me?.name || "Someone"} posted: "${preview}"` }).catch(() => {});
        notifyUser(uid, state.me?.name || "Someone", `New post: ${preview}`, "/#post/" + newPostRef.id, state.me?.photoURL || "", postThumb || "").catch(() => {});
      });
    })().catch(() => {});
  } catch (err) {
    toast("Failed to post: " + (err.message || "unknown error"));
    btn.disabled = false; btn.textContent = "Post";
  }
}

// =========================================================================
// 14b. INLINE FEED SUGGESTION CARDS (People / Groups / Spaces)
// =========================================================================

const renderInlinePeopleSuggestion = () => {
  const scroller = el("div", { class: "feed-sugg-scroller" });
  const card = el("div", { class: "feed-suggestion-card" },
    el("div", { class: "feed-sugg-head" },
      el("span", {}, el("i", { class: "ri-user-add-line" }), " People you may know"),
      el("span", { class: "feed-sugg-see-all", onclick: () => location.hash = "#explore" }, "See all")
    ),
    scroller
  );
  getDocs(query(collection(db, "users"), orderBy("createdAt", "desc"), limit(30))).then((snap) => {
    // Shuffle so a different set appears each time
    const _all = snap.docs.map(d => ({ uid: d.id, ...d.data() }))
      .filter(u => u.uid !== state.uid && !u.isBot);
    for (let i = _all.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [_all[i], _all[j]] = [_all[j], _all[i]]; }
    let added = 0;
    _all.forEach((u) => {
      if (added >= 6) return;
      added++;
      let iFollow = (state.me?.following || []).includes(u.uid);
      const btn = el("button", {
        class: `btn sm ${iFollow ? "ghost" : "primary"}`,
        onclick: async (e) => {
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
          state.cache.users.delete(u.uid);
          state.cache.users.delete(state.uid);
          iFollow = !iFollow;
          btn.textContent = iFollow ? "Following" : "Follow";
          btn.className = `btn sm ${iFollow ? "ghost" : "primary"}`;
        }
      }, iFollow ? "Following" : "Follow");
      scroller.appendChild(el("div", { class: "feed-sugg-person" },
        el("img", { class: "avatar md", src: avatarFor(u), onclick: () => location.hash = `#profile/${u.uid}` }),
        el("div", { class: "feed-sugg-name" }, u.name || "User"),
        el("div", { class: "feed-sugg-meta" }, "@" + (u.username || "")),
        btn
      ));
    });
    if (added === 0) card.remove();
  }).catch(() => card.remove());
  return card;
};

const renderInlineGroupSuggestion = () => {
  const scroller = el("div", { class: "feed-sugg-scroller" });
  const card = el("div", { class: "feed-suggestion-card" },
    el("div", { class: "feed-sugg-head" },
      el("span", {}, el("i", { class: "ri-group-2-line" }), " Groups you might like"),
      el("span", { class: "feed-sugg-see-all", onclick: () => location.hash = "#groups" }, "See all")
    ),
    scroller
  );
  getDocs(query(collection(db, "groups"), orderBy("createdAt", "desc"), limit(24))).then((snap) => {
    if (snap.empty) { card.remove(); return; }
    const _all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    for (let i = _all.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [_all[i], _all[j]] = [_all[j], _all[i]]; }
    _all.slice(0, 6).forEach((g) => {
      let member = (g.members || []).includes(state.uid);
      const btn = el("button", {
        class: `btn sm ${member ? "ghost" : "primary"}`,
        onclick: async () => {
          const ref = doc(db, "groups", g.id);
          if (member) {
            await updateDoc(ref, { members: arrayRemove(state.uid) });
          } else {
            await updateDoc(ref, { members: arrayUnion(state.uid) });
          }
          member = !member;
          btn.textContent = member ? "Joined" : "Join";
          btn.className = `btn sm ${member ? "ghost" : "primary"}`;
        }
      }, member ? "Joined" : "Join");
      scroller.appendChild(el("div", { class: "feed-sugg-group" },
        el("div", { class: "feed-sugg-group-cover" }, (g.name || "?")[0].toUpperCase()),
        el("div", { class: "feed-sugg-name" }, g.name),
        el("div", { class: "feed-sugg-meta" }, `${(g.members || []).length} member${(g.members || []).length !== 1 ? "s" : ""}`),
        btn
      ));
    });
  }).catch(() => card.remove());
  return card;
};

const renderInlineSpaceSuggestion = () => {
  const scroller = el("div", { class: "feed-sugg-scroller" });
  const card = el("div", { class: "feed-suggestion-card" },
    el("div", { class: "feed-sugg-head" },
      el("span", {}, el("i", { class: "ri-planet-line" }), " Spaces for you"),
      el("span", { class: "feed-sugg-see-all", onclick: () => location.hash = "#spaces" }, "See all")
    ),
    scroller
  );
  getDocs(query(collection(db, "spaces"), orderBy("memberCount", "desc"), limit(24))).then((snap) => {
    if (snap.empty) { card.remove(); return; }
    const _all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    for (let i = _all.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [_all[i], _all[j]] = [_all[j], _all[i]]; }
    _all.slice(0, 6).forEach((s) => {
      let joined = (s.members || []).includes(state.uid);
      const btn = el("button", {
        class: `btn sm ${joined ? "ghost" : "primary"}`,
        onclick: async () => {
          const ref = doc(db, "spaces", s.id);
          if (joined) {
            await updateDoc(ref, { members: arrayRemove(state.uid), memberCount: increment(-1) });
          } else {
            await updateDoc(ref, { members: arrayUnion(state.uid), memberCount: increment(1) });
          }
          joined = !joined;
          btn.textContent = joined ? "Joined" : "Join";
          btn.className = `btn sm ${joined ? "ghost" : "primary"}`;
        }
      }, joined ? "Joined" : "Join");
      scroller.appendChild(el("div", { class: "feed-sugg-space" },
        el("div", { class: "feed-sugg-space-icon", style: `background:${s.color || "var(--grad-1)"}` },
          el("i", { class: s.icon || "ri-planet-line" })),
        el("div", { class: "feed-sugg-name" }, s.name),
        el("div", { class: "feed-sugg-meta" }, `${s.memberCount || 0} member${(s.memberCount || 0) !== 1 ? "s" : ""}`),
        btn
      ));
    });
  }).catch(() => card.remove());
  return card;
};

// =========================================================================
// 14c. NEW USER ONBOARDING MODAL
// =========================================================================

const showOnboardingModal = () => {
  const overlay = el("div", { class: "onboard-overlay" });
  const modal   = el("div", { class: "onboard-modal" });

  const close = () => overlay.remove();

  // Header
  modal.appendChild(el("div", { class: "onboard-header" },
    el("div", { class: "onboard-logo" }, el("i", { class: "ri-planet-fill" })),
    el("h2", {}, `Welcome to Vibe, ${(state.me?.name || "there").split(" ")[0]}! 🚀`),
    el("p", {}, "Follow people, join groups, and discover spaces to get started.")
  ));

  // ── People section ──────────────────────────────────────────────────────
  const peopleList = el("div", { class: "onboard-section-list" });
  modal.appendChild(el("div", { class: "onboard-section" },
    el("div", { class: "onboard-section-title" }, el("i", { class: "ri-user-add-line" }), " Suggested people"),
    peopleList
  ));
  getDocs(query(collection(db, "users"), orderBy("createdAt", "desc"), limit(8))).then((snap) => {
    let added = 0;
    snap.docs.forEach((d) => {
      const u = { uid: d.id, ...d.data() };
      if (u.uid === state.uid || added >= 5) return;
      added++;
      let iFollow = false;
      const btn = el("button", {
        class: "btn sm primary",
        onclick: async () => {
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
          state.cache.users.delete(u.uid);
          state.cache.users.delete(state.uid);
          iFollow = !iFollow;
          btn.textContent = iFollow ? "✓ Following" : "Follow";
          btn.className = `btn sm ${iFollow ? "ghost" : "primary"}`;
        }
      }, "Follow");
      peopleList.appendChild(el("div", { class: "onboard-row" },
        el("img", { class: "avatar sm", src: avatarFor(u), style: "cursor:pointer;", onclick: () => location.hash = `#profile/${u.uid}` }),
        el("div", { class: "onboard-row-meta" },
          el("div", { class: "onboard-row-name" }, u.name || "User"),
          el("div", { class: "onboard-row-sub" }, "@" + (u.username || ""))
        ),
        btn
      ));
    });
  }).catch(() => {});

  // ── Groups section ──────────────────────────────────────────────────────
  const groupList = el("div", { class: "onboard-section-list" });
  modal.appendChild(el("div", { class: "onboard-section" },
    el("div", { class: "onboard-section-title" }, el("i", { class: "ri-group-2-line" }), " Groups to join"),
    groupList
  ));
  getDocs(query(collection(db, "groups"), orderBy("createdAt", "desc"), limit(4))).then((snap) => {
    if (snap.empty) return;
    snap.docs.forEach((d) => {
      const g = { id: d.id, ...d.data() };
      let member = false;
      const btn = el("button", {
        class: "btn sm primary",
        onclick: async () => {
          const ref = doc(db, "groups", g.id);
          if (member) {
            await updateDoc(ref, { members: arrayRemove(state.uid) });
          } else {
            await updateDoc(ref, { members: arrayUnion(state.uid) });
          }
          member = !member;
          btn.textContent = member ? "✓ Joined" : "Join";
          btn.className = `btn sm ${member ? "ghost" : "primary"}`;
        }
      }, "Join");
      groupList.appendChild(el("div", { class: "onboard-row" },
        el("div", { class: "onboard-group-icon" }, (g.name || "?")[0].toUpperCase()),
        el("div", { class: "onboard-row-meta" },
          el("div", { class: "onboard-row-name" }, g.name),
          el("div", { class: "onboard-row-sub" }, `${(g.members || []).length} members`)
        ),
        btn
      ));
    });
  }).catch(() => {});

  // ── Spaces section ──────────────────────────────────────────────────────
  const spaceList = el("div", { class: "onboard-section-list" });
  modal.appendChild(el("div", { class: "onboard-section" },
    el("div", { class: "onboard-section-title" }, el("i", { class: "ri-planet-line" }), " Spaces to explore"),
    spaceList
  ));
  getDocs(query(collection(db, "spaces"), orderBy("memberCount", "desc"), limit(4))).then((snap) => {
    if (snap.empty) return;
    snap.docs.forEach((d) => {
      const s = { id: d.id, ...d.data() };
      let joined = false;
      const btn = el("button", {
        class: "btn sm primary",
        onclick: async () => {
          const ref = doc(db, "spaces", s.id);
          if (joined) {
            await updateDoc(ref, { members: arrayRemove(state.uid), memberCount: increment(-1) });
          } else {
            await updateDoc(ref, { members: arrayUnion(state.uid), memberCount: increment(1) });
          }
          joined = !joined;
          btn.textContent = joined ? "✓ Joined" : "Join";
          btn.className = `btn sm ${joined ? "ghost" : "primary"}`;
        }
      }, "Join");
      spaceList.appendChild(el("div", { class: "onboard-row" },
        el("div", { class: "onboard-space-icon", style: `background:${s.color || "var(--grad-1)"}` },
          el("i", { class: s.icon || "ri-planet-line" })),
        el("div", { class: "onboard-row-meta" },
          el("div", { class: "onboard-row-name" }, s.name),
          el("div", { class: "onboard-row-sub" }, `${s.memberCount || 0} members`)
        ),
        btn
      ));
    });
  }).catch(() => {});

  // ── Footer ──────────────────────────────────────────────────────────────
  modal.appendChild(el("div", { class: "onboard-footer" },
    el("button", { class: "btn primary full-width", onclick: close }, "🚀 Let's go!")
  ));

  overlay.appendChild(modal);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.body.appendChild(overlay);
};

// =========================================================================
// 14c-2. PROFILE SETUP PROMPT — for returning users who skipped onboarding
// =========================================================================

const checkProfileSetup = () => {
  // Only once per session
  if (sessionStorage.getItem("orbit:profile-prompt-dismissed")) return;
  const hasDefaultAvatar = !state.me.photoURL || state.me.photoURL.includes("dicebear");
  const hasBio = !!state.me.bio?.trim();
  if (!hasDefaultAvatar && hasBio) return; // profile looks complete — nothing to prompt

  const banner = document.createElement("div");
  banner.className = "profile-setup-banner";
  banner.innerHTML = `
    <div class="psb-icon"><i class="ri-user-settings-line"></i></div>
    <div class="psb-body">
      <div class="psb-title">Complete your profile</div>
      <div class="psb-sub">${hasDefaultAvatar ? "Add a profile photo" : ""}${hasDefaultAvatar && !hasBio ? " and a " : ""}${!hasBio ? "bio" : ""} so people can find you</div>
    </div>
    <button class="btn primary sm psb-btn">Set up</button>
    <button class="icon-btn psb-dismiss" title="Dismiss"><i class="ri-close-line"></i></button>`;

  const dismiss = () => {
    banner.remove();
    sessionStorage.setItem("orbit:profile-prompt-dismissed", "1");
  };

  banner.querySelector(".psb-btn").onclick = () => {
    dismiss();
    location.hash = "#profile/" + state.uid;
    // Open the edit modal once the profile route has rendered
    setTimeout(() => {
      document.querySelector(".profile-actions .btn.ghost")?.click();
    }, 500);
  };
  banner.querySelector(".psb-dismiss").onclick = dismiss;

  // Insert at top of #content after feed has rendered
  setTimeout(() => {
    const content = document.getElementById("content");
    if (content && !document.querySelector(".profile-setup-banner")) {
      content.insertBefore(banner, content.firstChild);
    }
  }, 1200);
};

// =========================================================================
// 14d. NEWS / SPORTS / SOCIAL BOT  — posts every 5 hours under official accounts
// =========================================================================

const NEWS_BOTS = [
  {
    uid:      "orbit-news-official",
    name:     "Orbit News Official",
    username: "orbit_news",
    emoji:    "📰",
    badge:    "ri-newspaper-line",
    rss:      "https://feeds.bbci.co.uk/news/rss.xml",
    tag:      "news",
  },
  {
    uid:      "orbit-sport-official",
    name:     "Orbit Sport Official",
    username: "orbit_sport",
    emoji:    "⚽",
    badge:    "ri-football-line",
    rss:      "https://www.espn.com/espn/rss/news",
    tag:      "sports",
  },
  {
    uid:      "orbit-social-official",
    name:     "Orbit Social Official",
    username: "orbit_social",
    emoji:    "🌐",
    badge:    "ri-global-line",
    rss:      "https://techcrunch.com/feed/",
    tag:      "social",
  },
];

const _BOT_INTERVAL = 5 * 60 * 60 * 1000; // 5 hours in ms
const _RSS2JSON     = "https://api.rss2json.com/v1/api.json?count=6&rss_url=";

const startNewsBot = async () => {
  for (const bot of NEWS_BOTS) {
    try {
      // 1. Ensure bot user doc exists in Firestore
      const botRef  = doc(db, "users", bot.uid);
      const botSnap = await getDoc(botRef);
      if (!botSnap.exists()) {
        await setDoc(botRef, {
          uid:       bot.uid,
          name:      bot.name,
          username:  bot.username,
          photoURL:  `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(bot.name)}&backgroundColor=6c63ff`,
          bio:       `Official ${bot.tag} updates curated by Orbit. Refreshed every 5 hours.`,
          verified:  true,
          isBot:     true,
          followers: [],
          following: [],
          online:    false,
          createdAt: serverTimestamp(),
        });
      }

      // 2. Check when the bot last posted — skip if < 5 hours ago
      const lastSnap = await getDocs(
        query(collection(db, "posts"),
          where("authorUid", "==", bot.uid),
          orderBy("createdAt", "desc"),
          limit(1)
        )
      );
      if (!lastSnap.empty) {
        const lastMs = lastSnap.docs[0].data().createdAt?.toMillis?.() || 0;
        if (Date.now() - lastMs < _BOT_INTERVAL) continue;
      }

      // 3. Fetch RSS via rss2json (free, no key needed)
      const res = await fetch(`${_RSS2JSON}${encodeURIComponent(bot.rss)}`);
      if (!res.ok) continue;
      const feed  = await res.json();
      const items = (feed.items || []).slice(0, 3);
      if (!items.length) continue;

      // 4. Post each headline to the feed
      const avatar = botSnap.exists()
        ? botSnap.data().photoURL
        : `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(bot.name)}&backgroundColor=6c63ff`;

      for (const item of items) {
        const clean = (item.description || "")
          .replace(/<[^>]*>/g, "")
          .trim()
          .slice(0, 220);
        await addDoc(collection(db, "posts"), {
          authorUid:    bot.uid,
          authorName:   bot.name,
          authorAvatar: avatar,
          kind:         "news",
          text:         `${bot.emoji} *${item.title.trim()}*\n\n${clean}${clean.length >= 220 ? "…" : ""}`,
          link:         item.link || "",
          hashtags:     [bot.tag],
          orbitCount:   0,
          commentCount: 0,
          likes:        [],
          createdAt:    serverTimestamp(),
        });
      }
    } catch (e) {
      // Silently skip — bot failure should never break the app
    }
  }
};

// =========================================================================
// 15. SUGGESTIONS + TRENDING right rail
// =========================================================================
const startSuggestions = () => {
  // Suggested users — fetch more then shuffle so the rail feels different each session
  onSnapshot(query(collection(db, "users"), orderBy("createdAt", "desc"), limit(20)), (snap) => {
    const list = $("#suggestList"); if (!list) return;
    list.innerHTML = "";
    const _all = snap.docs.map(d => ({ uid: d.id, ...d.data() }))
      .filter(u => u.uid !== state.uid && !u.isBot);
    for (let i = _all.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [_all[i], _all[j]] = [_all[j], _all[i]]; }
    _all.slice(0, 5).forEach((u) => {
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
          state.cache.users.delete(u.uid);
          state.cache.users.delete(state.uid);
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
// 16. AI ASSISTANT — Chat interface, settings, and chat-list injection
// =========================================================================

// --- AI Chat state ---
let _aiMessages = [];
let _aiTyping   = false;

// --- Inject AI entry into chat list (Snapchat-style, survives onSnapshot resets) ---
let _aiChatObserver = null;
const _injectAIChatEntry = () => {
  // Disconnect any previous observer
  if (_aiChatObserver) { _aiChatObserver.disconnect(); _aiChatObserver = null; }

  const buildAIRow = () => {
    const toneInfo = AI_TONES[state.aiTone] || AI_TONES.friendly;
    return el("div", {
      class: "orbit-ai-entry chat-row",
      style: "display:flex;align-items:center;gap:12px;padding:14px 16px;cursor:pointer;border-bottom:1px solid var(--border,rgba(255,255,255,0.07));background:linear-gradient(90deg,rgba(230,57,80,0.10) 0%,transparent 100%);flex-shrink:0;",
      onclick: () => location.hash = "#chats/ai",
    },
      el("div", { class: "av", style: "position:relative;" },
        el("div", { style: "width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,#e63950,#ff6b6b);display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;" }, state.aiAvatar),
        el("span", { style: "position:absolute;bottom:1px;right:1px;width:10px;height:10px;border-radius:50%;background:#22c55e;border:2px solid var(--bg2,#1a1a2e);" }),
      ),
      el("div", { class: "meta", style: "min-width:0;flex:1;" },
        el("div", { class: "name", style: "font-weight:700;font-size:15px;" }, state.aiName,
          el("span", { style: "font-size:10px;font-weight:700;color:#e63950;margin-left:6px;background:rgba(230,57,80,.15);padding:1px 6px;border-radius:20px;" }, "AI"),
        ),
        el("div", { class: "preview", style: "font-size:12px;color:var(--text3);margin-top:2px;" }, `${toneInfo.emoji} ${toneInfo.label} · Always here for you`),
      ),
    );
  };

  const ensureInjected = (scroll) => {
    if (!scroll) return;
    // Only inject if the list has real content (not just loader/empty state)
    const hasRows = scroll.querySelector(".chat-row:not(.orbit-ai-entry)") || scroll.querySelector(".empty");
    if (!hasRows) return;
    if (scroll.querySelector(".orbit-ai-entry")) return; // already there
    scroll.insertBefore(buildAIRow(), scroll.firstChild);
  };

  // Watch #chatsScroll for DOM changes (loadChatsList clears it on every snapshot)
  const attachObserver = () => {
    const scroll = document.getElementById("chatsScroll");
    if (!scroll) return false;
    ensureInjected(scroll);
    _aiChatObserver = new MutationObserver(() => ensureInjected(document.getElementById("chatsScroll")));
    _aiChatObserver.observe(scroll, { childList: true });
    return true;
  };

  // Poll until #chatsScroll appears in the DOM
  if (!attachObserver()) {
    const poll = setInterval(() => { if (attachObserver()) clearInterval(poll); }, 80);
    setTimeout(() => clearInterval(poll), 8000);
  }

  // Clean up when user navigates away from chats
  window.addEventListener("hashchange", () => {
    if (_aiChatObserver) { _aiChatObserver.disconnect(); _aiChatObserver = null; }
  }, { once: true });
};

// --- Render AI message bubble ---
const _aiBubbleEl = (m) => {
  const isAI = m.role === "ai";
  const wrap = el("div", { class: `chat-bubble-wrap ${isAI ? "ai" : "user"}`, style: `display:flex;align-items:flex-end;gap:8px;margin:6px 14px;${isAI ? "" : "flex-direction:row-reverse;"}` });
  if (isAI) {
    wrap.appendChild(el("div", { style: "width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,var(--grad-1,#e63950),var(--grad-2,#ff6b6b));display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0;" }, state.aiAvatar));
  }
  const bubble = el("div", { style: `max-width:75%;padding:10px 14px;border-radius:${isAI ? "4px 18px 18px 18px" : "18px 4px 18px 18px"};background:${isAI ? "var(--bg3,#2a2a3a)" : "var(--primary,#e63950)"};color:${isAI ? "var(--text)" : "#fff"};font-size:14px;line-height:1.5;word-break:break-word;` });
  bubble.textContent = m.text;
  wrap.appendChild(bubble);
  return wrap;
};

// --- Render AI messages list ---
const _aiRenderMessages = () => {
  const box = document.getElementById("aiChatMessages");
  if (!box) return;
  if (!_aiMessages.length && !_aiTyping) {
    box.innerHTML = `<div style="text-align:center;padding:40px 20px;color:var(--text3);font-size:14px;">${state.aiAvatar}<br><br>Say something to ${state.aiName}…</div>`;
    return;
  }
  box.innerHTML = "";
  _aiMessages.forEach((m) => box.appendChild(_aiBubbleEl(m)));
  if (_aiTyping) {
    const typingWrap = el("div", { style: "display:flex;align-items:flex-end;gap:8px;margin:6px 14px;" });
    typingWrap.appendChild(el("div", { style: "width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,var(--grad-1,#e63950),var(--grad-2,#ff6b6b));display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0;" }, state.aiAvatar));
    const dots = el("div", { style: "padding:12px 16px;border-radius:4px 18px 18px 18px;background:var(--bg3,#2a2a3a);" });
    dots.innerHTML = `<span style="display:inline-flex;gap:4px;align-items:center;height:14px;"><span style="width:6px;height:6px;border-radius:50%;background:var(--text3);animation:aiDot 1.2s infinite 0s;"></span><span style="width:6px;height:6px;border-radius:50%;background:var(--text3);animation:aiDot 1.2s infinite .2s;"></span><span style="width:6px;height:6px;border-radius:50%;background:var(--text3);animation:aiDot 1.2s infinite .4s;"></span></span>`;
    typingWrap.appendChild(dots);
    box.appendChild(typingWrap);
  }
  box.scrollTop = box.scrollHeight;
};

// Inject typing dot animation styles once
let _aiStylesInjected = false;
const _aiInjectStyles = () => {
  if (_aiStylesInjected) return;
  _aiStylesInjected = true;
  const s = document.createElement("style");
  s.textContent = `
    @keyframes aiDot { 0%,80%,100% { opacity:.3; transform:scale(.8); } 40% { opacity:1; transform:scale(1); } }
    .ai-chat-page { display:flex;flex-direction:column;height:100%;max-height:100dvh;overflow:hidden; }
    .ai-chat-header { display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--border,rgba(255,255,255,0.07));flex-shrink:0;background:var(--bg2,#1a1a2e); }
    .ai-chat-messages { flex:1;overflow-y:auto;padding:12px 0; }
    .ai-chat-bottom { flex-shrink:0;border-top:1px solid var(--border,rgba(255,255,255,0.07));padding:10px 14px;display:flex;flex-direction:column;gap:8px;background:var(--bg2,#1a1a2e); }
    .ai-chat-input-row { display:flex;align-items:center;gap:8px; }
    .ai-chat-textarea { flex:1;resize:none;border:1px solid var(--border,rgba(255,255,255,0.12));border-radius:22px;padding:10px 16px;background:var(--bg3,#2a2a3a);color:var(--text);font-size:14px;outline:none;max-height:120px;line-height:1.4; }
    .ai-chat-textarea:focus { border-color:var(--primary,#e63950); }
    .ai-chat-send-btn { width:40px;height:40px;border-radius:50%;background:var(--primary,#e63950);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:#fff; }
    .ai-chat-send-btn:hover { opacity:.85; }
    .ai-settings-sheet { display:flex;flex-direction:column;gap:10px;max-height:80dvh;overflow-y:auto; }
    .ai-settings-section { font-size:11px;font-weight:700;letter-spacing:.7px;text-transform:uppercase;color:var(--text3);margin-top:8px; }
    .ai-name-input { width:100%;padding:10px 14px;border:1px solid var(--border,rgba(255,255,255,0.12));border-radius:12px;background:var(--bg3);color:var(--text);font-size:14px;outline:none;box-sizing:border-box; }
    .ai-avatar-grid { display:flex;flex-wrap:wrap;gap:8px;margin-top:4px; }
    .ai-avatar-opt { width:42px;height:42px;border-radius:50%;border:2px solid transparent;display:flex;align-items:center;justify-content:center;font-size:22px;cursor:pointer;background:var(--bg3);transition:border-color .15s; }
    .ai-avatar-opt.sel { border-color:var(--primary,#e63950); }
    .ai-tone-list { display:flex;flex-direction:column;gap:6px;margin-top:4px; }
    .ai-tone-opt { display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:12px;border:1px solid transparent;cursor:pointer;background:var(--bg3);transition:border-color .15s; }
    .ai-tone-opt.sel { border-color:var(--primary,#e63950);background:rgba(230,57,80,.1); }
    .ai-tone-emoji { font-size:18px; }
    .ai-tone-label { font-size:14px;color:var(--text); }
  `;
  document.head.appendChild(s);
};

// --- Send message to AI ---
window._aiSend = async function() {
  const ta   = document.getElementById("aiChatInput");
  const text = ta?.value?.trim();
  if (!text || _aiTyping) return;
  if (!window.GROQ_API_KEY) { toast("Set window.GROQ_API_KEY to use the AI assistant"); return; }
  ta.value = "";
  ta.style.height = "auto";

  _aiMessages.push({ role: "user", text });
  _aiTyping = true;
  _aiRenderMessages();

  try {
    const history = _aiMessages.slice(-14).map((m) => ({
      role:    m.role === "ai" ? "assistant" : "user",
      content: m.text,
    }));
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method:  "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${window.GROQ_API_KEY}` },
      body: JSON.stringify({
        model:       window.GROQ_MODEL,
        messages:    [{ role: "system", content: getAIChatSystem() }, ...history],
        max_tokens:  280,
        temperature: 0.9,
      }),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error?.message || `API error ${res.status}`);
    }
    const data  = await res.json();
    const reply = data.choices?.[0]?.message?.content?.trim();
    if (!reply) throw new Error("Empty response from AI");
    _aiMessages.push({ role: "ai", text: reply });
  } catch (err) {
    _aiMessages.push({ role: "ai", text: `⚠️ ${err.message || "Something went wrong. Check your API key and try again."}` });
  }

  _aiTyping = false;
  _aiRenderMessages();
  await saveAIHistory(_aiMessages);
};

window._aiKeydown = function(e) {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); window._aiSend(); }
};

window._aiClear = async function() {
  if (!confirm(`Clear chat history with ${state.aiName}?`)) return;
  _aiMessages = [];
  await saveAIHistory([]);
  _aiRenderMessages();
};

// --- AI Settings modal ---
window._aiOpenSettings = function() {
  const overlay = el("div", { style: "position:fixed;inset:0;z-index:1500;background:rgba(0,0,0,.6);display:flex;align-items:flex-end;justify-content:center;", onclick: (e) => { if (e.target === overlay) overlay.remove(); } });
  const sheet = el("div", { style: "background:var(--bg2,#1a1a2e);border-radius:20px 20px 0 0;padding:20px 18px 32px;width:100%;max-width:480px;max-height:90dvh;overflow-y:auto;" });
  sheet.innerHTML = "";

  // Header
  sheet.appendChild(el("div", { style: "display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;" },
    el("h3", { style: "font-size:18px;font-weight:700;margin:0;" }, "✨ Customise AI"),
    el("button", { class: "icon-btn", onclick: () => overlay.remove() }, el("i", { class: "ri-close-line" })),
  ));
  sheet.appendChild(el("p", { style: "font-size:12px;color:var(--text3);margin:0 0 12px;" }, "Changes apply to new messages immediately."));

  // AI Name
  sheet.appendChild(el("div", { class: "ai-settings-section" }, "AI Name"));
  const nameInput = el("input", { class: "ai-name-input", type: "text", placeholder: "e.g. Aria, Nova, Rex…", value: state.aiName, maxlength: "24" });
  sheet.appendChild(nameInput);

  // Avatar
  sheet.appendChild(el("div", { class: "ai-settings-section" }, "Avatar"));
  const avatarGrid = el("div", { class: "ai-avatar-grid" });
  let _pendingAvatar = state.aiAvatar;
  AI_AVATARS.forEach((a) => {
    const opt = el("div", { class: `ai-avatar-opt${a === _pendingAvatar ? " sel" : ""}` }, a);
    opt.addEventListener("click", () => {
      _pendingAvatar = a;
      avatarGrid.querySelectorAll(".ai-avatar-opt").forEach((el2) => el2.classList.toggle("sel", el2.textContent === a));
    });
    avatarGrid.appendChild(opt);
  });
  sheet.appendChild(avatarGrid);

  // Tone
  sheet.appendChild(el("div", { class: "ai-settings-section" }, "Personality Tone"));
  const toneList = el("div", { class: "ai-tone-list" });
  let _pendingTone = state.aiTone;
  Object.entries(AI_TONES).forEach(([key, t]) => {
    const opt = el("div", { class: `ai-tone-opt${key === _pendingTone ? " sel" : ""}` },
      el("span", { class: "ai-tone-emoji" }, t.emoji),
      el("span", { class: "ai-tone-label" }, t.label),
    );
    opt.addEventListener("click", () => {
      _pendingTone = key;
      toneList.querySelectorAll(".ai-tone-opt").forEach((el2, i) => el2.classList.toggle("sel", Object.keys(AI_TONES)[i] === key));
    });
    toneList.appendChild(opt);
  });
  sheet.appendChild(toneList);

  // Save button
  const saveBtn = el("button", { class: "btn primary", style: "width:100%;margin-top:20px;", onclick: () => {
    const name = nameInput.value.trim() || "Aria";
    state.aiName   = name;
    state.aiAvatar = _pendingAvatar;
    state.aiTone   = _pendingTone;
    localStorage.setItem("vibe:ai_name",   state.aiName);
    localStorage.setItem("vibe:ai_avatar", state.aiAvatar);
    localStorage.setItem("vibe:ai_tone",   state.aiTone);
    overlay.remove();
    toast(`${state.aiAvatar} ${state.aiName} is ready!`);
    // Re-render AI chat if open
    const chatContent = document.getElementById("aiChatMessages");
    if (chatContent) renderAIChat(document.querySelector(".ai-chat-page")?.parentElement || document.getElementById("content"));
  }}, "Save Changes");
  sheet.appendChild(saveBtn);

  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
};

// --- Main AI Chat render ---
const renderAIChat = async (root) => {
  _aiInjectStyles();
  root.innerHTML = "";

  const toneInfo = AI_TONES[state.aiTone] || AI_TONES.friendly;
  const page = el("div", { class: "ai-chat-page" });

  // Header
  const header = el("div", { class: "ai-chat-header" },
    el("button", { class: "icon-btn", onclick: () => history.back() }, el("i", { class: "ri-arrow-left-line" })),
    el("div", { style: "width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,var(--grad-1,#e63950),var(--grad-2,#ff6b6b));display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;" }, state.aiAvatar),
    el("div", { style: "flex:1;min-width:0;" },
      el("div", { style: "font-weight:700;font-size:15px;" }, state.aiName),
      el("div", { style: "font-size:12px;color:var(--text3);" }, `${toneInfo.emoji} ${toneInfo.label}`),
    ),
    el("button", { class: "icon-btn", title: "Customise AI", onclick: () => window._aiOpenSettings() },
      el("i", { class: "ri-settings-3-line" }),
    ),
    el("button", { class: "icon-btn", title: "Clear chat", onclick: () => window._aiClear() },
      el("i", { class: "ri-delete-bin-line" }),
    ),
  );
  page.appendChild(header);

  // Messages area
  const messagesDiv = el("div", { class: "ai-chat-messages", id: "aiChatMessages" });
  messagesDiv.innerHTML = `<div style="text-align:center;padding:40px 20px;color:var(--text3);font-size:14px;">${state.aiAvatar}<br><br>Loading…</div>`;
  page.appendChild(messagesDiv);

  // Bottom input area
  const bottom = el("div", { class: "ai-chat-bottom" });
  const inputRow = el("div", { class: "ai-chat-input-row" });
  const textarea = el("textarea", {
    class: "ai-chat-textarea",
    id: "aiChatInput",
    placeholder: `Message ${state.aiName}…`,
    rows: "1",
    onkeydown: "window._aiKeydown(event)",
    oninput: "this.style.height='auto';this.style.height=this.scrollHeight+'px'",
  });
  const sendBtn = el("button", { class: "ai-chat-send-btn", onclick: () => window._aiSend() },
    el("i", { class: "ri-send-plane-fill", style: "font-size:18px;" }),
  );
  inputRow.appendChild(textarea);
  inputRow.appendChild(sendBtn);
  bottom.appendChild(inputRow);
  page.appendChild(bottom);
  root.appendChild(page);

  // Load history and render
  _aiMessages = await loadAIHistory();
  _aiTyping   = false;
  _aiRenderMessages();
};

// Expose so router can call it
window.renderAIChat = renderAIChat;

// =========================================================================
// 17. INIT
// =========================================================================
initTheme();
// Hide boot once auth state resolved (handled in onAuthStateChanged)
setTimeout(() => $("#boot").classList.add("hidden"), 1200);
