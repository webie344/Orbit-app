// =========================================================================
// Get better — app.js
// Firebase init + Auth + Cloudinary + Router + Feed + Groups +
// Profile + Settings + Theme + Verified-by-location.
// Chat + DM logic lives in chat.js (it imports state from this file).
// =========================================================================

import { sfxOrbit, sfxComment, sfxPost } from "./sounds.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut, GoogleAuthProvider,
  signInWithPopup, updateProfile, sendPasswordResetEmail,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  getFirestore, doc, setDoc, getDoc, updateDoc, addDoc, deleteDoc,
  collection, query, where, orderBy, limit, startAfter, onSnapshot, getDocs,
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

// ── Translation helper ────────────────────────────────────────────────────
// 1. Persists the language choice via the googtrans cookie (Google Translate
//    reads this cookie automatically on every page load).
// 2. Tries to trigger the Google Translate widget's <select> directly — with
//    InlineLayout.SIMPLE the combo is in the page DOM, not an iframe.
// 3. Falls back to a page reload only if the widget is not ready yet.
const orbitTranslate = (code) => {
  // Set / clear the persistence cookie (no domain= so it matches current host)
  if (code === "en") {
    document.cookie = "googtrans=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
    document.cookie = "googtrans=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=" + location.hostname;
  } else {
    const val = "/en/" + code;
    document.cookie = "googtrans=" + val + "; path=/;";
    document.cookie = "googtrans=" + val + "; path=/; domain=" + location.hostname;
  }

  // Try to drive the hidden widget select directly (no reload needed)
  const tryDirect = (attempts = 0) => {
    const combo = document.querySelector("#google_translate_element select");
    if (combo) {
      combo.value = code === "en" ? combo.options[0]?.value || "" : code;
      combo.dispatchEvent(new Event("change"));
    } else if (attempts < 25) {
      // Widget still initialising — retry up to ~2.5 s
      setTimeout(() => tryDirect(attempts + 1), 100);
    } else {
      // Widget never appeared — fall back to a full reload
      location.reload();
    }
  };
  tryDirect();
};

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
  aiName:   localStorage.getItem("orbit:ai_name")   || "Aria",
  aiAvatar: localStorage.getItem("orbit:ai_avatar") || "🤖",
  aiTone:   localStorage.getItem("orbit:ai_tone")   || "friendly",
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
  return `You are ${name}, an AI assistant built into Get better — a social platform. You are ${styles[tone] || styles.friendly}.
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

// Public URLs used when a post is shared outside Get better. Keep this as the
// public Vercel URL, not the current preview URL, so WhatsApp, Telegram and
// Google always receive the same crawlable address.
export const ORBIT_PUBLIC_ORIGIN = "https://orbit-appconnect.vercel.app";
export const postPublicUrl = (postId) =>
  `${ORBIT_PUBLIC_ORIGIN}/post/${encodeURIComponent(postId)}`;

const postMediaItems = (post) => {
  if (!post?.media) return [];
  return Array.isArray(post.media) ? post.media.filter(Boolean) : [post.media];
};

const firstPostMedia = (post) => postMediaItems(post)[0] || null;

const postPreviewImage = (post) => {
  const media = firstPostMedia(post);
  if (!media?.url) return `${ORBIT_PUBLIC_ORIGIN}/icon-512.png`;
  return media.type === "video" ? (_cloudPoster(media.url) || media.url) : media.url;
};

// Share the real image/video where the browser supports file sharing.
// Otherwise share the public post URL. The public URL is important because
// the Vercel /post/:id function supplies the post-specific preview metadata.
const sharePostExternally = async (post, author) => {
  const url = postPublicUrl(post.id);
  const text = (post.text || `A post by ${author?.name || "a Get better member"}`).trim();
  const media = firstPostMedia(post);

  if (navigator.share) {
    try {
      const shareData = { title: "A new gravity for your circles.", text, url };
      if (media?.url && navigator.canShare) {
        try {
          const response = await fetch(media.url, { mode: "cors" });
          const blob = await response.blob();
          const extension = media.type === "video" ? "mp4" : "jpg";
          const mime = blob.type || (media.type === "video" ? "video/mp4" : "image/jpeg");
          const file = new File([blob], `orbit-post-${post.id}.${extension}`, { type: mime });
          if (navigator.canShare({ files: [file] })) shareData.files = [file];
        } catch {
          // Sharing the public link still works when a media host blocks fetch.
        }
      }
      await navigator.share(shareData);
      return true;
    } catch (error) {
      if (error?.name === "AbortError") return false;
    }
  }

  try {
    await navigator.clipboard.writeText(url);
    toast("Post link copied");
    return false;
  } catch {
    window.prompt("Copy this Get better post link:", url);
    return false;
  }
};

const buildExternalShareActions = (post, author, close) => {
  const url = postPublicUrl(post.id);
  const text = (post.text || `A post by ${author?.name || "a Get better member"}`).trim();
  const encodedUrl = encodeURIComponent(url);
  const encodedText = encodeURIComponent(text);
  const actions = el("div", { class: "post-external-share" },
    el("div", { class: "post-external-share-title" }, "Share outside Get better"),
    el("div", { class: "post-external-share-grid" },
      el("button", {
        class: "post-external-share-btn",
        type: "button",
        onclick: async () => { await sharePostExternally(post, author); },
      }, el("i", { class: "ri-share-forward-line" }), el("span", {}, "Share")),
      el("a", {
        class: "post-external-share-btn whatsapp",
        href: `https://wa.me/?text=${encodedText}%20${encodedUrl}`,
        target: "_blank",
        rel: "noopener noreferrer",
        onclick: () => close(),
      }, el("i", { class: "ri-whatsapp-line" }), el("span", {}, "WhatsApp")),
      el("a", {
        class: "post-external-share-btn telegram",
        href: `https://t.me/share/url?url=${encodedUrl}&text=${encodedText}`,
        target: "_blank",
        rel: "noopener noreferrer",
        onclick: () => close(),
      }, el("i", { class: "ri-telegram-2-line" }), el("span", {}, "Telegram")),
      el("button", {
        class: "post-external-share-btn",
        type: "button",
        onclick: async () => {
          try {
            await navigator.clipboard.writeText(url);
            toast("Post link copied");
            close();
          } catch {
            window.prompt("Copy this Get better post link:", url);
          }
        },
      }, el("i", { class: "ri-link" }), el("span", {}, "Copy link")),
    ),
    el("small", {}, "Images and videos are attached when your device supports file sharing. Otherwise the link shows the post preview."),
  );
  return actions;
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

// Attaches an attached song to a post: plays/pauses in sync with visibility
// (image/carousel posts) or with the video's own play state (video posts).
// Plays automatically at a low background volume — no floating controls on
// the media itself (the video's own volume button already covers the
// clip's own audio; the song is a separate, quiet background layer). A
// small "now playing" badge is rendered in the post header instead — see
// _songHeaderBadge, used by renderPost.
//
// Note: browsers block unmuted autoplay until the user has interacted with
// the page at least once (tap/click/scroll anywhere counts) — same
// limitation TikTok/Instagram have. After that first interaction the song
// plays automatically as posts scroll into view.
const SONG_BG_VOLUME = 0.25;
function _wireSongPlayback(wrap, song, videoEl) {
  if (!song?.url) return;
  const audio = new Audio(song.url);
  audio.loop = true; audio.muted = false; audio.volume = SONG_BG_VOLUME; audio.preload = "none";
  if (videoEl) {
    videoEl.muted = true; // song is the only audio source for posts with music
    const DRIFT_TOLERANCE = 0.25; // seconds — resync once audio/video clocks drift past this
    const syncTime = () => { audio.currentTime = videoEl.currentTime % (audio.duration || 1e9); };
    // "play"/"pause" alone aren't enough: while the video stalls to buffer it
    // fires "waiting" (not "pause"), so the song kept advancing silently
    // ahead of the picture during any rebuffer. Pausing on "waiting" and
    // resyncing+resuming on "playing" keeps the song locked to what's
    // actually on screen, not just to whether playback was ever paused.
    videoEl.addEventListener("play", () => { syncTime(); audio.play().catch(() => {}); });
    videoEl.addEventListener("playing", () => { syncTime(); audio.play().catch(() => {}); });
    videoEl.addEventListener("waiting", () => audio.pause());
    videoEl.addEventListener("pause", () => audio.pause());
    videoEl.addEventListener("seeking", () => audio.pause());
    videoEl.addEventListener("seeked", () => { syncTime(); if (!videoEl.paused) audio.play().catch(() => {}); });
    // Independent clocks drift apart over long continuous playback even
    // without any stall — nudge back in sync whenever it exceeds tolerance.
    videoEl.addEventListener("timeupdate", () => {
      if (videoEl.paused || videoEl.seeking || !audio.duration) return;
      const drift = Math.abs(audio.currentTime - videoEl.currentTime);
      if (drift > DRIFT_TOLERANCE) syncTime();
    });
  } else {
    const io = new IntersectionObserver((entries) => {
      if (!document.body.contains(wrap)) { audio.pause(); io.disconnect(); return; }
      if (entries[0].isIntersecting) audio.play().catch(() => {}); else audio.pause();
    }, { threshold: 0.6 });
    io.observe(wrap);
  }
}

// Small "now playing" pill for the post header — icon + truncated song
// info, no controls. Rendered next to the follow/more button by renderPost.
function _songHeaderBadge(song) {
  if (!song?.name) return null;
  return el("div", {
    class: "post-song-badge",
    title: `${song.name} — ${song.artist}`,
    style: "display:inline-flex;align-items:center;gap:4px;font-size:11px;color:var(--text-mute);max-width:120px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;margin-right:6px;flex-shrink:0;",
  },
    el("i", { class: "ri-music-2-fill" }),
    el("span", { style: "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" }, `${song.name} — ${song.artist}`),
  );
}

const buildVideoPlayer = (url, opts = {}) => {
  const { song, overlays } = opts;
  const poster = _cloudPoster(url);
  // muted enables browser auto-play-on-scroll; user can unmute via the button
  const video = el("video", { src: url, poster, preload: "none", playsinline: "", style: "width:100%;display:block;" });
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
  const wrap      = el("div", { class: "vid-player", style: "width:100%;max-width:none;overflow:hidden;border-radius:14px;" }, video, overlay, bar);

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

  const togglePlay = () => { video.paused ? video.play() : video.pause(); };
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
  // Uses IntersectionObserver: starts playing when ≥50% visible, pauses when less.
  //
  // The actual mechanism, confirmed by the report that it's specifically
  // "frame freezes right as it starts, audio is already moving, and by the
  // end audio has finished while the picture hasn't caught up": that is the
  // signature of resuming video decode from a MID-STREAM position rather
  // than the start of the file. Video frames are only fully decodable from
  // a keyframe forward — most encoders only place a keyframe every ~1-2s
  // (a "GOP"). When you pause a video partway through and later call
  // .play() again from that same currentTime, the audio track can resume
  // instantly (any sample is playable on its own), but the video decoder
  // has to rewind to the last keyframe *before* that point and decode
  // forward through every frame in between before it can show anything —
  // on a phone-grade CPU that takes long enough that audio visibly gets
  // ahead, and if the decoder never fully catches up you keep watching
  // "old" frames for the rest of the clip while the audio plays at the
  // correct real-time pace.
  //
  // The fix isn't to buffer more or nudge the playback rate after the
  // fact — it's to never resume from a mid-file position at all. Every
  // time a video leaves the viewport we now pause it AND rewind it to 0,
  // so the next time it's played it always restarts from the file's very
  // first frame — which is always a keyframe — instead of reviving decode
  // from some arbitrary point deep in the last GOP.
  const HAVE_FUTURE_DATA = 3;
  let _pendingPlay = null, _wantPlaying = false, _ioDebounce = null, _readyListener = null;
  const _startPlayback = () => {
    _pendingPlay = video.play().catch(() => {}).finally(() => { _pendingPlay = null; if (!_wantPlaying) { video.pause(); video.currentTime = 0; } });
  };
  const _applyIntent = () => {
    if (_wantPlaying) {
      if (!video.paused || _pendingPlay || _readyListener) return;
      if (video.readyState >= HAVE_FUTURE_DATA) {
        _startPlayback();
      } else {
        // With preload="none" the browser hasn't fetched anything yet.
        // Call video.load() first — this kicks off a simultaneous audio+video
        // fetch from byte 0, so both codecs start together and stay in sync.
        // Without this the audio codec (lighter work) can finish buffering and
        // start playing while the video decoder is still seeking to the first
        // keyframe, producing the "sound plays, frozen frame" symptom.
        if (video.networkState === 0 /* NETWORK_EMPTY */ || video.networkState === 3 /* NETWORK_NO_SOURCE */) {
          video.load(); // initialise the media engine from scratch
        } else if (video.currentTime !== 0) {
          video.currentTime = 0; // ensure we start at a keyframe boundary
        }
        _readyListener = () => {
          video.removeEventListener("canplay", _readyListener);
          _readyListener = null;
          if (_wantPlaying) _startPlayback();
        };
        video.addEventListener("canplay", _readyListener);
      }
    } else {
      if (_readyListener) { video.removeEventListener("canplay", _readyListener); _readyListener = null; }
      if (!_pendingPlay) {
        video.pause();
        video.currentTime = 0;
        // With preload="none", unloading after scrolling away lets the browser
        // free the decode buffer entirely — next play() always starts cold from
        // frame 0 so audio/video are guaranteed to begin decoding together.
        video.load();
      }
    }
  };
  const _io = new IntersectionObserver((entries) => {
    _wantPlaying = entries[0].isIntersecting;
    clearTimeout(_ioDebounce);
    _ioDebounce = setTimeout(_applyIntent, 200);
  }, { threshold: 0.4 });
  _io.observe(wrap);

  // Mid-playback drift correction: even starting clean from 0, a slow
  // device can still fall behind mid-clip if it briefly can't decode as
  // fast as real time. Compare the timestamp of the frame actually on
  // screen against the audio/playback clock, and slow down briefly to let
  // rendering catch back up if it falls behind (not supported on Safari/
  // iOS — no requestVideoFrameCallback there — but the reset-to-0 fix
  // above is the primary one and works everywhere).
  if (typeof video.requestVideoFrameCallback === "function") {
    const DRIFT_START = 0.12, DRIFT_CLEAR = 0.03, CATCHUP_RATE = 0.75;
    let correcting = false, rvfcActive = false;
    const frameTick = (_now, metadata) => {
      if (video.paused || video.ended) { rvfcActive = false; return; }
      const drift = video.currentTime - (metadata.mediaTime ?? video.currentTime);
      if (!correcting && drift > DRIFT_START) { correcting = true; video.playbackRate = CATCHUP_RATE; }
      else if (correcting && drift < DRIFT_CLEAR) { correcting = false; video.playbackRate = 1; }
      video.requestVideoFrameCallback(frameTick);
    };
    video.addEventListener("play", () => { if (!rvfcActive) { rvfcActive = true; video.requestVideoFrameCallback(frameTick); } });
    video.addEventListener("pause", () => { correcting = false; video.playbackRate = 1; });
  }

  // Clean up observer if the player is ever removed from DOM
  video.addEventListener("emptied", () => { _io.disconnect(); if (_readyListener) video.removeEventListener("canplay", _readyListener); }, { once: true });

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
      overflow-y: auto;
      animation: vvFadeIn .18s ease;
    }
    @keyframes vvFadeIn { from { opacity:0; } to { opacity:1; } }
    .vv-modal {
      position: relative;
      display: flex; flex-direction: column; align-items: center;
      width: 100%; max-width: 900px; max-height: none;
      padding: 0 48px;
      box-sizing: border-box;
      overflow: visible;
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
      flex: none; overflow: visible;
    }
    .vv-media .vid-player {
      width: 100%; border-radius: 10px; overflow: hidden;
    }
    .vv-media .vid-player video {
      width: 100%; height: auto; max-height: none; object-fit: contain; background: transparent;
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

const profileCoverFor = (u) =>
  u?.coverURL || u?.coverUrl || u?.bannerURL || u?.bannerUrl || "";

export const fetchUser = async (uid) => {
  if (!uid) return null;
  if (state.cache.users.has(uid)) return state.cache.users.get(uid);
  const snap = await getDoc(doc(db, "users", uid));
  const data = snap.exists() ? { uid, ...snap.data() } : null;
  if (data) state.cache.users.set(uid, data);
  return data;
};

const resolveGroupMemberIds = async (raw = "") => {
  const tokens = [...new Set(raw.split(/[\s,]+/).map((value) => value.trim().replace(/^@/, "").toLowerCase()).filter(Boolean))];
  const ids = [];
  for (const token of tokens) {
    const byUsername = await getDocs(query(collection(db, "users"), where("username", "==", token), limit(1)));
    if (!byUsername.empty) {
      ids.push(byUsername.docs[0].id);
      continue;
    }
    const byEmail = await getDocs(query(collection(db, "users"), where("email", "==", token), limit(1)));
    if (!byEmail.empty) ids.push(byEmail.docs[0].id);
  }
  return [...new Set(ids)].filter((uid) => uid !== state.uid);
};

export const openGroupAdmin = async (groupId) => {
  const snap = await getDoc(doc(db, "groups", groupId));
  if (!snap.exists()) { toast("Group not found"); return; }
  const group = { id: groupId, ...snap.data() };
  if (!(group.admins || []).includes(state.uid) && group.ownerUid !== state.uid) {
    toast("Only group admins can manage this group");
    return;
  }

  const overlay = el("div", { class: "modal group-admin-modal" });
  const memberList = el("div", { class: "group-admin-members" });
  const nameInput = el("input", { type: "text", value: group.name || "", placeholder: "Group name" });
  const iconInput = el("input", { type: "file", accept: "image/*" });
  const currentIcon = el("img", { class: "group-admin-current-icon", src: group.iconUrl || group.photoURL || avatarFor({ uid: group.id }), alt: "Group picture" });
  const linkInput = el("input", { type: "url", value: group.groupLink || "", placeholder: "https://example.com/group" });
  const addInput = el("input", { type: "text", placeholder: "@username or email, separated by commas" });
  const close = () => overlay.remove();

  const paintMembers = async () => {
    memberList.innerHTML = "";
    const members = await Promise.all((group.members || []).map(fetchUser));
    members.filter(Boolean).forEach((member) => {
      const isOwner = member.uid === group.ownerUid;
      const row = el("div", { class: "group-admin-member" },
        el("img", { class: "avatar xs", src: avatarFor(member), alt: member.name || "Member" }),
        el("div", { class: "group-admin-member-meta" },
          el("strong", {}, member.name || "Member"),
          el("span", {}, `@${member.username || "user"}${isOwner ? " · Owner" : ""}`),
        ),
        !isOwner ? el("button", {
          class: "icon-btn",
          title: "Remove member",
          onclick: async () => {
            group.members = (group.members || []).filter((uid) => uid !== member.uid);
            await updateDoc(doc(db, "groups", group.id), { members: arrayRemove(member.uid) });
            toast("Member removed");
            paintMembers();
          },
        }, el("i", { class: "ri-user-unfollow-line" })) : null,
      );
      memberList.appendChild(row);
    });
    if (!memberList.children.length) memberList.appendChild(el("div", { class: "group-admin-empty" }, "No members yet."));
  };

  const saveLinkBtn = el("button", {
    class: "btn primary",
    onclick: async () => {
      const value = linkInput.value.trim();
      if (value && !/^https?:\/\//i.test(value)) {
        toast("Group links must start with http:// or https://");
        return;
      }
      await updateDoc(doc(db, "groups", group.id), { groupLink: value });
      group.groupLink = value;
      toast("Group link updated");
    },
  }, "Save link");

  const saveDetailsBtn = el("button", {
    class: "btn primary",
    onclick: async () => {
      const name = nameInput.value.trim();
      if (!name) { toast("Group name cannot be empty"); return; }
      const updates = { name };
      if (iconInput.files?.[0]) {
        saveDetailsBtn.disabled = true;
        saveDetailsBtn.textContent = "Uploading…";
        try {
          const uploaded = await uploadToCloudinary(iconInput.files[0], "image");
          updates.iconUrl = uploaded.url;
        } catch {
          saveDetailsBtn.disabled = false;
          saveDetailsBtn.textContent = "Save details";
          return;
        }
      }
      await updateDoc(doc(db, "groups", group.id), updates);
      Object.assign(group, updates);
      toast("Group details updated");
      saveDetailsBtn.disabled = false;
      saveDetailsBtn.textContent = "Save details";
      close();
      router();
    },
  }, "Save details");

  const addBtn = el("button", {
    class: "btn ghost",
    onclick: async () => {
      const ids = await resolveGroupMemberIds(addInput.value);
      if (!ids.length) { toast("No matching Get better members found"); return; }
      await updateDoc(doc(db, "groups", group.id), { members: arrayUnion(...ids) });
      group.members = [...new Set([...(group.members || []), ...ids])];
      addInput.value = "";
      toast(`${ids.length} member${ids.length === 1 ? "" : "s"} added`);
      paintMembers();
    },
  }, "Add members");

  overlay.appendChild(el("div", { class: "modal-card group-admin-card" },
    el("div", { class: "modal-head" },
      el("h3", {}, "Manage group"),
      el("button", { class: "icon-btn", onclick: close }, el("i", { class: "ri-close-line" })),
    ),
    el("div", { class: "group-admin-section" },
      el("div", { class: "group-admin-label" }, "Group profile"),
      currentIcon,
      nameInput,
      iconInput,
      saveDetailsBtn,
    ),
    el("div", { class: "group-admin-section" },
      el("div", { class: "group-admin-label" }, "Group link"),
      el("div", { class: "group-admin-inline" }, linkInput, saveLinkBtn),
    ),
    el("div", { class: "group-admin-section" },
      el("div", { class: "group-admin-label" }, "Add members"),
      el("div", { class: "group-admin-inline" }, addInput, addBtn),
      el("p", { class: "group-admin-help" }, "Admins can add members by Get better username or email."),
    ),
    el("div", { class: "group-admin-section" },
      el("div", { class: "group-admin-label" }, `Members (${(group.members || []).length})`),
      memberList,
    ),
  ));
  overlay.addEventListener("click", (event) => { if (event.target === overlay) close(); });
  document.body.appendChild(overlay);
  paintMembers();
};

export const setFollowState = async (uid, shouldFollow) => {
  if (!uid || uid === state.uid) return;
  const meRef = doc(db, "users", state.uid);
  const themRef = doc(db, "users", uid);
  const batch = writeBatch(db);
  batch.update(meRef, { following: shouldFollow ? arrayUnion(uid) : arrayRemove(uid) });
  batch.update(themRef, { followers: shouldFollow ? arrayUnion(state.uid) : arrayRemove(state.uid) });
  await batch.commit();
  state.me.following = shouldFollow
    ? [...new Set([...(state.me.following || []), uid])]
    : (state.me.following || []).filter((id) => id !== uid);
  state.cache.users.delete(uid);
  state.cache.users.delete(state.uid);
  if (shouldFollow) writeNotif(uid, "follow", {}).catch(() => {});
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
  const icon = $("#themeToggle")?.querySelector("i");
  if (icon) {
    icon.className = theme === "dark" ? "ri-sun-line"
                   : theme === "light" ? "ri-moon-line"
                   : "ri-contrast-2-line"; // glass
  }
};
const initTheme = () => applyTheme(localStorage.getItem("orbit:theme") || "light");
const toggleTheme = () => {
  const cur = document.documentElement.getAttribute("data-theme") || "dark";
  applyTheme(cur === "dark" ? "light" : cur === "light" ? "glass" : "dark");
};

// =========================================================================
// GET BETTER LOADER — branded spinner shown during async auth operations
// =========================================================================
const _injectOrbitLoaderStyles = (() => {
  let done = false;
  return () => {
    if (done) return; done = true;
    const s = document.createElement("style");
    s.textContent = `
      .orbit-loader-overlay {
        position: fixed; inset: 0; z-index: 9999;
        background: var(--bg, #0e0e1a);
        display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        gap: 20px;
        animation: orbitLoaderFadeIn .18s ease;
      }
      @keyframes orbitLoaderFadeIn { from { opacity: 0; } to { opacity: 1; } }
      .orbit-loader-ring {
        width: 56px; height: 56px;
        border-radius: 50%;
        border: 3px solid transparent;
        border-top-color: #6c63ff;
        border-right-color: #ff6b9d;
        animation: orbitSpin .85s linear infinite;
        position: relative;
      }
      .orbit-loader-ring::before {
        content: '';
        position: absolute; inset: 5px;
        border-radius: 50%;
        border: 2px solid transparent;
        border-top-color: rgba(108,99,255,.35);
        border-right-color: rgba(255,107,157,.35);
        animation: orbitSpin 1.4s linear infinite reverse;
      }
      @keyframes orbitSpin { to { transform: rotate(360deg); } }
      .orbit-loader-text {
        font-size: 13px; font-weight: 600; letter-spacing: .5px;
        background: linear-gradient(90deg, #6c63ff, #ff6b9d);
        -webkit-background-clip: text; -webkit-text-fill-color: transparent;
        background-clip: text;
      }
    `;
    document.head.appendChild(s);
  };
})();

let _orbitLoaderEl = null;
const showOrbitLoader = (label = "Signing in…") => {
  _injectOrbitLoaderStyles();
  if (_orbitLoaderEl) return;
  _orbitLoaderEl = el("div", { class: "orbit-loader-overlay" },
    el("div", { class: "orbit-loader-ring" }),
    el("div", { class: "orbit-loader-text" }, label),
  );
  document.body.appendChild(_orbitLoaderEl);
};
const hideOrbitLoader = () => {
  if (_orbitLoaderEl) { _orbitLoaderEl.remove(); _orbitLoaderEl = null; }
};

const showPostSuccess = () => {
  const existing = document.querySelector(".post-success-overlay");
  if (existing) existing.remove();
  const overlay = el("div", { class: "post-success-overlay" },
    el("div", { class: "post-success-card" },
      el("div", { class: "post-success-orbit" },
        el("span", {}, el("i", { class: "ri-check-line" })),
      ),
      el("h3", {}, "Your post is live"),
      el("p", {}, "Your Get better is growing. Keep sharing your world."),
    ),
  );
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add("is-visible"));
  setTimeout(() => {
    overlay.classList.remove("is-visible");
    setTimeout(() => overlay.remove(), 280);
  }, 2200);
};

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
  localStorage.setItem("orbit_onboarded", "1");
  $("#onboarding").classList.add("hidden");
  showAuth();
};

const showAuth = () => { hideOrbitLoader(); $("#auth").classList.remove("hidden"); $("#app").classList.add("hidden"); $("#boot").classList.add("hidden"); $("#onboarding").classList.add("hidden"); };
const showApp  = () => { hideOrbitLoader(); $("#auth").classList.add("hidden"); $("#app").classList.remove("hidden"); $("#boot").classList.add("hidden"); };

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
      birthday: null,
      birthdayAnnounceEnabled: false,
      birthdayAnnouncedYear: null,
      verified: false,                // becomes true after location grant
      verifiedAt: null,
      location: null,                 // { lat, lng, city }
      followers: [],
      following: [],
      privateAccount: false,
      showOnline: true,
      allowMessages: true,
      autoplayVideos: true,
      emailNotifications: true,
      hideSensitive: false,
      themePref: "dark",
      online: true,
      lastSeen: serverTimestamp(),
      createdAt: serverTimestamp(),
    };
    await setDoc(ref, profile);
    // Welcome notification for new users
    await addDoc(collection(db, "notifications", user.uid, "items"), {
      type: "welcome",
      text: `Welcome to Get better, ${profile.name.split(" ")[0]}! 👋 Explore groups, join spaces, and connect with people who share your interests.`,
      read: false,
      createdAt: serverTimestamp(),
    }).catch(() => {});
    return { ...profile, _isNew: true };
  }
  // mark online + lastSeen
  await updateDoc(ref, { online: true, lastSeen: serverTimestamp() });
  return { uid: user.uid, ...snap.data(), online: true };
};

const announceBirthdayIfDue = async () => {
  const uid = state.uid;
  if (!uid) return;
  const userRef = doc(db, "users", uid);
  const snap = await getDoc(userRef);
  if (!snap.exists()) return;
  const profile = { uid, ...snap.data() };
  const birthday = String(profile.birthday || "");
  if (!profile.birthdayAnnounceEnabled || !/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(birthday)) return;

  const now = new Date();
  const year = now.getFullYear();
  const today = `${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  if (birthday !== today || Number(profile.birthdayAnnouncedYear) === year) return;

  const followers = [...new Set((profile.followers || []).filter((followerUid) => followerUid && followerUid !== uid))];
  const notificationId = `birthday_${uid}_${year}`;
  if (!followers.length) {
    await updateDoc(userRef, { birthdayAnnouncedYear: year });
    state.me = { ...state.me, birthdayAnnouncedYear: year };
    return;
  }

  for (let offset = 0; offset < followers.length; offset += 400) {
    const batch = writeBatch(db);
    const chunk = followers.slice(offset, offset + 400);
    chunk.forEach((followerUid) => {
      batch.set(doc(db, "notifications", followerUid, "items", notificationId), {
        type: "birthday",
        fromUid: uid,
        profileUid: uid,
        text: `${profile.name || "Someone"} is celebrating a birthday today!`,
        read: false,
        createdAt: serverTimestamp(),
      });
    });
    if (offset + chunk.length >= followers.length) batch.update(userRef, { birthdayAnnouncedYear: year });
    await batch.commit();
  }
  state.me = { ...state.me, birthdayAnnouncedYear: year };
};

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    state.me = null; state.uid = null;
    if (!localStorage.getItem("orbit_onboarded")) { showOnboarding(); } else { showAuth(); }
    return;
  }
  // Show a branded loader while we fetch/create the user doc so the
  // screen is never blank between the boot screen disappearing and
  // the feed skeleton appearing (covers both first load and PWA reopen).
  showOrbitLoader("Loading Get better…");
  state.uid = user.uid;
  state.me = await ensureUserDoc(user);
  $("#meAvatar").src = avatarFor(state.me);
  showApp(); // calls hideOrbitLoader() internally
  announceBirthdayIfDue().catch((err) => console.warn("Birthday announcement failed:", err));
  startMyProfileListener();
  startNotifListener();
  startSuggestions();
  router(); // initial route
  watchOfflineOnUnload();
  // startNewsBot(); // kick off official news/sport/social bot (throttled to every 5 h)
  // Show a full-page setup guide for brand-new users; otherwise prompt incomplete profiles
  if (state.me._isNew) showOnboardingGuide();
  else checkProfileSetup();
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
    $("#forgotPasswordForm")?.classList.add("hidden");
    $("#signinForm").classList.remove("hidden");
  });
});

// "Create my account" inside the pre-signup onboard → reveal the real sign-up form
document.getElementById("onboardGetStarted")?.addEventListener("click", () => {
  $("#signupOnboard").classList.add("hidden");
  $("#signupForm").classList.remove("hidden");
});

$("#signinForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  showOrbitLoader("Signing in…");
  try {
    await signInWithEmailAndPassword(auth, fd.get("email"), fd.get("password"));
    // loader dismissed by showApp() → hideOrbitLoader() is called there
  } catch (err) {
    hideOrbitLoader();
    toast(err.message.replace("Firebase: ", ""));
  }
});

$("#forgotPasswordBtn")?.addEventListener("click", () => {
  $("#signinForm").classList.add("hidden");
  $("#forgotPasswordForm").classList.remove("hidden");
  const email = $("#signinForm").querySelector("[name=email]")?.value || "";
  const resetEmail = $("#forgotPasswordForm").querySelector("[name=email]");
  if (resetEmail) resetEmail.value = email;
});

$("#backToSigninBtn")?.addEventListener("click", () => {
  $("#forgotPasswordForm").classList.add("hidden");
  $("#signinForm").classList.remove("hidden");
});

$("#forgotPasswordForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = new FormData(e.target).get("email")?.toString().trim();
  if (!email) return;
  const button = e.target.querySelector("button[type=submit]");
  button.disabled = true;
  button.textContent = "Sending…";
  try {
    await sendPasswordResetEmail(auth, email);
    toast("Password reset link sent. Check your email.");
    e.target.reset();
    $("#forgotPasswordForm").classList.add("hidden");
    $("#signinForm").classList.remove("hidden");
  } catch (err) {
    toast(err.message.replace("Firebase: ", ""));
  } finally {
    button.disabled = false;
    button.textContent = "Send reset link";
  }
});

$("#signupForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const name = fd.get("name"), username = fd.get("username");
  showOrbitLoader("Creating your account…");
  try {
    const cred = await createUserWithEmailAndPassword(auth, fd.get("email"), fd.get("password"));
    await updateProfile(cred.user, { displayName: name });
    await ensureUserDoc(cred.user, { name, username });
  } catch (err) { hideOrbitLoader(); toast(err.message.replace("Firebase: ", "")); }
});

$("#googleBtn").addEventListener("click", async () => {
  showOrbitLoader("Connecting with Google…");
  try { await signInWithPopup(auth, new GoogleAuthProvider()); }
  catch (err) { hideOrbitLoader(); toast(err.message.replace("Firebase: ", "")); }
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
     const iconMap = { orbit:"ri-thumb-up-fill", follow:"ri-user-follow-fill", message:"ri-chat-1-fill", comment:"ri-chat-4-fill", commentLike:"ri-thumb-up-fill", groupMessage:"ri-group-2-fill", call:"ri-phone-fill", newPost:"ri-file-add-fill", postConfirm:"ri-checkbox-circle-fill", birthday:"ri-cake-2-fill" };
     const colMap  = { orbit:"#0866ff", follow:"var(--primary)", message:"var(--good)", comment:"var(--grad-3)", commentLike:"#0866ff", groupMessage:"var(--good)", call:"var(--primary)", newPost:"var(--grad-1)", postConfirm:"var(--good)", birthday:"var(--grad-2)" };
    snap.docs.forEach((d) => {
      const n = { id: d.id, ...d.data() };
      const ic = iconMap[n.type] || "ri-notification-3-fill";
      const co = colMap[n.type]  || "var(--primary)";
      const txt = n.text || (n.fromName || "Someone") + " " + ({ orbit:"liked your post", follow:"followed you", message:"sent you a message", comment:"commented on your post", commentLike:"liked your comment", groupMessage:"sent a message in your group", call:"called you", newPost:"shared a new post", postConfirm:"Your post is live!" }[n.type] || "interacted");
      const item = el("div", { class: "notif-item" + (n.read ? "" : " unread") },
        el("i", { class: ic, style: "color:" + co + ";font-size:20px;flex-shrink:0;margin-top:2px;" }),
        el("div", { style: "min-width:0;" }, el("div", { class: "ni-text" }, txt), el("div", { class: "ni-time" }, fmtTime(n.createdAt))),
      );
      item.addEventListener("click", () => {
        updateDoc(doc(db, "notifications", state.uid, "items", n.id), { read: true }).catch(() => {});
        panel.remove();
         if (n.type === "birthday" && (n.profileUid || n.fromUid)) location.hash = "#profile/" + (n.profileUid || n.fromUid);
         else if (n.type === "message" && n.fromUid) location.hash = "#chats/" + n.fromUid;
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

const router = () => {
  const hash = (location.hash || "#feed").replace(/^#/, "");
  const [route, ...rest] = hash.split("/");
  const target = routes.includes(route) ? route : "feed";
  const prevRoute = content._currentRoute;

  $$(".nav-item, .bn").forEach((b) => b.classList.toggle("active", b.dataset.route === target));

  // Hide bottom nav in post detail, restore on all other routes
  const _bnEl = document.querySelector(".bottomnav");
  if (_bnEl) _bnEl.classList.toggle("detail-hidden", target === "post");

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
      requestAnimationFrame(() => {
        // Disable smooth-scroll briefly so the position restores instantly
        // instead of animating visibly from the top.
        content.style.scrollBehavior = "auto";
        content.scrollTop = sy;
        requestAnimationFrame(() => { content.style.scrollBehavior = ""; });
      });
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
        document.dispatchEvent(new CustomEvent("orbit:open-chats", { detail: { peerUid: rest[0] || null } }));
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
    case "post":
      content._unsub = gb().renderVoiceDetail(content, rest[0]);
      break;
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

// ── Bottom nav auto-hide on scroll-down, show on scroll-up (Twitter style) ──
const _initBottomNavScroll = () => {
  const _bn = document.querySelector(".bottomnav");
  const _ct = document.getElementById("content");
  if (!_bn || !_ct) return;
  let _lastScrollY = 0;
  _ct.addEventListener("scroll", () => {
    const y  = _ct.scrollTop;
    const dy = y - _lastScrollY;
    if (Math.abs(dy) < 5) return;
    if (dy > 0 && y > 80) _bn.classList.add("bn-hidden");
    else                   _bn.classList.remove("bn-hidden");
    _lastScrollY = y;
  }, { passive: true });
};
setTimeout(_initBottomNavScroll, 700);
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
        ? "Get better & comment on posts to discover who you vibe with today."
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
// Infinite scroll: first page via onSnapshot (live), subsequent pages via
// getDocs + startAfter cursor — loads more as you reach the bottom, just
// like X / Instagram / Facebook.
// =========================================================================
const FEED_PAGE_SIZE = 20;

const renderFeed = (root) => {
  const unsub = gb().renderVoiceFeed(root);
  _feedUnsub  = unsub;
  root._unsub = unsub;
};

// ── Feed scroll-to-play ───────────────────────────────────────────────────
// Observes <video> elements directly (not the vid-player wrapper) so the
// observer works even before the poster loads (wrapper has 0 height until then).
let _feedVidIO = null;
const _setupFeedVideoScroll = (list) => {
  // Disconnect previous observer so removed elements don't accumulate
  if (_feedVidIO) { _feedVidIO.disconnect(); _feedVidIO = null; }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      const v = e.target;
      if (e.isIntersecting) {
        if (state.me?.autoplayVideos !== false) v.play().catch(() => {});
      } else {
        v.pause();
        v.currentTime = 0;
      }
    });
  }, { threshold: 0.4 });
  _feedVidIO = io;
  // Observe all videos already in the list
  list.querySelectorAll("video").forEach((v) => { io.observe(v); });
  // Watch for videos added later (lazy suggestion cards, etc.)
  const mo = new MutationObserver(() => {
    list.querySelectorAll("video:not([data-fvio])").forEach((v) => {
      v.setAttribute("data-fvio", "1");
      io.observe(v);
    });
  });
  mo.observe(list, { childList: true, subtree: true });
};

const renderTrendingCard = (p, author) => {
  return el("div", { class: "trending-card", onclick: () => location.hash = `#feed` /* stays; could open detail */ },
    el("div", { class: "t-head" },
      el("img", { class: "avatar xs", src: avatarFor(author), onclick: (e) => { e.stopPropagation(); location.hash = `#profile/${author?.uid}`; } }),
      el("div", { class: "t-name" }, author?.name || "User"),
    ),
    el("div", { class: "t-text", text: (p.text || "").slice(0, 140) }),
    el("div", { class: "t-meta" },
      el("i", { class: "ri-fire-fill", style: "color: var(--grad-2);" }),
      `${p.orbitCount || 0} Orbits · ${fmtTime(p.createdAt)}`
    ),
  );
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
        player.style.borderRadius = "14px";
        stack.appendChild(player);
      } else {
        const img = el("img", {
          src: m.url, loading: "lazy",
          style: "width:100%;display:block;max-height:520px;object-fit:cover;cursor:zoom-in;border-radius:0;",
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
      player.style.borderRadius = "14px";
      const wrap = el("div", { class: "post-media", style: "border-radius:14px;overflow:hidden;margin:8px 0;" });
      wrap.appendChild(player);
      return wrap;
    }
    const _imgStyle = "width:100%;display:block;max-height:520px;object-fit:cover;" + (detailView ? "cursor:zoom-in;" : "");
    const singleImg = el("img", { src: m.url, loading: "lazy", style: _imgStyle });
    if (detailView) singleImg.addEventListener("click", () => openImageZoom(m.url));
    const wrap = el("div", { class: "post-media", style: "border-radius:14px;overflow:hidden;margin:8px 0;" }, singleImg);
    if (song) _wireStandaloneSong(wrap);
    return wrap;
  }

  // ── 2 items: side-by-side ──────────────────────────────────────
  if (items.length === 2) {
    const grid = el("div", {
      class: "post-media",
      style: "display:grid;grid-template-columns:1fr 1fr;gap:3px;border-radius:14px;overflow:hidden;height:260px;margin:8px 0;position:relative;",
    });
    items.forEach((m, i) => grid.appendChild(_makeGridCell(m, false, items, i, postId)));
    if (song) _wireStandaloneSong(grid);
    return grid;
  }

  // ── 3 items: 1 large left + 2 stacked right ────────────────────
  if (items.length === 3) {
    const grid = el("div", {
      class: "post-media",
      style: "display:grid;grid-template-columns:2fr 1fr;grid-template-rows:130px 130px;gap:3px;border-radius:14px;overflow:hidden;margin:8px 0;position:relative;",
    });
    items.forEach((m, i) => grid.appendChild(_makeGridCell(m, i === 0, items, i, postId)));
    if (song) _wireStandaloneSong(grid);
    return grid;
  }

  // ── 4+ items: Facebook-style 2×2 grid with "+N more" overflow ─
  const show = items.slice(0, 4);
  const overflow = items.length - 4;
  const grid = el("div", {
    class: "post-media",
    style: "display:grid;grid-template-columns:1fr 1fr;grid-template-rows:130px 130px;gap:3px;border-radius:14px;overflow:hidden;margin:8px 0;position:relative;",
  });
  show.forEach((m, i) => {
    const cell = _makeGridCell(m, false, items, i, postId);
    if (i === 3 && overflow > 0) {
      const moreOverlay = el("div", {
        style: "position:absolute;inset:0;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;cursor:pointer;",
        onclick: (e) => { e.stopPropagation(); if (postId) location.hash = `#post/${postId}`; },
      }, el("span", {
        style: "color:#fff;font-size:22px;font-weight:700;font-family:var(--font-display);letter-spacing:-0.02em;",
      }, `+${overflow}`));
      cell.appendChild(moreOverlay);
    }
    grid.appendChild(cell);
  });
  if (song) _wireStandaloneSong(grid);
  return grid;
};

const postIsHidden = (p) => (state.me?.hiddenPosts || []).includes(p.id);

const removePostFromView = (postId) => {
  const node = document.querySelector(`.tfb-post[data-post-id="${postId}"]`);
  if (!node) return;
  node.classList.add("post-dismissed");
  setTimeout(() => node.remove(), 320);
};

const openPostShareModal = async (p, author) => {
  const overlay = el("div", { class: "post-share-overlay" });
  const card = el("div", { class: "post-share-card" });
  const close = () => {
    overlay.classList.remove("is-visible");
    setTimeout(() => overlay.remove(), 220);
  };
  const selected = new Set();
  const list = el("div", { class: "post-share-list" },
    el("div", { class: "post-share-loading" }, el("i", { class: "ri-loader-4-line" }), " Loading your chats…"),
  );
  const sendBtn = el("button", { class: "btn primary block", disabled: true }, el("i", { class: "ri-send-plane-fill" }), " Send post");
  const updateSendState = () => { sendBtn.disabled = selected.size === 0; };

  const addTarget = (target) => {
    const row = el("button", { class: "post-share-target", type: "button" });
    row._target = target;
    const check = el("span", { class: "post-share-check" }, el("i", { class: "ri-check-line" }));
    row.append(
      target.kind === "group"
        ? el("img", { class: "avatar sm", src: target.iconUrl || `https://api.dicebear.com/7.x/shapes/svg?seed=${target.id}` })
        : el("img", { class: "avatar sm", src: avatarFor(target.peer) }),
      el("span", { class: "post-share-target-info" },
        el("strong", {}, target.name),
        el("small", {}, target.kind === "group" ? `${(target.members || []).length} members` : `@${target.peer?.username || "user"}`),
      ),
      check,
    );
    row.onclick = () => {
      if (selected.has(target.key)) { selected.delete(target.key); row.classList.remove("selected"); }
      else { selected.add(target.key); row.classList.add("selected"); }
      updateSendState();
    };
    list.appendChild(row);
  };

  sendBtn.onclick = async () => {
    sendBtn.disabled = true;
    sendBtn.innerHTML = '<i class="ri-loader-4-line"></i> Sharing…';
    const targets = [...list.querySelectorAll(".post-share-target.selected")].map((row) => row._target).filter(Boolean);
    try {
      const body = {
        authorUid: state.uid,
        type: "forwarded",
        forwarded: true,
        forwardPostId: p.id,
        forwardText: p.text || "",
        forwardAuthorUid: p.authorUid,
        forwardAuthorName: author?.name || "Get better member",
        forwardKind: "post",
        text: p.text || "Shared a post",
        media: p.media || null,
        createdAt: serverTimestamp(),
        readBy: [state.uid],
      };
      await Promise.all(targets.map(async (target) => {
        if (target.kind === "group") {
          await addDoc(collection(db, "groups", target.id, "messages"), body);
          await updateDoc(doc(db, "groups", target.id), {
            lastMessage: `Shared a post by ${author?.name || "a Get better member"}`,
            lastMessageAt: serverTimestamp(),
          }).catch(() => {});
        } else {
          const chatId = [state.uid, target.peer.uid].sort().join("__");
          const myRef = doc(db, "users", state.uid, "chats", chatId);
          const theirRef = doc(db, "users", target.peer.uid, "chats", chatId);
          await addDoc(collection(db, "chats", chatId, "messages"), body);
          await Promise.all([
            setDoc(myRef, {
              peerUid: target.peer.uid, lastMessage: "Shared a post", lastFromMe: true,
              unread: 0, updatedAt: serverTimestamp(), createdAt: serverTimestamp(),
            }, { merge: true }),
            setDoc(theirRef, {
              peerUid: state.uid, lastMessage: "Shared a post", lastFromMe: false,
              unread: increment(1), updatedAt: serverTimestamp(), createdAt: serverTimestamp(),
            }, { merge: true }),
          ]);
          writeNotif(target.peer.uid, "message", { text: `${state.me?.name || "Someone"} shared a post with you` }).catch(() => {});
        }
      }));
      toast(`Shared to ${targets.length} chat${targets.length === 1 ? "" : "s"}`);
      close();
    } catch (err) {
      toast("Could not share this post");
      sendBtn.disabled = false;
      sendBtn.innerHTML = '<i class="ri-send-plane-fill"></i> Send post';
    }
  };

  card.append(
    el("div", { class: "post-share-head" },
      el("div", {}, el("h3", {}, "Share post"), el("p", {}, `Send ${author?.name || "this member"}’s post to your Get better`)),
      el("button", { class: "icon-btn", onclick: close }, el("i", { class: "ri-close-line" })),
    ),
    el("div", { class: "post-share-preview" },
      el("img", { class: "avatar sm", src: avatarFor(author) }),
      el("span", {}, (p.text || "Shared post").slice(0, 100)),
    ),
    buildExternalShareActions(p, author, close),
    list,
    sendBtn,
  );
  overlay.appendChild(card);
  overlay.onclick = (e) => { if (e.target === overlay) close(); };
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add("is-visible"));

  try {
    const [groupSnap, dmSnap] = await Promise.all([
      getDocs(query(collection(db, "groups"), where("members", "array-contains", state.uid), limit(80))),
      getDocs(query(collection(db, "users", state.uid, "chats"), orderBy("updatedAt", "desc"), limit(80))),
    ]);
    list.innerHTML = "";
    groupSnap.docs.forEach((d) => {
      const g = { id: d.id, ...d.data(), kind: "group", key: `group:${d.id}` };
      g.name = g.name || "Group";
      g.iconUrl = g.iconUrl || g.photoURL || "";
      addTarget(g);
      list.lastElementChild._target = g;
    });
    const peers = await Promise.all(dmSnap.docs.map(async (d) => {
      const data = d.data();
      const peer = await fetchUser(data.peerUid);
      return peer ? { ...data, peer, kind: "dm", key: `dm:${peer.uid}`, name: peer.name || "User" } : null;
    }));
    peers.filter(Boolean).forEach((target) => { addTarget(target); list.lastElementChild._target = target; });
    if (!list.children.length) list.appendChild(el("div", { class: "post-share-empty" }, "Join a group or start a chat to share posts."));
  } catch {
    list.innerHTML = "";
    list.appendChild(el("div", { class: "post-share-empty" }, "Could not load your chats."));
  }
};

const openPostMenu = (p, author, isMine) => {
  const overlay = el("div", { class: "post-menu-overlay" });
  const sheet = el("div", { class: "post-menu-sheet" });
  const close = () => { sheet.classList.remove("is-visible"); setTimeout(() => overlay.remove(), 220); };
  const action = (icon, label, handler, danger = false) => {
    const btn = el("button", { class: `post-menu-action${danger ? " danger" : ""}`, onclick: async () => { close(); await handler(); } },
      el("i", { class: icon }), el("span", {}, label));
    sheet.appendChild(btn);
  };
  action("ri-share-forward-line", "Share to chats", () => openPostShareModal(p, author));
  const isSaved = (state.me?.saved || []).includes(p.id);
  action(isSaved ? "ri-bookmark-fill" : "ri-bookmark-line",
    isSaved ? "Remove from Saved" : "Save post",
    () => toggleSave(p.id, !isSaved));
  if (!isMine) {
    action("ri-eye-off-line", "Not interested — hide this post", async () => {
      await updateDoc(doc(db, "users", state.uid), { hiddenPosts: arrayUnion(p.id) });
      state.me.hiddenPosts = [...new Set([...(state.me.hiddenPosts || []), p.id])];
      removePostFromView(p.id);
      toast("You won’t see this post again");
    });
  } else {
    action("ri-delete-bin-line", "Delete post", async () => {
      if (!confirm("Delete this post for everyone?")) return;
      await deleteDoc(doc(db, "posts", p.id));
      removePostFromView(p.id);
      toast("Post deleted");
    }, true);
  }
  action("ri-links-line", "Copy post link", async () => {
    const url = `${location.origin}${location.pathname}#post/${p.id}`;
    await navigator.clipboard.writeText(url);
    toast("Link copied");
  });
  overlay.appendChild(sheet);
  overlay.onclick = (e) => { if (e.target === overlay) close(); };
  document.body.appendChild(overlay);
  requestAnimationFrame(() => sheet.classList.add("is-visible"));
};

const renderPost = (p, author, opts = {}) => {
  const iOrbited = (p.orbits || []).includes(state.uid);
  const isMine = p.authorUid === state.uid;
  const { hideComments = false, detailView: _detailView = false } = opts;
  let _isFollowingAuthor = !isMine && (state.me?.following || []).includes(author?.uid);

  // View-count tracking: count once per session per post (skip own posts)
  if (!isMine && p.id) {
    if (!state._viewedPosts) state._viewedPosts = new Set();
    if (!state._viewedPosts.has(p.id)) {
      state._viewedPosts.add(p.id);
      updateDoc(doc(db, "posts", p.id), { views: increment(1) }).catch(() => {});
    }
  }

  const post = el("article", { class: "tfb-post", data: { postId: p.id } });

  // ── Header: avatar ring + name + timestamp + menu ────────────────
  const menuBtn = el("button", { class: "icon-btn tfb-menu", onclick: (e) => {
    e.stopPropagation();
    openPostMenu(p, author, isMine);
  }}, el("i", { class: "ri-more-2-line" }));

  const header = el("div", { class: "tfb-header" },
    el("div", {
      class: "tfb-avatar-ring",
      onclick: (e) => { e.stopPropagation(); location.hash = `#profile/${author?.uid}`; },
    },
      el("img", { src: avatarFor(author) }),
    ),
    el("div", { class: "tfb-header-text" },
      el("span", { class: "tfb-name" },
        author?.name || "User",
        author?.verified
          ? el("span", { class: "verified", html: '<i class="ri-check-line"></i>' })
          : null,
      ),
      el("div", { class: "tfb-sub-row" },
        el("span", { class: "tfb-sub" }, `@${author?.username || "user"} · ${fmtTime(p.createdAt)}`),
        p.isSponsored ? el("span", { class: "tfb-sponsored-pill" }, el("i", { class: "ri-advertisement-line" }), "Sponsored") : null,
      ),
    ),
    !isMine && author?.uid
      ? el("button", {
          class: `post-follow-btn${_isFollowingAuthor ? " following" : ""}`,
          onclick: async (e) => {
            e.stopPropagation();
            const btn = e.currentTarget;
            const previous = _isFollowingAuthor;
            _isFollowingAuthor = !_isFollowingAuthor;
            btn.textContent = _isFollowingAuthor ? "Following" : "Follow";
            btn.classList.toggle("following", _isFollowingAuthor);
            btn.disabled = true;
            try {
              await setFollowState(author.uid, _isFollowingAuthor);
            } catch {
              _isFollowingAuthor = previous;
              btn.textContent = _isFollowingAuthor ? "Following" : "Follow";
              btn.classList.toggle("following", _isFollowingAuthor);
              toast("Could not update follow status");
            } finally {
              btn.disabled = false;
            }
          },
        }, _isFollowingAuthor ? "Following" : "Follow")
      : null,
    menuBtn,
    el("div", { class: "tfb-tail" }),
  );
  post.appendChild(header);

  // ── Kind badge for build / project posts ─────────────────────────
  if (p.kind === "build" || p.k