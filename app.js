// =========================================================================
// Orbit — app.js
// Firebase init + Auth + Cloudinary + Router + Feed + Groups +
// Profile + Settings + Theme + Verified-by-location.
// Chat + DM logic lives in chat.js (it imports state from this file).
// =========================================================================
import { mountAvatarSettingsCard, openAvatarCustomiser } from "./customisation.js";
import { sfxOrbit, sfxComment, sfxPost } from "./sounds.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut, GoogleAuthProvider,
  signInWithPopup, updateProfile, sendPasswordResetEmail,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  getFirestore, doc, setDoc, getDoc, updateDoc, addDoc, deleteDoc, runTransaction,
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

// Public URLs used when a post is shared outside Orbit. Keep this as the
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
  if (!media?.url) return `${ORBIT_PUBLIC_ORIGIN}/orbit.png`;
  return media.type === "video" ? (_cloudPoster(media.url) || media.url) : media.url;
};

// Share the real image/video where the browser supports file sharing.
// Otherwise share the public post URL. The public URL is important because
// the Vercel /post/:id function supplies the post-specific preview metadata.
const sharePostExternally = async (post, author) => {
  const url = postPublicUrl(post.id);
  const text = (post.text || `A post by ${author?.name || "an Orbit member"}`).trim();
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
    window.prompt("Copy this Orbit post link:", url);
    return false;
  }
};

const buildExternalShareActions = (post, author, close) => {
  const url = postPublicUrl(post.id);
  const text = (post.text || `A post by ${author?.name || "an Orbit member"}`).trim();
  const encodedUrl = encodeURIComponent(url);
  const encodedText = encodeURIComponent(text);
  const actions = el("div", { class: "post-external-share" },
    el("div", { class: "post-external-share-title" }, "Share outside Orbit"),
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
            window.prompt("Copy this Orbit post link:", url);
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

const MAX_GROUP_MEMBERS = 50;

const changeGroupMembers = async (groupId, { add = [], remove = [] } = {}) => runTransaction(db, async (transaction) => {
  const ref = doc(db, "groups", groupId);
  const snapshot = await transaction.get(ref);
  if (!snapshot.exists()) throw new Error("Group not found");
  const current = [...new Set(snapshot.data().members || [])];
  const removed = new Set(remove.filter(Boolean));
  const remaining = current.filter((uid) => !removed.has(uid));
  const additions = [...new Set(add.filter(Boolean))].filter((uid) => !remaining.includes(uid));
  if (additions.length && remaining.length + additions.length > MAX_GROUP_MEMBERS) {
    throw new Error(`Groups can have at most ${MAX_GROUP_MEMBERS} members.`);
  }
  const updated = [...remaining, ...additions];
  if (updated.length !== current.length || updated.some((uid, index) => uid !== current[index])) {
    transaction.update(ref, { members: updated, memberCount: updated.length });
  }
  return updated;
});

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
            try {
              group.members = await changeGroupMembers(group.id, { remove: [member.uid] });
              toast("Member removed");
              paintMembers();
            } catch (error) {
              toast(error?.message || "Could not remove member");
            }
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
      if (!ids.length) { toast("No matching Orbit members found"); return; }
      const before = (group.members || []).length;
      try {
        group.members = await changeGroupMembers(group.id, { add: ids });
      } catch (error) {
        toast(error?.message || "Could not add members");
        return;
      }
      const added = group.members.length - before;
      if (!added) { toast("Those members are already in the group"); return; }
      addInput.value = "";
      toast(`${added} member${added === 1 ? "" : "s"} added`);
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
      el("p", { class: "group-admin-help" }, "Admins can add members by Orbit username or email."),
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
// ORBIT LOADER — branded spinner shown during async auth operations
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
      el("p", {}, "Your Orbit is growing. Keep sharing your world."),
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
      friends: [],
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
      text: `Welcome to Orbit, ${profile.name.split(" ")[0]}! 👋 Explore groups, join spaces, and connect with people who share your interests.`,
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
  showOrbitLoader("Loading Orbit…");
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
  startNewsBot(); // kick off official news/sport/social bot (throttled to every 5 h)
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
const routes = ["feed", "chats", "friends", "ai-chat", "groups", "explore", "saved", "settings", "profile", "post", "profile-u", "spaces", "challenges", "mentorship", "notifications", "learn"];

// Feed DOM caching — lets us restore the feed instantly when navigating
// back from a post without re-rendering or re-shuffling.
let _feedScrollY = 0;
let _feedCachedNode = null; // detached feed DOM preserved during post visit
let _feedUnsub = null;      // kept alive so the cached node stays fresh

const router = () => {
  content._routeRenderToken = (content._routeRenderToken || 0) + 1;
  ["_profileCleanup", "_friendsCleanup"].forEach((key) => {
    if (content[key]) content[key]();
    content[key] = null;
  });
  const hash = (location.hash || "#feed").replace(/^#/, "");
  const [route, ...rest] = hash.split("/");
  const target = routes.includes(route) ? route : "feed";
  document.body.classList.toggle("groups-experience-active", target === "groups");
  document.body.classList.toggle("groups-room-active", target === "groups" && !!rest[0]);
  const prevRoute = content._currentRoute;

  $$(".nav-item, .bn").forEach((b) => b.classList.toggle("active", b.dataset.route === target));

  // Hide bottom nav in detail views, including the group member room.
  const _bnEl = document.querySelector(".bottomnav");
  if (_bnEl) _bnEl.classList.toggle("detail-hidden", target === "post" || (target === "groups" && !!rest[0]));

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

  if (content._groupCityCleanup) { content._groupCityCleanup(); content._groupCityCleanup = null; }
  if (content._groupRoomCleanup) { content._groupRoomCleanup(); content._groupRoomCleanup = null; }
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
    case "friends":    renderFriends(content, rest[0] || null); break;
    case "ai-chat":    renderAIChat(content); break;
    case "groups":     rest[0] ? renderGroupRoom(content, rest[0]) : renderGroups(content); break;
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
// Infinite scroll: first page via onSnapshot (live), subsequent pages via
// getDocs + startAfter cursor — loads more as you reach the bottom, just
// like X / Instagram / Facebook.
// =========================================================================
const FEED_PAGE_SIZE = 20;

const renderFeed = (root) => {
  const wrap = el("div", { class: "feed-wrap" });

  // Single unified feed — no tab switching
  const feedMainContent = el("div", { class: "feed-main-content" });
  wrap.appendChild(feedMainContent);

  // Posts container — show shimmer skeleton cards while Firestore loads
  const list = el("div", { class: "tfb-feed feed-list" });
  const _makeFeedSkel = () => el("div", { class: "feed-skel-post" },
    el("div", { class: "feed-skel-head" },
      el("div", { class: "feed-skel-avatar" }),
      el("div", { class: "feed-skel-meta" },
        el("div", { class: "feed-skel-line w55" }),
        el("div", { class: "feed-skel-line w28" }),
      ),
    ),
    el("div", { class: "feed-skel-body" },
      el("div", { class: "feed-skel-line w100" }),
      el("div", { class: "feed-skel-line w85" }),
      el("div", { class: "feed-skel-line w70" }),
    ),
    el("div", { class: "feed-skel-media" }),
    el("div", { class: "feed-skel-actions" },
      el("div", { class: "feed-skel-action w40", style: "width:60px;" }),
      el("div", { class: "feed-skel-action w40", style: "width:60px;" }),
      el("div", { class: "feed-skel-action w40", style: "width:60px;" }),
    ),
  );
  [1,2,3,4].forEach(() => list.appendChild(_makeFeedSkel()));
  feedMainContent.appendChild(list);
  root.appendChild(wrap);

  // ── Pagination state ────────────────────────────────────────────────────
  let _lastDoc      = null;        // Firestore cursor: last doc of previous page
  let _loadingMore  = false;       // prevents concurrent fetches
  let _allLoaded    = false;       // true when a page returns < PAGE_SIZE docs
  let _renderedIds  = new Set();   // deduplicates posts across pages
  let _suggShown    = 0;           // keeps suggestion-card counter continuous

  const _suggTypes  = ["people", "groups", "spaces"];
  const _following  = state.me?.following  || [];
  const _interests  = state.me?.interests  || [];

  // ── Sentinel element observed by IntersectionObserver ──────────────────
  // Sits at the very bottom of the list; when it enters the viewport we
  // fire the next page fetch automatically — no "load more" button needed.
  const sentinel = el("div", { class: "feed-sentinel",
    style: "height:56px;display:flex;align-items:center;justify-content:center;padding:8px 0;" });

  // ── Score a single post (called once per post before sorting) ──────────
  const _scorePost = (p) => {
    let s = 0;
    if (_following.includes(p.authorUid)) s += 50;
    if (_interests.some((tag) => (p.hashtags || []).includes(tag))) s += 30;
    s += Math.min((p.orbitCount || 0) * 2 + (p.commentCount || 0), 30);
    s += Math.max(0, 20 - Math.floor(((Date.now() - (p.createdAt?.toMillis?.() || Date.now())) / 3600000)));
    s += Math.random() * 15; // jitter — scored once so sort is stable
    return s;
  };

  // ── Append a batch of posts into the list (before the sentinel) ─────────
  const _appendPosts = (posts, byUid) => {
    // Deduplicate, score once each, then sort
    const fresh = posts.filter((p) => !_renderedIds.has(p.id) && !postIsHidden(p));
    const scored = fresh.map((p) => ({ p, score: _scorePost(p) }));
    scored.sort((a, b) => b.score - a.score);

    scored.forEach(({ p }) => {
      const globalIdx = _renderedIds.size; // index before adding this post
      _renderedIds.add(p.id);

      const postEl = renderPost(p, byUid[p.authorUid], { hideComments: true });
      const divEl  = el("div", { class: "tfb-divider" });

      // Insert before sentinel so it stays at the bottom
      if (sentinel.parentNode === list) {
        list.insertBefore(postEl, sentinel);
        list.insertBefore(divEl,  sentinel);
      } else {
        list.appendChild(postEl);
        list.appendChild(divEl);
      }

      // Suggestion card at position 4, then every 7 posts after that
      if (globalIdx === 4 || (globalIdx > 4 && (globalIdx - 4) % 7 === 0)) {
        const type   = _suggTypes[_suggShown % 3];
        _suggShown++;
        const suggEl = type === "people" ? renderInlinePeopleSuggestion()
                     : type === "groups" ? renderInlineGroupSuggestion()
                     :                     renderInlineSpaceSuggestion();
        if (sentinel.parentNode === list) list.insertBefore(suggEl, sentinel);
        else                              list.appendChild(suggEl);
      }
    });

    _setupFeedVideoScroll(list);
  };

  // ── Load next page via cursor ───────────────────────────────────────────
  const _loadMore = async () => {
    if (_loadingMore || _allLoaded || !_lastDoc) return;
    _loadingMore = true;

    // Show spinner inside sentinel while fetching
    sentinel.innerHTML = "";
    sentinel.appendChild(el("div", { class: "feed-skel-line",
      style: "width:32px;height:32px;border-radius:50%;" }));

    try {
      const moreSnap = await getDocs(
        query(collection(db, "posts"), orderBy("createdAt", "desc"),
              startAfter(_lastDoc), limit(FEED_PAGE_SIZE))
      );

      if (moreSnap.empty || moreSnap.docs.length < FEED_PAGE_SIZE) {
        _allLoaded = true;
      }

      if (!moreSnap.empty) {
        _lastDoc = moreSnap.docs[moreSnap.docs.length - 1];
        const posts   = moreSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const uids    = [...new Set(posts.map((p) => p.authorUid))];
        const authors = await Promise.all(uids.map(fetchUser));
        const byUid   = Object.fromEntries(authors.filter(Boolean).map((u) => [u.uid, u]));
        _appendPosts(posts, byUid);
      }
    } catch (_) {
      // Network hiccup — sentinel stays, observer will retry on next scroll
    }

    _loadingMore = false;
    sentinel.innerHTML = "";

    if (_allLoaded) {
      // "All caught up" message — disconnect observer so we stop watching
      sentinel.appendChild(el("div", {
        style: "color:var(--muted,#888);font-size:13px;padding:12px 0;text-align:center;",
      }, "You're all caught up"));
      _sentinelIO.disconnect();
    }
  };

  // ── IntersectionObserver fires _loadMore as sentinel enters viewport ────
  const _sentinelIO = new IntersectionObserver(
    (entries) => { if (entries[0].isIntersecting) _loadMore(); },
    { rootMargin: "300px" } // start fetching 300px before user hits the bottom
  );

  // ── First page — live onSnapshot so new posts appear in real time ───────
  const q = query(collection(db, "posts"), orderBy("createdAt", "desc"), limit(FEED_PAGE_SIZE));
  let _lastPostIds = "";
  let _renderSeq   = 0;

  const unsub = onSnapshot(q, async (snap) => {
    const _newIds = snap.docs.map((d) => d.id).join(",");
    if (_newIds === _lastPostIds && list.children.length > 0) return;
    _lastPostIds = _newIds;
    const seq = ++_renderSeq;

    if (snap.empty) {
      list.innerHTML = "";
      list.appendChild(el("div", { class: "empty" },
        el("i", { class: "ri-planet-line" }),
        el("div", { class: "t" }, "Your orbit is quiet"),
        el("div", {}, "Be the first to post — tap Create above."),
      ));
      return;
    }

    const posts   = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((p) => !postIsHidden(p));
    const authors = await Promise.all([...new Set(posts.map((p) => p.authorUid))].map(fetchUser));
    if (seq !== _renderSeq) return; // newer snapshot fired; discard stale render

    const byUid = Object.fromEntries(authors.filter(Boolean).map((u) => [u.uid, u]));

    // Reset list and pagination state for a fresh first page
    list.innerHTML  = "";
    _renderedIds    = new Set();
    _suggShown      = 0;
    _lastDoc        = snap.docs[snap.docs.length - 1];
    _allLoaded      = snap.docs.length < FEED_PAGE_SIZE;

    _appendPosts(posts, byUid);

    // Attach sentinel at the bottom and start watching it
    list.appendChild(sentinel);
    sentinel.innerHTML = "";
    _sentinelIO.disconnect(); // reset before re-observing
    if (!_allLoaded) _sentinelIO.observe(sentinel);

    _setupFeedVideoScroll(list);
  });

  // Store unsub globally and on root so route changes can clean up
  _feedUnsub   = unsub;
  root._unsub  = unsub;
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
        forwardAuthorName: author?.name || "Orbit member",
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
            lastMessage: `Shared a post by ${author?.name || "an Orbit member"}`,
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
      el("div", {}, el("h3", {}, "Share post"), el("p", {}, `Send ${author?.name || "this member"}’s post to your Orbit`)),
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
  if (p.kind === "build" || p.kind === "project") {
    const icons  = { build: "ri-hammer-line", project: "ri-folder-5-line" };
    const labels = { build: "Build in Public", project: "Project Showcase" };
    post.appendChild(el("div", { class: `post-kind-badge post-kind-${p.kind}` },
      el("i", { class: icons[p.kind] }), " " + labels[p.kind]));
    if (p.title) {
      post.appendChild(el("div", { class: "post-feat-title", onclick: () => location.hash = `#post/${p.id}` }, p.title));
    }
  }

  // ── Location badge ───────────────────────────────────────────────
  if (p.location?.city || p.location?.lat) {
    post.appendChild(el("div", { class: "post-location-badge" },
      el("i", { class: "ri-map-pin-fill" }),
      " " + (p.location.city || `${p.location.lat}, ${p.location.lng}`),
    ));
  }

  // ── Caption ──────────────────────────────────────────────────────
  if (p.text) {
    const caption = el("div", { class: "tfb-caption" });
    if (p.text.includes("```")) {
      import("./features.js")
        .then((m) => caption.appendChild(m.renderTextWithCode(p.text)))
        .catch(() => { caption.innerHTML = linkify(p.text); });
    } else {
      const TRUNC_LEN = 280;
      if (!_detailView && p.text.length > TRUNC_LEN) {
        let expanded = false;
        const shortText = p.text.slice(0, TRUNC_LEN).trim();
        const paint = () => {
          caption.innerHTML = linkify(expanded ? p.text : shortText + "… ");
          const moreBtn = el("span", { class: "see-more-btn", text: expanded ? "See less" : "See more" });
          moreBtn.addEventListener("click", (e) => { e.stopPropagation(); expanded = !expanded; paint(); });
          caption.appendChild(moreBtn);
        };
        paint();
      } else {
        caption.innerHTML = linkify(p.text);
        caption.onclick = (e) => {
          if (!e.target.closest("button,a")) location.hash = `#post/${p.id}`;
        };
      }
    }
    post.appendChild(caption);
  }

  // ── Media ────────────────────────────────────────────────────────
  const mediaNode = renderMediaCarousel(p.media, p.id, { detailView: _detailView, song: p.song });
  if (mediaNode) {
    // Swap post-media class for tfb-media
    mediaNode.classList.remove("post-media");
    mediaNode.classList.add("tfb-media");
    post.appendChild(mediaNode);
  }

  if (p.isSponsored) {
    let destinationUrl = "";
    try {
      const parsedUrl = new URL(p.ad?.destinationUrl || "");
      if (["http:", "https:"].includes(parsedUrl.protocol)) destinationUrl = parsedUrl.href;
    } catch {}
    const adHeadline = String(p.ad?.headline || "").trim();
    const adCta = ["Learn more", "Shop now", "Sign up", "Contact us"].includes(p.ad?.cta) ? p.ad.cta : "Learn more";
    if (adHeadline || destinationUrl) {
      post.appendChild(el("div", { class: "tfb-ad-promo" },
        adHeadline ? el("strong", { class: "tfb-ad-headline" }, adHeadline) : null,
        destinationUrl ? el("a", {
          class: "tfb-ad-cta",
          href: destinationUrl,
          target: "_blank",
          rel: "noopener noreferrer",
        }, adCta, el("i", { class: "ri-arrow-right-up-line" })) : null,
      ));
    }
  }

  // ── Build / project extra detail block ───────────────────────────
  if (p.kind === "build" || p.kind === "project") {
    import("./features.js").then((m) => {
      const extra = p.kind === "build" ? m.renderBuildExtra(p) : m.renderProjectExtra(p);
      const actions = post.querySelector(".tfb-actions");
      if (actions) post.insertBefore(extra, actions); else post.appendChild(extra);
    }).catch(() => {});
  }

  // ── Actions row ──────────────────────────────────────────────────
  const orbitIcon = el("i", { class: iOrbited ? "ri-thumb-up-fill" : "ri-thumb-up-line" });
  const likeTotal = el("span", { class: "tfb-like-total", text: p.orbitCount ? String(p.orbitCount) : "" });
  const likeSummary = el("div", { class: `tfb-like-summary${p.orbitCount ? "" : " hidden"}` },
    el("span", { class: "tfb-reaction-bubble" }, el("i", { class: "ri-thumb-up-fill" })),
    likeTotal,
  );
  const cmtCountEl = el("span", { class: "tfb-comment-total", text: p.commentCount ? String(p.commentCount) : "" });
  const cmtCountLabel = el("span", { class: "tfb-comment-label" }, p.commentCount === 1 ? " comment" : " comments");
  const commentSummaryBtn = el("button", {
    class: `tfb-comment-summary${p.commentCount ? "" : " hidden"}`,
    onclick: (e) => { e.stopPropagation(); location.hash = `#post/${p.id}`; },
  }, cmtCountEl, cmtCountLabel);
  let _iOrbited = iOrbited;

  const orbitBtn = el("button", {
    class: `tfb-badge tfb-act tfb-like-btn${iOrbited ? " active" : ""}`,
    title: "Like",
    "aria-pressed": String(iOrbited),
    onclick: async (e) => {
      e.stopPropagation();
      _iOrbited = !_iOrbited;
      if (_iOrbited) sfxOrbit();
      orbitBtn.classList.remove("orbit-burst");
      void orbitBtn.offsetWidth;
      orbitBtn.classList.add("orbit-burst");
      orbitIcon.className = _iOrbited ? "ri-thumb-up-fill" : "ri-thumb-up-line";
      p.orbitCount = Math.max(0, (p.orbitCount || 0) + (_iOrbited ? 1 : -1));
      likeTotal.textContent = p.orbitCount ? String(p.orbitCount) : "";
      likeSummary.classList.toggle("hidden", !p.orbitCount);
      orbitBtn.classList.toggle("active", _iOrbited);
      orbitBtn.setAttribute("aria-pressed", String(_iOrbited));
      await updateDoc(doc(db, "posts", p.id), {
        orbits:     _iOrbited ? arrayUnion(state.uid)   : arrayRemove(state.uid),
        orbitCount: increment(_iOrbited ? 1 : -1),
      }).catch(() => {});
      if (_iOrbited && author?.uid && author.uid !== state.uid) {
        writeNotif(author.uid, "orbit", {
          postId: p.id,
          text: `${state.me?.name || "Someone"} liked your post`,
        }).catch(() => {});
        const _thumb = Array.isArray(p.media) ? p.media[0]?.url : p.media?.url;
        import("./notifications.js").then(({ notifyUser }) =>
          notifyUser(author.uid, state.me?.name || "Someone", "liked your post",
            "/#post/" + p.id, state.me?.photoURL || "", _thumb || "")
        ).catch(() => {});
      }
    },
  }, orbitIcon, el("span", {}, "Like"));

  const actions = el("div", { class: "tfb-actions" },
    orbitBtn,
    el("button", { class: "tfb-act", onclick: (e) => { e.stopPropagation(); location.hash = `#post/${p.id}`; } },
      el("i", { class: "ri-chat-1-line" }), "Comment",
    ),
    el("button", {
      class: "tfb-act",
      onclick: async (e) => {
        e.stopPropagation();
        await openPostShareModal(p, author);
      },
    },
      el("i", { class: "ri-share-forward-line" }), " Share",
    ),
  );
  post.appendChild(el("div", { class: "tfb-post-stats" }, likeSummary, commentSummaryBtn));
  post.appendChild(actions);

  // ── Comments (feed preview — top 5) ─────────────────────────────
  if (!hideComments) {
    const cBox = el("div", { class: "comments hidden" });
    post.appendChild(cBox);

    let _replyTo = null;

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
        : el("img",   { src: url, style: "width:72px;height:72px;object-fit:cover;border-radius:10px;display:block;" });
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

    const cmtMediaBtn = el("button", {
      type: "button", class: "icon-btn cmt-icon-btn", title: "Add photo or video",
      html: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
    });
    cmtMediaBtn.addEventListener("click", (e) => { e.stopPropagation(); cmtMediaInput.click(); });

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
      const commentData = {
        text: text || "", authorUid: state.uid, createdAt: serverTimestamp(), likes: [],
        ..._replyTo ? { replyToUid: _replyTo.uid, replyToName: _replyTo.name, replyToUsername: _replyTo.username } : {},
      };
      try {
        if (_cmtMediaFile) {
          const kind = _cmtMediaFile.type.startsWith("video") ? "video" : "image";
          const up = await uploadToCloudinary(_cmtMediaFile, kind);
          commentData.mediaUrl = up.url; commentData.mediaType = kind;
        } else if (_cmtAudioBlob) {
          const audioFile = new File([_cmtAudioBlob], "voice.webm", { type: "audio/webm" });
          const up = await uploadToCloudinary(audioFile, "video");
          commentData.audioUrl = up.url;
        }
      } catch { toast("Media upload failed"); submitBtn.disabled = false; return; }
      input.value = ""; _replyTo = null;
      replyBanner.classList.add("hidden"); input.placeholder = "Write a comment…";
      clearCmtAttach();
      cBox.classList.remove("hidden");
      cBox.appendChild(el("div", { class: "comment" },
        el("img", { class: "avatar xs", src: avatarFor(state.me), onclick: () => location.hash = `#profile/${state.uid}` }),
        el("div", { class: "body" },
          el("div", { class: "name" }, state.me?.name || "User"),
          commentData.text ? el("div", { class: "text", text: commentData.text }) : null,
        ),
      ));
      sfxComment();
      submitBtn.disabled = false;
      await addDoc(collection(db, "posts", p.id, "comments"), commentData);
      await updateDoc(doc(db, "posts", p.id), { commentCount: increment(1) });
      const notifSnippet = commentData.text
        ? `"${commentData.text.slice(0, 60)}"`
        : commentData.mediaType ? "📷 sent a photo" : "🎙️ sent a voice note";
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
    });
    post.appendChild(cForm);

    const renderFeedComment = (c, a) => {
      const isLiked = (c.likes || []).includes(state.uid);
      const likeCountEl = el("span", { text: String((c.likes || []).length || "") });
      const likeIconEl = el("i", { class: isLiked ? "ri-thumb-up-fill" : "ri-thumb-up-line", style: isLiked ? "color:#0866ff;" : "" });
      let _liked = isLiked;
      const likeBtn = el("button", { class: `cmt-like-btn${_liked ? " liked" : ""}`, onclick: async (e) => {
        e.stopPropagation();
        _liked = !_liked;
        likeIconEl.className = _liked ? "ri-thumb-up-fill" : "ri-thumb-up-line";
        likeIconEl.style.color = _liked ? "#0866ff" : "";
        likeBtn.classList.toggle("liked", _liked);
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
      }}, likeIconEl, el("span", {}, "Like"), likeCountEl);

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
          (c.replyToUsername || c.replyToName)
            ? el("div", { class: "reply-to-label" },
                el("i", { class: "ri-corner-down-right-line" }),
                el("a", { class: "mention", href: `#profile-u/${c.replyToUsername || c.replyToName}` },
                  `@${c.replyToUsername || c.replyToName}`))
            : null,
          c.text  ? el("div", { class: "text", text: c.text }) : null,
          c.mediaUrl ? el("div", { class: "cmt-media", onclick: (e) => {
            e.stopPropagation();
            c.mediaType === "video"
              ? openVideoViewer([{ type: "video", url: c.mediaUrl }], 0)
              : openImageZoom(c.mediaUrl);
          }},
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

    onSnapshot(
      query(collection(db, "posts", p.id, "comments"), orderBy("createdAt", "desc"), limit(5)),
      async (snap) => {
        cBox.innerHTML = "";
        if (snap.empty) { cBox.classList.add("hidden"); return; }
        cBox.classList.remove("hidden");
        const comments = snap.docs.map((d) => ({ id: d.id, ...d.data() })).reverse();
        const authors  = await Promise.all([...new Set(comments.map((c) => c.authorUid))].map(fetchUser));
        const map      = Object.fromEntries(authors.filter(Boolean).map((u) => [u.uid, u]));
        comments.forEach((c) => cBox.appendChild(renderFeedComment(c, map[c.authorUid])));
        // Keep the feed comment count badge in sync with live comment data
        cmtCountEl.textContent = snap.size ? String(snap.size) : "";
        cmtCountLabel.textContent = snap.size === 1 ? " comment" : " comments";
        commentSummaryBtn.classList.toggle("hidden", snap.size === 0);
      },
    );

    post._focusComment = () => cForm.querySelector("input").focus();
  }
  return post;
}

// =========================================================================
// 8b. POST DETAIL — full single post with all comments + back button
// =========================================================================
// Inject Twitter-comment styles once
const _injectTwCmtStyles = (() => {
  let done = false;
  return () => {
    if (done) return; done = true;
    const s = document.createElement("style");
    s.textContent = `
      /* Twitter-style comments */
      .tw-comment {
        display: flex;
        gap: 12px;
        padding: 12px 16px;
        border-top: 1px solid var(--border, rgba(255,255,255,0.08));
      }
      .tw-comment:first-child { border-top: none; }
      .tw-cmt-avatar { flex-shrink: 0; cursor: pointer; }
      .tw-cmt-body { flex: 1; min-width: 0; }
      .tw-cmt-header {
        display: flex; align-items: center; gap: 5px;
        flex-wrap: wrap; margin-bottom: 3px;
      }
      .tw-cmt-name { font-weight: 700; font-size: 14px; }
      .tw-cmt-username { font-size: 13px; color: var(--text3); }
      .tw-cmt-dot { font-size: 12px; color: var(--text3); }
      .tw-cmt-time { font-size: 13px; color: var(--text3); }
      .tw-cmt-text { font-size: 14px; line-height: 1.5; color: var(--text); word-break: break-word; }
      .tw-cmt-actions {
        display: flex; align-items: center; gap: 20px;
        margin-top: 10px;
      }
      .tw-cmt-act-btn {
        display: flex; align-items: center; gap: 5px;
        background: none; border: none; cursor: pointer;
        color: var(--text3); font-size: 13px;
        padding: 4px; border-radius: 999px;
        transition: color .15s, background .15s;
      }
      .tw-cmt-act-btn i { font-size: 17px; }
      .tw-cmt-act-btn:hover { color: var(--primary); background: rgba(108,99,255,.1); }
      .tw-cmt-act-btn.liked { color: var(--danger, #e0245e); }
      .tw-cmt-act-btn.liked:hover { background: rgba(224,36,94,.1); }
      .tw-cmt-act-count { font-size: 13px; }
      .detail-cmt-list { border-radius: 12px; overflow: hidden; }

      /* Ensure mention colour isn't overridden inside comment body */
      .tw-cmt-body a.mention {
        color: var(--primary, #6c63ff);
        text-decoration: none;
        font-weight: 500;
      }
      .tw-cmt-body a.mention:hover { text-decoration: underline; }

      /* Twitter-style reply banner */
      .detail-reply-banner {
        display: flex; align-items: center; justify-content: space-between;
        margin: 0 16px 6px;
        padding: 8px 12px 8px 14px;
        border-radius: 10px;
        background: rgba(108,99,255,.08);
        border-left: 3px solid var(--primary, #6c63ff);
        animation: replyBannerIn .15s ease;
      }
      .detail-reply-banner.hidden { display: none; }
      @keyframes replyBannerIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
      .detail-reply-banner-inner {
        display: flex; align-items: center; gap: 6px;
        font-size: 13px; color: var(--text3);
      }
      .detail-reply-banner-icon { font-size: 14px; color: var(--primary, #6c63ff); }
      .detail-reply-banner-label { color: var(--text3); }
      .detail-reply-banner-user {
        color: var(--primary, #6c63ff);
        font-weight: 600;
        font-size: 13px;
      }
      .detail-reply-banner-close {
        background: none; border: none; cursor: pointer;
        color: var(--text3); padding: 2px 4px; border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        transition: color .15s, background .15s;
        font-size: 15px; line-height: 1;
      }
      .detail-reply-banner-close:hover { color: var(--text); background: rgba(255,255,255,.08); }
    `;
    document.head.appendChild(s);
  };
})();

const renderPostDetail = async (root, postId) => {
  _injectTwCmtStyles();
  if (!postId) { location.hash = "#feed"; return; }

  const back = el("div", { class: "detail-topbar" },
    el("button", { class: "icon-btn", onclick: () => history.back() },
      el("i", { class: "ri-arrow-left-line" }), "Back"),
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

  back.append(
    el("div", { class: "detail-author" },
      el("img", {
        class: "avatar xs",
        src: avatarFor(author),
        alt: `${author?.name || "Post owner"} profile picture`,
        onclick: () => { location.hash = `#profile/${author?.uid}`; },
      }),
      el("div", { class: "detail-author-copy" },
        el("strong", {}, author?.name || "User"),
        el("span", {}, `@${author?.username || "user"}`),
      ),
    ),
    el("div", { class: "detail-topbar-stats" },
      el("span", {}, el("i", { class: "ri-thumb-up-line" }), ` ${p.orbitCount || 0} likes`),
      el("span", {}, el("i", { class: "ri-eye-line" }), ` ${p.views || 0}`),
      el("span", {}, el("i", { class: "ri-chat-1-line" }), ` ${p.commentCount || 0}`),
    ),
  );

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
  const detailReplyBanner = el("div", { class: "detail-reply-banner hidden" });
  const _replyBannerUsername = el("span", { class: "detail-reply-banner-user" }, "");
  detailReplyBanner.appendChild(
    el("div", { class: "detail-reply-banner-inner" },
      el("i", { class: "ri-corner-down-right-line detail-reply-banner-icon" }),
      el("span", { class: "detail-reply-banner-label" }, "Replying to "),
      _replyBannerUsername,
    ),
  );
  const _replyBannerClose = el("button", { class: "detail-reply-banner-close", type: "button", onclick: () => {
    _detailReplyTo = null;
    detailReplyBanner.classList.add("hidden");
    const inp = cmtSection.querySelector("input[type='text']");
    if (inp) { inp.placeholder = "Write a comment…"; inp.value = ""; }
  }}, el("i", { class: "ri-close-line" }));
  detailReplyBanner.appendChild(_replyBannerClose);
  cmtSection.appendChild(detailReplyBanner);

  const renderDetailComment = (c, a) => {
    const isLiked = (c.likes || []).includes(state.uid);
    const likeCount = (c.likes || []).length;
    const likeCountEl = el("span", { class: "tw-cmt-act-count", text: likeCount > 0 ? String(likeCount) : "" });
    const likeIconEl = el("i", { class: isLiked ? "ri-thumb-up-fill" : "ri-thumb-up-line" });
    let _liked = isLiked;

    const likeBtn = el("button", {
      class: `tw-cmt-act-btn${_liked ? " liked" : ""}`,
      onclick: async (ev) => {
        ev.stopPropagation();
        _liked = !_liked;
        likeIconEl.className = _liked ? "ri-thumb-up-fill" : "ri-thumb-up-line";
        likeBtn.classList.toggle("liked", _liked);
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
      },
    }, likeIconEl, "Like", likeCountEl);

    const replyBtn = el("button", {
      class: "tw-cmt-act-btn",
      onclick: () => {
        const handle = a?.username || a?.name || "user";
        _detailReplyTo = { uid: a?.uid, name: a?.name || "user", username: a?.username || "", commentId: c.id };
        _replyBannerUsername.textContent = `@${handle}`;
        detailReplyBanner.classList.remove("hidden");
        const inp = cmtSection.querySelector("input[type='text']");
        if (inp) { inp.placeholder = `Reply to @${handle}…`; inp.focus(); }
      },
    }, el("i", { class: "ri-chat-1-line" }), "Reply");

    const shareBtn = el("button", {
      class: "tw-cmt-act-btn",
      onclick: async (ev) => {
        ev.stopPropagation();
        const url = postPublicUrl(p.id);
        try {
          if (navigator.share) {
            await navigator.share({ title: "A new gravity for your circles.", text: c.text || "", url });
          } else {
            await navigator.clipboard.writeText(url);
            toast("Link copied");
          }
        } catch (error) {
          if (error?.name !== "AbortError") {
            await navigator.clipboard.writeText(url).catch(() => {});
            toast("Link copied");
          }
        }
      },
    }, el("i", { class: "ri-share-forward-line" }), "Share");

    return el("div", { class: "tw-comment" },
      el("img", { class: "avatar xs tw-cmt-avatar", src: avatarFor(a), onclick: () => location.hash = `#profile/${a?.uid}` }),
      el("div", { class: "tw-cmt-body" },
        el("div", { class: "tw-cmt-bubble" },
          el("div", { class: "tw-cmt-header" },
            el("span", { class: "tw-cmt-name" }, a?.name || "User",
              a?.verified ? el("span", { class: "verified", html: '<i class="ri-check-line"></i>' }) : null,
            ),
            el("span", { class: "tw-cmt-username" }, `@${a?.username || "user"}`),
            el("span", { class: "tw-cmt-dot" }, "·"),
            el("span", { class: "tw-cmt-time" }, fmtTime(c.createdAt)),
          ),
          (c.replyToUsername || c.replyToName) ? el("div", { class: "reply-to-label" },
            el("i", { class: "ri-corner-down-right-line" }),
            el("a", { class: "mention", href: `#profile-u/${c.replyToUsername || c.replyToName}` }, `@${c.replyToUsername || c.replyToName}`)
          ) : null,
          c.text ? el("div", { class: "tw-cmt-text" }, c.text) : null,
          c.mediaUrl ? el("div", { class: "cmt-media", onclick: (ev) => { ev.stopPropagation(); c.mediaType === "video" ? openVideoViewer([{ type: "video", url: c.mediaUrl }], 0) : openImageZoom(c.mediaUrl); }},
            c.mediaType === "video"
              ? el("div", { class: "cmt-media-video-wrap" },
                  el("video", { src: c.mediaUrl, muted: "", preload: "metadata", style: "max-width:200px;max-height:150px;object-fit:cover;display:block;border-radius:10px;" }),
                  el("div", { class: "cmt-media-video-play", html: `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg>` }),
                )
              : el("img", { src: c.mediaUrl, loading: "lazy", style: "max-width:200px;max-height:150px;object-fit:cover;display:block;border-radius:10px;margin-top:8px;" }),
          ) : null,
          c.audioUrl ? el("div", { class: "cmt-voice-note" },
            el("span", { html: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>` }),
            el("audio", { src: c.audioUrl, controls: true, style: "height:28px;max-width:150px;" }),
          ) : null,
        ),
        el("div", { class: "tw-cmt-actions" }, replyBtn, shareBtn, likeBtn),
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
        cList.appendChild(el("div", { class: "reel-cmt-empty" }, "No comments yet. Be the first!"));
        return;
      }
      const comments = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const auths = await Promise.all([...new Set(comments.map((c) => c.authorUid))].map(fetchUser));
      const map = Object.fromEntries(auths.filter(Boolean).map((u) => [u.uid, u]));

      // Separate top-level comments from replies, then render nested
      const topLevel = comments.filter((c) => !c.parentCommentId);
      const replies   = comments.filter((c) => !!c.parentCommentId);

      topLevel.forEach((c) => {
        cList.appendChild(renderDetailComment(c, map[c.authorUid]));
        // Collect direct replies to this comment
        const children = replies.filter((r) => r.parentCommentId === c.id);
        if (children.length > 0) {
          const replyWrap = el("div", { class: "tw-comment-reply" });
          children.forEach((r) => replyWrap.appendChild(renderDetailComment(r, map[r.authorUid])));
          cList.appendChild(replyWrap);
        }
      });

      // Show "Load more" button only if we might have more and haven't loaded all yet
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
    const input = cForm.querySelector("input[type='text']");
    const text = input.value.trim();
    if (!text && !_dCmtMediaFile && !_dCmtAudioBlob) return;
    const submitBtn = cForm.querySelector("button[type='submit']");
    submitBtn.disabled = true;
    const commentData = {
      text: text || "", authorUid: state.uid, createdAt: serverTimestamp(), likes: [],
      ..._detailReplyTo ? {
        replyToUid: _detailReplyTo.uid,
        replyToName: _detailReplyTo.name,
        replyToUsername: _detailReplyTo.username,
        parentCommentId: _detailReplyTo.commentId || null,
      } : {},
    };
    try {
      if (_dCmtMediaFile) {
        const kind = _dCmtMediaFile.type.startsWith("video") ? "video" : "image";
        const up = await uploadToCloudinary(_dCmtMediaFile, kind);
        commentData.mediaUrl = up.url; commentData.mediaType = kind;
      } else if (_dCmtAudioBlob) {
        const audioFile = new File([_dCmtAudioBlob], "voice.webm", { type: "audio/webm" });
        const up = await uploadToCloudinary(audioFile, "video");
        commentData.audioUrl = up.url;
      }
    } catch { toast("Media upload failed"); submitBtn.disabled = false; return; }
    input.value = ""; _detailReplyTo = null;
    detailReplyBanner.classList.add("hidden"); input.placeholder = "Write a comment…";
    clearDCmtAttach(); sfxComment(); submitBtn.disabled = false;
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
  });
  cmtSection.appendChild(cForm);
};

const toggleSave = async (postId, shouldSave = null) => {
  const ref = doc(db, "users", state.uid);
  const has = (state.me.saved || []).includes(postId);
  const next = shouldSave == null ? !has : shouldSave;
  await updateDoc(ref, { saved: next ? arrayUnion(postId) : arrayRemove(postId) });
  state.me.saved = next
    ? [...new Set([...(state.me.saved || []), postId])]
    : (state.me.saved || []).filter((id) => id !== postId);
  toast(next ? "Saved" : "Removed from Saved");
};

// =========================================================================
// 10. GROUP CITY + GROUP ROOMS
// =========================================================================
// Reuse the same local Kenney building models and Three.js modules as game.js.
// The model loader resolves building-*.glb against the same page-relative paths.
let _orbitThreeModulePromise = null;
let _orbitGLTFLoaderPromise = null;
let _orbitSkeletonUtilsPromise = null;
const loadOrbitThree = () => {
  if (!_orbitThreeModulePromise) {
    _orbitThreeModulePromise = import("three")
      .catch((error) => { _orbitThreeModulePromise = null; throw error; });
  }
  return _orbitThreeModulePromise;
};
const loadOrbitGLTFLoader = () => {
  if (!_orbitGLTFLoaderPromise) {
    _orbitGLTFLoaderPromise = import("three/addons/loaders/GLTFLoader.js")
      .catch((error) => { _orbitGLTFLoaderPromise = null; throw error; });
  }
  return _orbitGLTFLoaderPromise;
};
const loadOrbitSkeletonUtils = () => {
  if (!_orbitSkeletonUtilsPromise) {
    _orbitSkeletonUtilsPromise = import("three/addons/utils/SkeletonUtils.js")
      .catch((error) => { _orbitSkeletonUtilsPromise = null; throw error; });
  }
  return _orbitSkeletonUtilsPromise;
};
const GROUP_CITY_BUILDING_MODELS = [
  "building-a.glb", "building-b.glb", "building-c.glb", "building-d.glb", "building-e.glb",
  "building-f.glb", "building-g.glb", "building-h.glb", "building-i.glb", "building-j.glb",
  "building-k.glb", "building-l.glb", "building-m.glb", "building-n.glb", "building-o.glb",
  "building-p.glb", "building-q.glb", "building-r.glb", "building-s.glb", "building-t.glb",
];

const groupSeed = (value = "") => {
  let n = 2166136261;
  for (let i = 0; i < value.length; i++) n = Math.imul(n ^ value.charCodeAt(i), 16777619);
  return n >>> 0;
};

class OrbitGroupsCity {
  constructor(stage, groups, onNearby) {
    this.stage = stage;
    this.groups = groups;
    this.onNearby = onNearby;
    this.disposed = false;
    this.keys = new Set();
    this.moveX = 0;
    this.moveY = 0;
    this.joystickPointer = null;
    this.swipePointer = null;
    this.lastSwipeX = 0;
    this.lastSwipeY = 0;
    this.yaw = 0;
    this.pitch = 0.34;
    this.speed = 0.36;
    this.nearbyId = null;
    this.lastFrame = 0;
    this.init().catch((error) => {
      if (this.disposed || !this.stage.isConnected) return;
      console.error("Orbit groups city failed to start:", error);
      const loading = this.stage.querySelector(".grp-city-loading");
      if (loading) {
        loading.innerHTML = "<strong>City view unavailable</strong><span>Check your connection or WebGL support, then reload Groups.</span>";
        loading.classList.remove("hidden");
      }
    });
  }

  async init() {
    const THREE = await loadOrbitThree();
    if (this.disposed || !this.stage.isConnected) return;
    this.THREE = THREE;
    const count = Math.max(1, this.groups.length);
    this.cols = Math.min(10, Math.max(3, Math.ceil(Math.sqrt(count * 1.25))));
    this.rows = Math.ceil(count / this.cols);
    this.spacingX = 38;
    this.spacingZ = 42;
    this.startX = -((this.cols - 1) * this.spacingX) / 2;
    this.startZ = -((this.rows - 1) * this.spacingZ) / 2;
    this.mapWidth = this.cols * this.spacingX + 76;
    this.mapDepth = this.rows * this.spacingZ + 118;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87ceeb);
    this.scene.fog = new THREE.Fog(0x87ceeb, 115, Math.max(260, this.mapDepth * 1.3));
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 1200);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.className = "grp-city-canvas";
    this.renderer.domElement.setAttribute("aria-label", "Walkable 3D city of Orbit groups");
    this.stage.insertBefore(this.renderer.domElement, this.stage.firstChild);

    this.scene.add(new THREE.HemisphereLight(0xdaf3ff, 0x355333, 1.5));
    const sun = new THREE.DirectionalLight(0xffeed4, 2.1);
    sun.position.set(65, 100, 50);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -150;
    sun.shadow.camera.right = 150;
    sun.shadow.camera.top = 150;
    sun.shadow.camera.bottom = -150;
    sun.shadow.camera.far = 400;
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0x91c7ff, 0.55);
    fill.position.set(-55, 35, -65);
    this.scene.add(fill);

    this.createLandscape();
    this.buildings = this.groups.map((group, index) => this.createBuilding(group, index));
    this.loadBuildingModels().catch((error) => console.warn("Orbit city building models unavailable; showing fallback buildings:", error));
    this.createPlayer();
    this.loadPlayerAvatar().catch((error) => console.warn("Could not load the Orbit player avatar:", error));
    this.playerPos = new THREE.Vector3(0, 0, this.startZ + (this.rows - 1) * this.spacingZ + 27);
    this.player.position.copy(this.playerPos);
    this.camera.position.set(this.playerPos.x, 8, this.playerPos.z + 14);
    this.camera.lookAt(this.playerPos.x, 2, this.playerPos.z);

    this.bindControls();
    this.resize();
    this.resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => this.resize()) : null;
    this.resizeObserver?.observe(this.stage);
    this.resizeHandler = () => this.resize();
    window.addEventListener("resize", this.resizeHandler);
    this.stage.querySelector(".grp-city-loading")?.classList.add("hidden");
    this.animate();
  }

  addMesh(geometry, material, x, y, z, parent = this.scene) {
    const mesh = new this.THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  createLandscape() {
    const THREE = this.THREE;
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(this.mapWidth, this.mapDepth),
      new THREE.MeshStandardMaterial({ color: 0x3a7e3a, roughness: 0.92 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.12, (this.startZ + this.rows * this.spacingZ / 2) / 2);
    ground.receiveShadow = true;
    this.scene.add(ground);

    const roadMaterial = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.9 });
    const centerX = this.startX + (this.cols - 1) * this.spacingX / 2;
    const centerZ = this.startZ + (this.rows - 1) * this.spacingZ / 2;
    for (let i = 0; i <= this.cols; i++) {
      const x = this.startX - this.spacingX / 2 + i * this.spacingX;
      const road = new THREE.Mesh(new THREE.PlaneGeometry(7, this.mapDepth), roadMaterial);
      road.rotation.x = -Math.PI / 2;
      road.position.set(x, 0.015, centerZ);
      road.receiveShadow = true;
      this.scene.add(road);
    }
    for (let i = 0; i <= this.rows; i++) {
      const z = this.startZ - this.spacingZ / 2 + i * this.spacingZ;
      const road = new THREE.Mesh(new THREE.PlaneGeometry(this.mapWidth, 7), roadMaterial);
      road.rotation.x = -Math.PI / 2;
      road.position.set(centerX, 0.02, z);
      road.receiveShadow = true;
      this.scene.add(road);
    }

    for (let i = 0; i < 90; i++) {
      const x = Math.sin(i * 12.9898) * (this.mapWidth * 0.47);
      const z = Math.cos(i * 7.233) * (this.mapDepth * 0.45) + centerZ;
      const patch = new THREE.Mesh(
        new THREE.CircleGeometry(2.5 + (i % 5) * 0.7, 7),
        new THREE.MeshStandardMaterial({ color: i % 2 ? 0x458a43 : 0x4a8e4a, roughness: 1 }),
      );
      patch.rotation.x = -Math.PI / 2;
      patch.position.set(x, 0.025, z);
      patch.receiveShadow = true;
      this.scene.add(patch);
    }
  }

  createBannerTexture(name) {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, "#39205e");
    gradient.addColorStop(1, "#c84a8c");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(255,255,255,.13)";
    ctx.fillRect(0, 0, 12, canvas.height);
    ctx.fillRect(canvas.width - 12, 0, 12, canvas.height);
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    let fontSize = 52;
    ctx.font = `800 ${fontSize}px system-ui, sans-serif`;
    while (ctx.measureText(name).width > 465 && fontSize > 22) {
      fontSize -= 2;
      ctx.font = `800 ${fontSize}px system-ui, sans-serif`;
    }
    ctx.fillText(name, canvas.width / 2, canvas.height / 2, 456);
    const texture = new this.THREE.CanvasTexture(canvas);
    texture.colorSpace = this.THREE.SRGBColorSpace;
    return texture;
  }

  async loadBuildingModels() {
    const { GLTFLoader } = await loadOrbitGLTFLoader();
    if (this.disposed || !this.stage.isConnected) return;
    const loader = new GLTFLoader();
    const templates = new Map();
    const loadTemplate = (filename) => {
      if (!templates.has(filename)) {
        templates.set(filename, new Promise((resolve, reject) => {
          // game.js uses this same relative filename lookup for its buildings.
          loader.load(filename, (gltf) => resolve(gltf.scene), undefined, reject);
        }));
      }
      return templates.get(filename);
    };
    let loaded = 0;
    await Promise.all(this.buildings.map(async (building) => {
      try {
        const template = await loadTemplate(building.modelFile);
        if (this.disposed || !this.stage.isConnected) return;
        const model = template.clone(true);
        model.traverse((node) => {
          if (node.isMesh) { node.castShadow = true; node.receiveShadow = true; }
        });
        model.updateMatrixWorld(true);
        const rawBounds = new this.THREE.Box3().setFromObject(model);
        const rawSize = rawBounds.getSize(new this.THREE.Vector3());
        if (!rawSize.y) return;
        model.scale.multiplyScalar(building.height / rawSize.y);
        model.updateMatrixWorld(true);
        const bounds = new this.THREE.Box3().setFromObject(model);
        model.position.x -= (bounds.min.x + bounds.max.x) / 2;
        model.position.y -= bounds.min.y;
        model.position.z -= (bounds.min.z + bounds.max.z) / 2;
        building.modelRoot.add(model);
        building.fallbackRoot.visible = false;
        loaded++;
      } catch (error) {
        console.warn(`Could not load ${building.modelFile}; keeping its fallback building.`, error);
      }
    }));
    if (!this.disposed && loaded) console.info(`Loaded ${loaded} Orbit group buildings from the game.js GLB set.`);
  }

  createBuilding(group, index) {
    const THREE = this.THREE;
    const seed = groupSeed(group.id || group.name || String(index));
    const width = 15 + (seed % 6);
    const depth = 15 + ((seed >>> 4) % 6);
    const height = 11 + ((seed >>> 8) % 11);
    const x = this.startX + (index % this.cols) * this.spacingX;
    const z = this.startZ + Math.floor(index / this.cols) * this.spacingZ;
    const palette = [0xb96f50, 0x8b7c67, 0x6d8790, 0xc19c64, 0x8a6f9d, 0x637966, 0xa56258, 0x8291a0];
    const color = palette[seed % palette.length];
    const building = new THREE.Group();
    building.position.set(x, 0, z);
    building.rotation.y = Math.floor((seed >>> 12) % 4) * Math.PI / 2;
    this.scene.add(building);
    const fallbackRoot = new THREE.Group();
    const modelRoot = new THREE.Group();
    const signRoot = new THREE.Group();
    building.add(fallbackRoot, modelRoot, signRoot);

    this.addMesh(new THREE.BoxGeometry(width + 1.2, 1, depth + 1.2), new THREE.MeshStandardMaterial({ color: 0x6c6a63, roughness: 0.95 }), 0, 0.5, 0, fallbackRoot);
    this.addMesh(new THREE.BoxGeometry(width, height, depth), new THREE.MeshStandardMaterial({ color, roughness: 0.82 }), 0, height / 2 + 1, 0, fallbackRoot);
    const roofColor = seed % 2 ? 0x554d49 : 0x4e5256;
    this.addMesh(new THREE.BoxGeometry(width + 0.8, 0.65, depth + 0.8), new THREE.MeshStandardMaterial({ color: roofColor, roughness: 0.95 }), 0, height + 1.3, 0, fallbackRoot);

    const roofStyle = (seed >>> 16) % 3;
    if (roofStyle === 0) {
      this.addMesh(new THREE.BoxGeometry(width * 0.36, 2.8, depth * 0.38), new THREE.MeshStandardMaterial({ color: roofColor, roughness: 0.85 }), -width * 0.17, height + 3, -depth * 0.1, fallbackRoot);
    } else if (roofStyle === 1) {
      this.addMesh(new THREE.CylinderGeometry(1.2, 1.2, 2.8, 8), new THREE.MeshStandardMaterial({ color: 0x9c9a8d, metalness: 0.28, roughness: 0.65 }), width * 0.2, height + 2.9, -depth * 0.1, fallbackRoot);
    } else {
      this.addMesh(new THREE.BoxGeometry(width * 0.22, 1.2, depth * 0.22), new THREE.MeshStandardMaterial({ color: 0x867e70, roughness: 0.8 }), 0, height + 2.2, 0, fallbackRoot);
    }

    const windowMaterial = new THREE.MeshStandardMaterial({ color: seed % 3 ? 0x88c4da : 0xf4d89b, emissive: seed % 3 ? 0x152d35 : 0x2d2110, roughness: 0.36, metalness: 0.08 });
    const floors = Math.max(2, Math.floor(height / 3.2));
    for (let floor = 0; floor < floors; floor++) {
      const wy = 2 + floor * (height - 2) / floors;
      for (let col = -1; col <= 1; col++) {
        const wx = col * (width * 0.28);
        this.addMesh(new THREE.BoxGeometry(1.8, 1.35, 0.18), windowMaterial, wx, wy, depth / 2 + 0.1, fallbackRoot);
        this.addMesh(new THREE.BoxGeometry(0.18, 1.35, 1.8), windowMaterial, width / 2 + 0.1, wy, col * (depth * 0.26), fallbackRoot);
      }
    }

    const signWidth = Math.min(width * 0.9, 15);
    const signTexture = this.createBannerTexture(group.name || "Orbit group");
    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry(signWidth, 2.9),
      new THREE.MeshBasicMaterial({ map: signTexture, side: THREE.DoubleSide }),
    );
    banner.position.set(0, height * 0.69 + 1, depth / 2 + 0.55);
    signRoot.add(banner);
    const poleMaterial = new THREE.MeshStandardMaterial({ color: 0x453b36, metalness: 0.25, roughness: 0.65 });
    this.addMesh(new THREE.BoxGeometry(signWidth + 0.6, 0.18, 0.18), poleMaterial, 0, height * 0.69 + 2.55, depth / 2 + 0.55, signRoot);

    return { group, x, z, width, depth, height, mesh: building, modelFile: GROUP_CITY_BUILDING_MODELS[index % GROUP_CITY_BUILDING_MODELS.length], fallbackRoot, modelRoot };
  }

  createPlayer() {
    const THREE = this.THREE;
    this.player = new THREE.Group();
    // Keep a small ground pointer visible while the user's GLB avatar loads.
    const marker = new THREE.Mesh(
      new THREE.CircleGeometry(1.1, 22),
      new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.32, side: THREE.DoubleSide }),
    );
    marker.rotation.x = -Math.PI / 2;
    marker.position.y = 0.035;
    this.player.add(marker);
    const pointer = new THREE.Mesh(
      new THREE.ConeGeometry(0.48, 1.45, 5),
      new THREE.MeshStandardMaterial({ color: 0xffd166, roughness: 0.42 }),
    );
    pointer.rotation.x = -Math.PI / 2;
    pointer.position.set(0, 0.12, -1.15);
    this.player.add(pointer);
    this.scene.add(this.player);
  }

  loadModelFile(loader, url) {
    return new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject));
  }

  async loadPlayerAvatar() {
    const { GLTFLoader } = await loadOrbitGLTFLoader();
    if (this.disposed || !this.stage.isConnected) return;
    const loader = new GLTFLoader();
    const customModelURL = state.me?.avatarModelUrl || null;
    let gltf;
    try {
      gltf = await this.loadModelFile(loader, customModelURL || "Soldier.glb");
    } catch (error) {
      if (!customModelURL) throw error;
      console.warn("Orbit profile avatar failed; falling back to the game character.", error);
      gltf = await this.loadModelFile(loader, "Soldier.glb");
    }
    if (this.disposed || !this.stage.isConnected) return;

    const model = gltf.scene;
    model.rotation.y = Math.PI;
    model.traverse((node) => {
      if (node.isMesh) { node.castShadow = true; node.receiveShadow = true; node.frustumCulled = false; }
    });
    model.updateMatrixWorld(true);
    const bounds = new this.THREE.Box3().setFromObject(model);
    const originalSize = bounds.getSize(new this.THREE.Vector3());
    if (originalSize.y > 0) {
      // The default Soldier.glb uses the same scale as game.js; personal Orbit
      // avatar models are sized to fit the same walking character footprint.
      model.scale.setScalar(customModelURL ? 3.35 / originalSize.y : 1.163);
    }
    model.updateMatrixWorld(true);
    const scaledBounds = new this.THREE.Box3().setFromObject(model);
    model.position.y -= scaledBounds.min.y;
    this.playerAvatarHeight = scaledBounds.getSize(new this.THREE.Vector3()).y;
    this.player.add(model);
    this.playerModel = model;

    if (gltf.animations?.length) {
      this.playerMixer = new this.THREE.AnimationMixer(model);
      this.playerAnimationClips = gltf.animations;
      this.setPlayerAnimation(false);
    }
    this.addPlayerNameTag();
  }

  addPlayerNameTag() {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 112;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "rgba(17, 21, 34, .84)";
    ctx.beginPath();
    ctx.roundRect(10, 12, 492, 88, 38);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = "700 32px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const username = state.me?.username ? `@${String(state.me.username).replace(/^@/, "")}` : (state.me?.name || "You");
    ctx.fillText(username, 256, 57, 460);
    const texture = new this.THREE.CanvasTexture(canvas);
    texture.colorSpace = this.THREE.SRGBColorSpace;
    const tag = new this.THREE.Sprite(new this.THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
    tag.scale.set(3.8, 0.84, 1);
    tag.position.set(0, Math.max(3.8, (this.playerAvatarHeight || 3.2) + 0.65), 0);
    this.player.add(tag);
    this.playerNameTag = tag;
  }

  setPlayerAnimation(isMoving) {
    if (!this.playerMixer || !this.playerAnimationClips?.length) return;
    const pattern = isMoving ? /run|walk|move/i : /idle|stand|breath/i;
    const clip = this.playerAnimationClips.find((candidate) => pattern.test(candidate.name))
      || this.playerAnimationClips.find((candidate) => /idle|stand|breath|run|walk/i.test(candidate.name))
      || this.playerAnimationClips[0];
    if (!clip || clip.name === this.playerCurrentAnimation) return;
    const next = this.playerMixer.clipAction(clip);
    this.playerActions ||= new Map();
    this.playerActions.set(clip.name, next);
    this.playerActions.get(this.playerCurrentAnimation)?.fadeOut(0.14);
    next.reset().fadeIn(0.14).play();
    this.playerCurrentAnimation = clip.name;
  }

  bindControls() {
    const joystick = this.stage.querySelector(".grp-city-joystick");
    const thumb = this.stage.querySelector(".grp-city-joystick-thumb");
    const swipe = this.stage.querySelector(".grp-city-swipe-zone");
    if (joystick && thumb) {
      const move = (event) => {
        if (event.pointerId !== this.joystickPointer) return;
        event.preventDefault();
        const rect = joystick.getBoundingClientRect();
        let dx = event.clientX - (rect.left + rect.width / 2);
        let dy = event.clientY - (rect.top + rect.height / 2);
        const max = Math.min(rect.width, rect.height) * 0.34;
        const dist = Math.hypot(dx, dy);
        if (dist > max) { dx *= max / dist; dy *= max / dist; }
        thumb.style.transform = `translate(${dx}px,${dy}px)`;
        this.moveX = dx / max;
        this.moveY = -dy / max;
      };
      joystick.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (this.joystickPointer !== null) return;
        this.joystickPointer = event.pointerId;
        joystick.setPointerCapture?.(event.pointerId);
        move(event);
      });
      joystick.addEventListener("pointermove", move);
      const release = (event) => {
        if (event.pointerId !== this.joystickPointer) return;
        this.joystickPointer = null;
        this.moveX = this.moveY = 0;
        thumb.style.transform = "translate(0px,0px)";
      };
      joystick.addEventListener("pointerup", release);
      joystick.addEventListener("pointercancel", release);
      joystick.addEventListener("lostpointercapture", release);
    }
    if (swipe) {
      swipe.addEventListener("pointerdown", (event) => {
        if (event.target.closest("button, a")) return;
        this.swipePointer = event.pointerId;
        this.lastSwipeX = event.clientX;
        this.lastSwipeY = event.clientY;
        swipe.setPointerCapture?.(event.pointerId);
      });
      swipe.addEventListener("pointermove", (event) => {
        if (event.pointerId !== this.swipePointer) return;
        const dx = event.clientX - this.lastSwipeX;
        const dy = event.clientY - this.lastSwipeY;
        this.yaw -= dx * 0.005;
        this.pitch = Math.max(0.16, Math.min(0.72, this.pitch + dy * 0.003));
        this.lastSwipeX = event.clientX;
        this.lastSwipeY = event.clientY;
      });
      const stopSwipe = (event) => { if (event.pointerId === this.swipePointer) this.swipePointer = null; };
      swipe.addEventListener("pointerup", stopSwipe);
      swipe.addEventListener("pointercancel", stopSwipe);
      swipe.addEventListener("lostpointercapture", stopSwipe);
    }
    this.keyDown = (event) => {
      if (!this.stage.isConnected || event.target.closest?.("input, textarea, button, a")) return;
      const key = event.key.toLowerCase();
      if (["w", "a", "s", "d", "arrowup", "arrowleft", "arrowdown", "arrowright"].includes(key)) {
        this.keys.add(key);
        event.preventDefault();
      }
    };
    this.keyUp = (event) => this.keys.delete(event.key.toLowerCase());
    window.addEventListener("keydown", this.keyDown);
    window.addEventListener("keyup", this.keyUp);
  }

  resize() {
    if (!this.renderer || this.disposed) return;
    const width = Math.max(1, this.stage.clientWidth);
    const height = Math.max(1, this.stage.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  isFree(x, z) {
    return this.buildings.every((building) =>
      Math.abs(x - building.x) > building.width / 2 + 1.3 || Math.abs(z - building.z) > building.depth / 2 + 1.3,
    );
  }

  animate = (now = performance.now()) => {
    if (this.disposed || !this.stage.isConnected) { this.destroy(); return; }
    this.frame = requestAnimationFrame(this.animate);
    const dt = Math.min(40, this.lastFrame ? now - this.lastFrame : 16.7) / 16.7;
    this.lastFrame = now;
    let mx = this.moveX;
    let my = this.moveY;
    if (this.keys.has("a") || this.keys.has("arrowleft")) mx -= 1;
    if (this.keys.has("d") || this.keys.has("arrowright")) mx += 1;
    if (this.keys.has("w") || this.keys.has("arrowup")) my += 1;
    if (this.keys.has("s") || this.keys.has("arrowdown")) my -= 1;
    const magnitude = Math.hypot(mx, my);
    if (magnitude > 1) { mx /= magnitude; my /= magnitude; }
    const forwardX = -Math.sin(this.yaw), forwardZ = -Math.cos(this.yaw);
    const rightX = Math.cos(this.yaw), rightZ = -Math.sin(this.yaw);
    const dx = (forwardX * my + rightX * mx) * this.speed * dt;
    const dz = (forwardZ * my + rightZ * mx) * this.speed * dt;
    const limitX = this.mapWidth / 2 - 4;
    const centerZ = this.startZ + (this.rows - 1) * this.spacingZ / 2;
    const limitZ = this.mapDepth / 2 - 4;
    const nx = Math.max(-limitX, Math.min(limitX, this.playerPos.x + dx));
    const nz = Math.max(centerZ - limitZ, Math.min(centerZ + limitZ, this.playerPos.z + dz));
    if (this.isFree(nx, this.playerPos.z)) this.playerPos.x = nx;
    if (this.isFree(this.playerPos.x, nz)) this.playerPos.z = nz;
    this.player.position.copy(this.playerPos);
    this.player.rotation.y = this.yaw;
    this.setPlayerAnimation(magnitude > 0.05);
    this.playerMixer?.update(dt * 0.0167);

    const horizontal = 13 * Math.cos(this.pitch);
    const cameraTarget = new this.THREE.Vector3(
      this.playerPos.x + Math.sin(this.yaw) * horizontal,
      this.playerPos.y + 2.2 + 13 * Math.sin(this.pitch),
      this.playerPos.z + Math.cos(this.yaw) * horizontal,
    );
    this.camera.position.lerp(cameraTarget, 0.11);
    this.camera.lookAt(this.playerPos.x, this.playerPos.y + 1.4, this.playerPos.z);

    let nearest = null;
    let bestDistance = 18;
    for (const building of this.buildings) {
      const distance = Math.hypot(this.playerPos.x - building.x, this.playerPos.z - building.z);
      if (distance < bestDistance) { nearest = building.group; bestDistance = distance; }
    }
    const nextId = nearest?.id || null;
    if (nextId !== this.nearbyId) {
      this.nearbyId = nextId;
      this.onNearby(nearest || null);
    }
    this.renderer.render(this.scene, this.camera);
  };

  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.frame) cancelAnimationFrame(this.frame);
    if (this.keyDown) window.removeEventListener("keydown", this.keyDown);
    if (this.keyUp) window.removeEventListener("keyup", this.keyUp);
    if (this.resizeHandler) window.removeEventListener("resize", this.resizeHandler);
    this.resizeObserver?.disconnect();
    if (this.scene) this.scene.traverse((node) => {
      if (node.geometry) node.geometry.dispose();
      if (node.material) {
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        materials.forEach((material) => {
          material.map?.dispose();
          material.dispose();
        });
      }
    });
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
  }
}

const groupMemberCount = (group) => (group.members || []).length;
const setGroupMembership = async (group, joined) => {
  if (!state.uid) { toast("Sign in to join this group"); return false; }
  try {
    group.members = await changeGroupMembers(group.id, joined ? { remove: [state.uid] } : { add: [state.uid] });
    group.memberCount = group.members.length;
    return true;
  } catch (error) {
    toast(error?.message || "Could not update group membership");
    return false;
  }
};

class OrbitGroupRoomScene {
  constructor(stage, members) {
    this.stage = stage;
    this.members = members;
    this.disposed = false;
    this.frame = 0;
    this.lastFrame = 0;
    this.yaw = 0;
    this.pitch = 0.32;
    this.drag = null;
    this.actors = [];
    this.modelTemplates = new Map();
    this.waveIndex = 0;
    this.nextWaveAt = performance.now() + 2200;
    this.init().catch((error) => {
      if (this.disposed || !this.stage.isConnected) return;
      console.error("Orbit group room failed to start:", error);
      const loading = this.stage.querySelector(".grp-room-loading");
      if (loading) loading.textContent = "The room could not be opened. Check WebGL support and your avatar model paths.";
    });
  }

  async init() {
    const [THREE, { GLTFLoader }, skeletonUtils] = await Promise.all([
      loadOrbitThree(),
      loadOrbitGLTFLoader(),
      loadOrbitSkeletonUtils(),
    ]);
    if (this.disposed || !this.stage.isConnected) return;
    this.THREE = THREE;
    this.SkeletonUtils = skeletonUtils;
    this.loader = new GLTFLoader();
    const count = this.members.length;
    this.rings = Math.max(1, Math.ceil(count / 14));
    this.roomRadius = Math.max(25, 18 + (this.rings - 1) * 5);
    this.roomSize = this.roomRadius * 2;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x171923);
    this.scene.fog = new THREE.Fog(0x171923, this.roomSize * 1.1, this.roomSize * 2.7);
    this.camera = new THREE.PerspectiveCamera(48, 1, 0.1, 1200);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.className = "grp-room-canvas";
    this.renderer.domElement.setAttribute("aria-label", "Three-dimensional group lounge with member avatars");
    this.stage.insertBefore(this.renderer.domElement, this.stage.firstChild);
    this.createInterior();
    this.resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => this.resize()) : null;
    this.resizeObserver?.observe(this.stage);
    this.resizeHandler = () => this.resize();
    window.addEventListener("resize", this.resizeHandler);
    this.bindLookControls();
    this.resize();
    this.updateCamera();
    this.loading = this.stage.querySelector(".grp-room-loading");
    if (!count && this.loading) this.loading.textContent = "This group has no members yet.";
    this.frame = requestAnimationFrame(this.animate);
    await Promise.all(this.members.map((member, index) => this.loadMemberAvatar(member, index).catch((error) => {
      console.warn(`Could not load the GLB avatar for ${member.username || member.uid || "a group member"}:`, error);
    })));
    if (this.loading) {
      if (count) this.loading.classList.add("hidden");
      else setTimeout(() => this.loading?.classList.add("hidden"), 900);
    }
  }

  addMesh(geometry, material, x, y, z, parent = this.scene) {
    const mesh = new this.THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  createInterior() {
    const THREE = this.THREE;
    const half = this.roomSize / 2;
    const wallHeight = 15;
    const floor = new THREE.MeshStandardMaterial({ color: 0x695f59, roughness: 0.86 });
    const wall = new THREE.MeshStandardMaterial({ color: 0x2d3441, roughness: 0.9 });
    const accent = new THREE.MeshStandardMaterial({ color: 0x65517b, roughness: 0.74 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x83cbe3, emissive: 0x1e4151, emissiveIntensity: 0.4, roughness: 0.26, metalness: 0.12 });
    const trim = new THREE.MeshStandardMaterial({ color: 0xd6b982, roughness: 0.66 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x302a30, roughness: 0.74 });
    this.scene.add(new THREE.HemisphereLight(0xf2e8ff, 0x3a3028, 1.7));
    const warm = new THREE.PointLight(0xffd5a2, 110, this.roomSize * 1.1, 2);
    warm.position.set(0, wallHeight - 1, 0);
    this.scene.add(warm);
    const fill = new THREE.DirectionalLight(0xb8d7ff, 1.1);
    fill.position.set(-half * 0.7, wallHeight * 1.8, half * 0.65);
    fill.castShadow = true;
    fill.shadow.mapSize.set(1024, 1024);
    fill.shadow.camera.left = -half;
    fill.shadow.camera.right = half;
    fill.shadow.camera.top = half;
    fill.shadow.camera.bottom = -half;
    this.scene.add(fill);

    this.addMesh(new THREE.BoxGeometry(this.roomSize, 1, this.roomSize), floor, 0, -0.5, 0);
    const rugs = new THREE.MeshStandardMaterial({ color: 0x6a446b, roughness: 0.95 });
    this.addMesh(new THREE.BoxGeometry(Math.min(17, this.roomSize * 0.35), 0.12, Math.min(14, this.roomSize * 0.29)), rugs, 0, 0.08, 0);
    this.addMesh(new THREE.BoxGeometry(this.roomSize, wallHeight, 1), wall, 0, wallHeight / 2, -half, this.scene);
    this.addMesh(new THREE.BoxGeometry(1, wallHeight, this.roomSize), wall, -half, wallHeight / 2, 0, this.scene);
    this.addMesh(new THREE.BoxGeometry(1, wallHeight, this.roomSize), wall, half, wallHeight / 2, 0, this.scene);
    // Entry-side walls leave a broad doorway into the lounge.
    const doorHalf = 4.5;
    this.addMesh(new THREE.BoxGeometry(half - doorHalf, wallHeight, 1), wall, -(half + doorHalf) / 2, wallHeight / 2, half, this.scene);
    this.addMesh(new THREE.BoxGeometry(half - doorHalf, wallHeight, 1), wall, (half + doorHalf) / 2, wallHeight / 2, half, this.scene);
    this.addMesh(new THREE.BoxGeometry(doorHalf * 2, 3.5, 1), accent, 0, wallHeight - 1.75, half, this.scene);

    const windowWidth = Math.min(15, this.roomSize * 0.26);
    for (const x of [-half * 0.53, 0, half * 0.53]) {
      if (Math.abs(x) < windowWidth * 0.7 && Math.abs(x) < 1) continue;
      this.addMesh(new THREE.BoxGeometry(windowWidth, 6, 0.3), glass, x, 8.1, -half + 0.56);
      this.addMesh(new THREE.BoxGeometry(windowWidth + 0.55, 0.35, 0.42), trim, x, 11.25, -half + 0.5);
      this.addMesh(new THREE.BoxGeometry(0.24, 6.3, 0.42), trim, x, 8.1, -half + 0.5);
      this.addMesh(new THREE.BoxGeometry(0.24, 6.3, 0.42), trim, x + windowWidth, 8.1, -half + 0.5);
    }
    // Warm wall sconces and a few exposed ceiling beams make the space read as a building interior.
    for (const side of [-1, 1]) {
      for (const z of [-half * 0.55, 0, half * 0.48]) {
        const lamp = new THREE.PointLight(0xffbd79, 19, 25, 2);
        lamp.position.set(side * (half - 1.5), 7.5, z);
        this.scene.add(lamp);
        this.addMesh(new THREE.BoxGeometry(0.34, 1.8, 0.34), trim, side * (half - 1.1), 7.5, z);
      }
    }
    for (const z of [-half * 0.72, -half * 0.2, half * 0.34]) {
      this.addMesh(new THREE.BoxGeometry(this.roomSize - 1, 0.42, 0.42), dark, 0, wallHeight + 1.3, z);
    }

    // Low lounge furniture stays around the central rug, leaving the member circle open.
    const sofaMat = new THREE.MeshStandardMaterial({ color: 0x536274, roughness: 0.92 });
    const sofaAccent = new THREE.MeshStandardMaterial({ color: 0x82709a, roughness: 0.86 });
    for (const side of [-1, 1]) {
      const sofa = new THREE.Group();
      sofa.position.set(side * 7, 0, -1);
      sofa.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
      this.addMesh(new THREE.BoxGeometry(3.6, 1.3, 8), sofaMat, 0, 0.65, 0, sofa);
      this.addMesh(new THREE.BoxGeometry(3.6, 1.1, 0.7), sofaAccent, 0, 1.35, -3.6, sofa);
      for (const z of [-2.25, 0, 2.25]) this.addMesh(new THREE.BoxGeometry(3.25, 0.25, 0.18), sofaAccent, 0, 1.25, z, sofa);
      this.scene.add(sofa);
    }
    const tableTop = new THREE.MeshStandardMaterial({ color: 0x8b674b, roughness: 0.78 });
    this.addMesh(new THREE.CylinderGeometry(2.8, 2.8, 0.42, 12), tableTop, 0, 1.45, 0);
    this.addMesh(new THREE.CylinderGeometry(0.38, 0.58, 1.3, 8), dark, 0, 0.65, 0);
    // Potted plants soften each corner without taking member standing space.
    for (const [x, z] of [[-half + 4, -half + 4], [half - 4, -half + 4], [-half + 4, half - 5], [half - 4, half - 5]]) {
      this.addMesh(new THREE.CylinderGeometry(0.9, 1.15, 1.35, 8), trim, x, 0.68, z);
      this.addMesh(new THREE.ConeGeometry(1.7, 4.2, 7), new THREE.MeshStandardMaterial({ color: 0x4d885d, roughness: 1 }), x, 3.25, z);
    }
    const grid = new THREE.GridHelper(this.roomSize, Math.max(8, Math.round(this.roomSize / 5)), 0x9c7bad, 0x544e5a);
    grid.position.y = 0.02;
    grid.material.transparent = true;
    grid.material.opacity = 0.18;
    this.scene.add(grid);
  }

  getTemplate(url) {
    if (!this.modelTemplates.has(url)) {
      this.modelTemplates.set(url, new Promise((resolve, reject) => {
        this.loader.load(url, resolve, undefined, reject);
      }).catch((error) => {
        this.modelTemplates.delete(url);
        throw error;
      }));
    }
    return this.modelTemplates.get(url);
  }

  createNameplate(member) {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 112;
    const context = canvas.getContext("2d");
    context.fillStyle = "rgba(18, 21, 30, .88)";
    context.beginPath();
    context.roundRect(8, 8, 496, 96, 34);
    context.fill();
    context.fillStyle = "#fff";
    context.font = "700 27px system-ui, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    const username = `@${String(member.username || member.handle || "member").replace(/^@/, "")}`;
    context.fillText(username, 256, 57, 470);
    const texture = new this.THREE.CanvasTexture(canvas);
    texture.colorSpace = this.THREE.SRGBColorSpace;
    const sprite = new this.THREE.Sprite(new this.THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
    sprite.scale.set(3.6, 0.78, 1);
    return sprite;
  }

  async loadMemberAvatar(member, index) {
    if (this.disposed) return;
    const customUrl = member.avatarModelUrl || null;
    let gltf;
    try {
      gltf = await this.getTemplate(customUrl || "Soldier.glb");
    } catch (error) {
      if (!customUrl) throw error;
      gltf = await this.getTemplate("Soldier.glb");
    }
    if (this.disposed || !this.stage.isConnected) return;
    const model = this.SkeletonUtils.clone(gltf.scene);
    model.rotation.y = Math.PI;
    model.traverse((node) => {
      if (node.isMesh) { node.castShadow = true; node.receiveShadow = true; node.frustumCulled = false; }
    });
    model.updateMatrixWorld(true);
    const rawBounds = new this.THREE.Box3().setFromObject(model);
    const rawSize = rawBounds.getSize(new this.THREE.Vector3());
    if (rawSize.y > 0) model.scale.setScalar(customUrl ? 3.5 / rawSize.y : 1.163);
    model.updateMatrixWorld(true);
    const bounds = new this.THREE.Box3().setFromObject(model);
    model.position.x -= (bounds.min.x + bounds.max.x) / 2;
    model.position.y -= bounds.min.y;
    model.position.z -= (bounds.min.z + bounds.max.z) / 2;
    const height = bounds.getSize(new this.THREE.Vector3()).y;

    const actor = new this.THREE.Group();
    actor.add(model);
    const ringIndex = Math.floor(index / 14);
    const slot = index % 14;
    const ringCount = Math.min(14, this.members.length - ringIndex * 14);
    const angle = Math.PI * 2 * slot / Math.max(1, ringCount);
    const radius = Math.min(this.roomRadius - 8, 10 + ringIndex * 5);
    actor.position.set(Math.sin(angle) * radius, 0, Math.cos(angle) * radius);
    actor.rotation.y = angle;
    const nameplate = this.createNameplate(member);
    nameplate.position.y = Math.max(4.6, height + 0.65);
    actor.add(nameplate);
    this.scene.add(actor);

    const clips = gltf.animations || [];
    const mixer = clips.length ? new this.THREE.AnimationMixer(model) : null;
    const idleClip = clips.find((clip) => /idle|stand|relax|sit|breath/i.test(clip.name)) || clips[0] || null;
    const waveClip = clips.find((clip) => /wave|hello|greet|welcome/i.test(clip.name)) || null;
    const idleAction = mixer && idleClip ? mixer.clipAction(idleClip) : null;
    const waveAction = mixer && waveClip ? mixer.clipAction(waveClip) : null;
    if (idleAction) idleAction.play();
    let waveBone = null;
    let bodyBone = null;
    model.traverse((node) => {
      if (!waveBone && node.isBone && /right.*(upper.?arm|arm|shoulder)|upper.?arm.?r|arm.?r|shoulder.?r/i.test(node.name)) waveBone = node;
      if (!bodyBone && node.isBone && /(hips|spine|chest|torso)/i.test(node.name)) bodyBone = node;
    });
    this.actors.push({ actor, mixer, idleAction, waveAction, waveBone, waveBase: waveBone?.rotation.clone(), bodyBone, bodyBase: bodyBone?.rotation.clone(), idlePhase: index * 0.9, waveStart: 0, waveEnd: 0, waved: false });
  }

  beginWave(actor, now) {
    if (!actor) return;
    actor.waveStart = now;
    actor.waveEnd = now + 2400;
    actor.waved = true;
    if (actor.waveAction) {
      actor.idleAction?.fadeOut(0.2);
      actor.waveAction.reset();
      actor.waveAction.setLoop(this.THREE.LoopOnce, 1);
      actor.waveAction.clampWhenFinished = true;
      actor.waveAction.fadeIn(0.2).play();
    }
  }

  updateWave(actor, now) {
    if (!actor.waved) return;
    if (now < actor.waveEnd) {
      if (!actor.waveAction && actor.waveBone && actor.waveBase) {
        const phase = (now - actor.waveStart) / 1000;
        actor.waveBone.rotation.z = actor.waveBase.z + 1.8 + Math.sin(phase * 13) * 0.24;
        actor.waveBone.rotation.x = actor.waveBase.x + Math.sin(phase * 6) * 0.13;
      }
      return;
    }
    if (actor.waveBone && actor.waveBase) actor.waveBone.rotation.copy(actor.waveBase);
    actor.waveAction?.fadeOut(0.2);
    if (actor.idleAction) actor.idleAction.reset().fadeIn(0.2).play();
    actor.waved = false;
  }

  bindLookControls() {
    const canvas = this.renderer.domElement;
    this.onPointerDown = (event) => {
      this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
      canvas.setPointerCapture?.(event.pointerId);
    };
    this.onPointerMove = (event) => {
      if (!this.drag || this.drag.id !== event.pointerId) return;
      const dx = event.clientX - this.drag.x;
      const dy = event.clientY - this.drag.y;
      this.drag.x = event.clientX;
      this.drag.y = event.clientY;
      this.yaw -= dx * 0.005;
      this.pitch = Math.max(0.12, Math.min(0.68, this.pitch + dy * 0.003));
      this.updateCamera();
    };
    this.onPointerUp = () => { this.drag = null; };
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointercancel", this.onPointerUp);
  }

  updateCamera() {
    if (!this.camera || !this.roomSize) return;
    const distance = this.roomRadius * 0.72;
    const horizontal = distance * Math.cos(this.pitch);
    this.camera.position.set(Math.sin(this.yaw) * horizontal, distance * Math.sin(this.pitch) + 6, Math.cos(this.yaw) * horizontal);
    this.camera.lookAt(0, 4, 0);
  }

  resize() {
    if (!this.renderer || this.disposed) return;
    const width = Math.max(1, this.stage.clientWidth);
    const height = Math.max(1, this.stage.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  animate = (now = performance.now()) => {
    if (this.disposed || !this.stage.isConnected) { this.destroy(); return; }
    this.frame = requestAnimationFrame(this.animate);
    const dt = Math.min(50, this.lastFrame ? now - this.lastFrame : 16.7) / 1000;
    this.lastFrame = now;
    if (this.actors.length && now >= this.nextWaveAt) {
      this.beginWave(this.actors[this.waveIndex % this.actors.length], now);
      this.waveIndex++;
      this.nextWaveAt = now + 4200 + (this.waveIndex % 3) * 900;
    }
    this.actors.forEach((actor) => {
      actor.mixer?.update(dt);
      this.updateWave(actor, now);
      if (!actor.mixer && actor.bodyBone && actor.bodyBase && !actor.waved) {
        actor.bodyBone.rotation.x = actor.bodyBase.x + Math.sin(now * 0.0015 + actor.idlePhase) * 0.035;
        actor.actor.position.y = Math.sin(now * 0.0018 + actor.idlePhase) * 0.055;
      }
    });
    this.renderer.render(this.scene, this.camera);
  };

  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.resizeObserver?.disconnect();
    if (this.resizeHandler) window.removeEventListener("resize", this.resizeHandler);
    const canvas = this.renderer?.domElement;
    if (canvas) {
      canvas.removeEventListener("pointerdown", this.onPointerDown);
      canvas.removeEventListener("pointermove", this.onPointerMove);
      canvas.removeEventListener("pointerup", this.onPointerUp);
      canvas.removeEventListener("pointercancel", this.onPointerUp);
    }
    this.scene?.traverse((node) => {
      if (node.geometry) node.geometry.dispose();
      if (node.material) {
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        materials.forEach((material) => { material.map?.dispose(); material.dispose(); });
      }
    });
    this.renderer?.dispose();
    canvas?.remove();
  }
}

const renderGroupRoom = async (root, groupId) => {
  const token = root._routeRenderToken;
  let roomScene = null;
  root._groupRoomCleanup = () => { roomScene?.destroy(); roomScene = null; };
  const page = el("div", { class: "grp-room-experience" });
  const stage = el("div", { class: "grp-room-stage", role: "application", "aria-label": "Group members' shared 3D building room" });
  const loading = el("div", { class: "grp-room-loading" }, el("span", { class: "grp-city-spinner" }), el("strong", {}, "Opening the building room…"));
  const top = el("div", { class: "grp-room-hud-top" },
    el("button", { class: "grp-room-back", onclick: () => { location.hash = "#groups"; } }, el("i", { class: "ri-arrow-left-line" }), " City"),
    el("div", { class: "grp-room-title-pill" }, "Entering group room…"),
    el("span", { class: "grp-room-member-count" }, ""),
  );
  const chatButton = el("button", { class: "grp-room-chat-btn", disabled: true }, el("i", { class: "ri-chat-3-line" }), " Skip to chat");
  const footer = el("div", { class: "grp-room-hud-bottom" }, el("span", { class: "grp-room-swipe-hint" }, "Swipe to look around"), chatButton);
  stage.append(loading, top, footer);
  page.appendChild(stage);
  root.appendChild(page);
  try {
    const snap = await getDoc(doc(db, "groups", groupId));
    if (root._routeRenderToken !== token || !root.isConnected) return;
    if (!snap.exists()) {
      loading.innerHTML = "";
      loading.append(el("strong", {}, "Group not found"), el("button", { class: "grp-room-back", onclick: () => { location.hash = "#groups"; } }, "Back to city"));
      return;
    }
    const group = { id: groupId, ...snap.data() };
    const memberIds = [...new Set(group.members || [])];
    const fetched = await Promise.all(memberIds.map(async (uid) => {
      try { return await fetchUser(uid) || { uid, name: "Orbit member", username: "member" }; }
      catch { return { uid, name: "Orbit member", username: "member" }; }
    }));
    if (root._routeRenderToken !== token || !root.isConnected) return;
    const titlePill = page.querySelector(".grp-room-title-pill");
    titlePill.textContent = group.name || "Orbit group";
    page.querySelector(".grp-room-member-count").textContent = `${fetched.length}/${MAX_GROUP_MEMBERS} members`;
    const updateChatButton = () => {
      const joined = (group.members || []).includes(state.uid);
      chatButton.disabled = false;
      chatButton.innerHTML = "";
      chatButton.appendChild(el("i", { class: "ri-chat-3-line" }));
      chatButton.appendChild(document.createTextNode(joined ? " Skip to chat" : " Join group & open chat"));
    };
    updateChatButton();
    chatButton.addEventListener("click", async () => {
      const joined = (group.members || []).includes(state.uid);
      if (!joined && !(await setGroupMembership(group, false))) return;
      location.hash = `#chats/${group.id}`;
    });
    roomScene = new OrbitGroupRoomScene(stage, fetched);
  } catch (error) {
    if (root._routeRenderToken !== token) return;
    loading.innerHTML = "";
    loading.append(el("strong", {}, "Could not open this group room"), el("span", {}, error?.message || "Check your connection and try again."), el("button", { class: "grp-room-back", onclick: () => { location.hash = "#groups"; } }, "Back to city"));
  }
};

const renderGroups = (root) => {
  const wrap = el("div", { class: "grp-wrap grp-city-wrap" });
  const modalHost = el("div", { class: "grp-city-modal-host" });
  const stage = el("div", { class: "grp-city-stage grp-city-fullscreen", role: "application", "aria-label": "Interactive Orbit group city" });
  const loading = el("div", { class: "grp-city-loading" },
    el("span", { class: "grp-city-spinner" }),
    el("strong", {}, "Loading the city…"),
  );
  const nearby = el("div", { class: "grp-city-nearby", "aria-live": "polite" },
    el("span", { class: "grp-city-nearby-title" }, "Walk around to find a group"),
    el("span", { class: "grp-city-nearby-hint" }, "Use the joystick to move · swipe to look"),
  );
  const enter = el("button", { class: "grp-city-enter hidden", type: "button" }, el("i", { class: "ri-door-open-line" }), " Group info & enter");
  const joystick = el("div", { class: "grp-city-joystick", role: "application", "aria-label": "Move around the city" },
    el("span", { class: "grp-city-joystick-arrows" }, "✥"),
    el("span", { class: "grp-city-joystick-thumb" }),
  );
  const swipe = el("div", { class: "grp-city-swipe-zone", "aria-label": "Swipe to turn the view" });
  stage.append(loading, swipe, nearby, enter, joystick, el("div", { class: "grp-city-control-hint" }, "MOVE"));
  wrap.append(stage, modalHost);
  root.appendChild(wrap);

  let allGroups = [];
  let currentNearby = null;
  let modalDismissedFor = null;

  const showGroupInfo = (group) => {
    modalHost.innerHTML = "";
    const joined = (group.members || []).includes(state.uid);
    const about = group.about || group.description || "A place for members to meet, share, and keep the conversation going.";
    const close = () => { modalHost.innerHTML = ""; modalDismissedFor = group.id; };
    const backdrop = el("div", { class: "grp-city-modal-backdrop", role: "presentation", onclick: (event) => { if (event.target === backdrop) close(); } });
    const joinButton = el("button", { class: "grp-city-modal-secondary", onclick: async () => {
      if (!(await setGroupMembership(group, (group.members || []).includes(state.uid)))) return;
      showGroupInfo(group);
    } }, joined ? "Leave group" : "Join group");
    const card = el("section", { class: "grp-city-modal", role: "dialog", "aria-modal": "true", "aria-label": `${group.name || "Group"} information` },
      el("button", { class: "grp-city-modal-close", type: "button", "aria-label": "Close group info", onclick: close }, el("i", { class: "ri-close-line" })),
      el("div", { class: "grp-city-modal-mark" }, group.iconUrl ? el("img", { src: group.iconUrl, alt: "" }) : (group.name || "G").trim().charAt(0).toUpperCase()),
      el("span", { class: "grp-room-eyebrow" }, group.category || "ORBIT COMMUNITY"),
      el("h2", {}, group.name || "Orbit group"),
      el("p", { class: "grp-city-modal-about" }, about),
      el("div", { class: "grp-city-modal-meta" }, el("span", {}, el("i", { class: "ri-group-line" }), ` ${groupMemberCount(group)}/${MAX_GROUP_MEMBERS} members`), joined ? el("span", { class: "grp-city-joined" }, "Joined") : null),
      el("div", { class: "grp-city-modal-actions" },
        joinButton,
        el("button", { class: "grp-city-modal-enter", onclick: () => { location.hash = `#groups/${group.id}`; } }, el("i", { class: "ri-door-open-line" }), " Enter group room"),
      ),
    );
    backdrop.appendChild(card);
    modalHost.appendChild(backdrop);
  };

  const onNearby = (group) => {
    currentNearby = group;
    if (!group) {
      nearby.innerHTML = "";
      nearby.append(el("span", { class: "grp-city-nearby-title" }, "Walk around to find a group"), el("span", { class: "grp-city-nearby-hint" }, "Use the joystick to move · swipe to look"));
      enter.classList.add("hidden");
      return;
    }
    nearby.innerHTML = "";
    nearby.append(el("span", { class: "grp-city-nearby-title" }, group.name || "Orbit group"), el("span", { class: "grp-city-nearby-hint" }, `${groupMemberCount(group)} members · nearby`));
    enter.classList.remove("hidden");
    if (modalDismissedFor !== group.id) showGroupInfo(group);
  };

  const renderCity = () => {
    if (root._groupCityCleanup) { root._groupCityCleanup(); root._groupCityCleanup = null; }
    stage.innerHTML = "";
    modalHost.innerHTML = "";
    currentNearby = null;
    if (!allGroups.length) {
      stage.appendChild(el("div", { class: "grp-city-loading" }, el("strong", {}, "No groups to explore yet")));
      return;
    }
    stage.append(
      el("div", { class: "grp-city-loading" }, el("span", { class: "grp-city-spinner" }), el("strong", {}, "Loading the city…")),
      el("div", { class: "grp-city-swipe-zone", "aria-label": "Swipe to turn the view" }),
      nearby,
      enter,
      joystick,
      el("div", { class: "grp-city-control-hint" }, "MOVE"),
    );
    const city = new OrbitGroupsCity(stage, allGroups, onNearby);
    enter.onclick = () => { if (currentNearby) showGroupInfo(currentNearby); };
    root._groupCityCleanup = () => city.destroy();
  };

  const loadAllGroups = async () => {
    const docs = [];
    let cursor = null;
    let hasMore = true;
    while (hasMore) {
      const constraints = [collection(db, "groups"), orderBy("createdAt", "desc"), limit(80)];
      if (cursor) constraints.push(startAfter(cursor));
      const page = await getDocs(query(...constraints));
      docs.push(...page.docs);
      cursor = page.docs[page.docs.length - 1] || null;
      hasMore = page.docs.length === 80 && !!cursor;
    }
    return docs;
  };

  loadAllGroups().then((docs) => {
    if (!wrap.isConnected) return;
    allGroups = docs.map((d) => ({ id: d.id, ...d.data() }));
    renderCity();
  }).catch((error) => {
    if (!wrap.isConnected) return;
    stage.innerHTML = "";
    stage.appendChild(el("div", { class: "grp-city-loading" }, el("strong", {}, "Could not load the city"), el("span", {}, "Check your connection and try again.")));
    console.error("Could not load group city:", error);
  });
};

// =========================================================================
// 11. EXPLORE / SAVED
// =========================================================================
const renderExplore = (root, hashtagFilter = null) => {
  // ── Hashtag filter view (grid) ────────────────────────────────────────────
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

  // ── Full Discover page ────────────────────────────────────────────────────
  const wrap = el("div", { class: "disc-wrap" });
  root.appendChild(wrap);

  // 1. Header ──────────────────────────────────────────────────────────────
  const unreadDot = el("span", { class: "disc-badge-dot", style: "display:none;" });
  const bellIcon  = el("span", { class: "disc-icon disc-bell" }, "🔔", unreadDot);
  bellIcon.onclick = () => { location.hash = "#notifications"; };
  const notifPill = document.getElementById("notifPill");
  if (notifPill && !notifPill.hidden && parseInt(notifPill.textContent || "0") > 0) {
    unreadDot.style.display = "";
  }

  const searchBox    = el("div", { class: "disc-search-box hidden" });
  const searchInput  = el("input", { type: "text", placeholder: "Search people, hashtags…" });
  const searchResultsEl = el("div", { class: "explore-search-results hidden" });
  searchBox.appendChild(searchInput);
  searchBox.appendChild(searchResultsEl);

  const searchIcon = el("span", { class: "disc-icon" }, "🔍");
  searchIcon.onclick = () => {
    searchBox.classList.toggle("hidden");
    if (!searchBox.classList.contains("hidden")) searchInput.focus();
  };

  wrap.appendChild(el("div", { class: "disc-header" },
    el("h1", {}, "Discover"),
    el("div", { class: "disc-header-icons" }, searchIcon, bellIcon),
  ));
  wrap.appendChild(searchBox);

  // Search logic
  let _sd = null;
  searchInput.addEventListener("input", () => {
    clearTimeout(_sd);
    const q1 = searchInput.value.trim().toLowerCase();
    if (!q1) { searchResultsEl.classList.add("hidden"); searchResultsEl.innerHTML = ""; return; }
    _sd = setTimeout(async () => {
      searchResultsEl.innerHTML = "";
      searchResultsEl.classList.remove("hidden");
      if (q1.startsWith("#")) {
        searchResultsEl.appendChild(el("div", { class: "explore-search-item", onclick: () => location.hash = `#explore/tag/${q1.slice(1)}` },
          el("i", { class: "ri-hashtag" }), el("span", {}, q1)));
        return;
      }
      const snap = await getDocs(query(collection(db, "users"), orderBy("username"), limit(200))).catch(() => null);
      if (!snap) return;
      const matches = snap.docs
        .map((d) => ({ uid: d.id, ...d.data() }))
        .filter((u) => u.uid !== state.uid && ((u.name || "").toLowerCase().includes(q1) || (u.username || "").toLowerCase().includes(q1)))
        .slice(0, 12);
      if (!matches.length) { searchResultsEl.appendChild(el("div", { class: "explore-search-empty" }, "No matches")); return; }
      matches.forEach((u) => searchResultsEl.appendChild(
        el("div", { class: "explore-search-item", onclick: () => location.hash = `#profile/${u.uid}` },
          el("img", { class: "avatar xs", src: avatarFor(u) }),
          el("div", {}, el("div", { class: "esi-name" }, u.name || "User"), el("div", { class: "esi-sub" }, "@" + (u.username || "user"))),
        )
      ));
    }, 250);
  });
  document.addEventListener("click", (e) => {
    if (!searchBox.contains(e.target) && e.target !== searchIcon) searchBox.classList.add("hidden");
  });

  // 2. Filter pills ─────────────────────────────────────────────────────────
  const pillLabels  = ["For You", "Trending", "People", "Topics", "Live"];
  let activeFilter  = "For You";
  const pillRow     = el("div", { class: "disc-pills" });
  const pillEls     = pillLabels.map((label) => {
    const pill = el("span", { class: "disc-pill" + (label === activeFilter ? " active" : "") }, label);
    pill.onclick = () => {
      pillEls.forEach((p) => p.classList.remove("active"));
      pill.classList.add("active");
      activeFilter = label;
    };
    return pill;
  });
  pillEls.forEach((p) => pillRow.appendChild(p));
  wrap.appendChild(pillRow);

  // 3 & 4. Trending Now ─────────────────────────────────────────────────────
  wrap.appendChild(el("div", { class: "disc-section-header" },
    el("h2", {}, "Trending Now 🔥"),
    el("span", { class: "disc-see-all" }, "See all"),
  ));
  const trendRow = el("div", { class: "disc-trend-row" });
  wrap.appendChild(trendRow);

  getDocs(query(collection(db, "posts"), orderBy("orbitCount", "desc"), limit(80)))
    .then((snap) => {
      // Aggregate hashtags → weight + cover image
      const tagData = {};
      snap.docs.forEach((d) => {
        const p = d.data();
        const tags = p.hashtags || [];
        const media = Array.isArray(p.media) ? p.media : (p.media ? [p.media] : []);
        const imgUrl = media.find((m) => m.type === "image")?.url || null;
        tags.forEach((tag) => {
          if (!tagData[tag]) tagData[tag] = { count: 0, imageUrl: null };
          tagData[tag].count += (p.orbitCount || 0) + 1;
          if (!tagData[tag].imageUrl && imgUrl) tagData[tag].imageUrl = imgUrl;
        });
      });
      const sorted = Object.entries(tagData).sort((a, b) => b[1].count - a[1].count).slice(0, 10);
      const fallbackGrads = [
        "linear-gradient(135deg,#1a1a2e,#16213e)",
        "linear-gradient(135deg,#0f0c29,#302b63)",
        "linear-gradient(135deg,#1a1a1a,#2d2d2d)",
        "linear-gradient(135deg,#111827,#1f2937)",
        "linear-gradient(135deg,#0d0d0d,#1a1a1a)",
      ];
      if (!sorted.length) {
        trendRow.appendChild(el("div", { style: "padding:0 16px;color:var(--text-mute);font-size:13px;" }, "No trending topics yet"));
        return;
      }
      sorted.forEach(([tag, data], i) => {
        const bgStyle = data.imageUrl
          ? `background-image:url('${data.imageUrl}');background-size:cover;background-position:center;`
          : `background:${fallbackGrads[i % fallbackGrads.length]};`;
        const countStr = data.count > 999
          ? (data.count / 1000).toFixed(1) + "K"
          : String(data.count);
        trendRow.appendChild(el("div", {
          class: "disc-trend-card",
          style: bgStyle,
          onclick: () => location.hash = `#explore/tag/${tag}`,
        },
          el("div", { class: "disc-trend-overlay" },
            el("span", { class: "disc-trend-title" }, `#${tag}`),
            el("span", { class: "disc-trend-count" }, `${countStr} orbits`),
          ),
        ));
      });
    }).catch(() => {
      trendRow.appendChild(el("div", { style: "padding:0 16px;color:var(--text-mute);font-size:13px;" }, "Could not load trends"));
    });

  // 5 & 6. People to Meet ───────────────────────────────────────────────────
  wrap.appendChild(el("div", { class: "disc-section-header" },
    el("h2", {}, "People to meet"),
    el("span", { class: "disc-see-all" }, "See all"),
  ));
  const peopleList = el("div", { class: "disc-people-list" });
  wrap.appendChild(peopleList);

  getDocs(query(collection(db, "users"), limit(40)))
    .then((snap) => {
      const following = state.me?.following || [];
      const friends = state.me?.friends || [];
      const suggestions = snap.docs
        .map((d) => ({ uid: d.id, ...d.data() }))
        .filter((u) => u.uid !== state.uid && !following.includes(u.uid) && !friends.includes(u.uid))
        .sort((a, b) => (b.followers?.length || 0) - (a.followers?.length || 0))
        .slice(0, 6);

      if (!suggestions.length) {
        peopleList.appendChild(el("div", { style: "color:var(--text-mute);font-size:13px;padding:0 0 8px;" },
          "No new people to meet right now — check back soon."));
        return;
      }

      suggestions.forEach((u) => {
        const roleText = u.bio ? u.bio.slice(0, 42) : (u.verified ? "Verified member" : "Orbit member");
        peopleList.appendChild(el("div", { class: "disc-people-row" },
          el("img", {
            class: "disc-people-avatar",
            src: avatarFor(u),
            style: "cursor:pointer;",
            onclick: () => location.hash = `#profile/${u.uid}`,
          }),
          el("div", {
            class: "disc-people-info",
            onclick: () => location.hash = `#profile/${u.uid}`,
          },
            el("span", { class: "disc-people-name" },
              u.name || "User",
              u.verified ? el("span", { class: "verified", html: '<i class="ri-check-line"></i>' }) : null,
            ),
            el("span", { class: "disc-people-handle" }, `@${u.username || "user"}`),
            el("span", { class: "disc-people-role" }, roleText),
          ),
          orbitFriendControls(u, { compact: true }),
        ));
      });
    }).catch(() => {});

  // 7 & 8. Popular Posts ────────────────────────────────────────────────────
  wrap.appendChild(el("div", { class: "disc-section-header", style: "margin-top:8px;" },
    el("h2", {}, "Popular Posts"),
  ));
  // NOTE: intentionally NOT "feed-wrap" — that class triggers global story/suggestion
  // hooks from features.js/additional.js that belong only on the home feed.
  const postsList = el("div", { class: "disc-posts-list" });
  wrap.appendChild(postsList);

  // Skeleton loading — show 4 placeholder cards while Firestore loads
  const _makeSkeleton = () => el("div", { class: "disc-skel-post" },
    el("div", { class: "disc-skel-head" },
      el("div", { class: "disc-skel-avatar" }),
      el("div", { class: "disc-skel-meta" },
        el("div", { class: "disc-skel-line w60" }),
        el("div", { class: "disc-skel-line w40" }),
      ),
    ),
    el("div", { class: "disc-skel-line w100", style: "height:14px;margin-bottom:6px;" }),
    el("div", { class: "disc-skel-line w80", style: "height:14px;margin-bottom:6px;" }),
    el("div", { class: "disc-skel-media" }),
  );
  for (let i = 0; i < 4; i++) postsList.appendChild(_makeSkeleton());

  getDocs(query(collection(db, "posts"), orderBy("orbitCount", "desc"), limit(20)))
    .then(async (snap) => {
      postsList.innerHTML = ""; // clear skeletons
      if (snap.empty) {
        postsList.appendChild(el("div", { class: "empty" },
          el("i", { class: "ri-planet-line" }),
          el("div", { class: "t" }, "No popular posts yet")));
        return;
      }
      const posts   = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const uids    = [...new Set(posts.map((p) => p.authorUid))];
      const authors = await Promise.all(uids.map(fetchUser));
      const byUid   = Object.fromEntries(authors.filter(Boolean).map((u) => [u.uid, u]));
      posts.slice(0, 10).forEach((p) => {
        postsList.appendChild(renderPost(p, byUid[p.authorUid]));
        postsList.appendChild(el("div", { class: "tfb-divider" }));
      });
      _setupFeedVideoScroll(postsList);
    }).catch(() => { postsList.innerHTML = ""; });
}

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
    _setupFeedVideoScroll(list);
  });
};

// =========================================================================
// 12. PROFILE
// =========================================================================
// Tracks the live listener for whichever profile tab (Posts / Media) is
// currently rendered, so posting or switching tabs never leaves a stale
// listener running and the visible tab always reflects Firestore live.
let _profileTabUnsub = null;

const formatProfileBirthday = (value) => {
  const match = /^(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return "";
  const date = new Date(2000, Number(match[1]) - 1, Number(match[2]), 12);
  if (date.getMonth() !== Number(match[1]) - 1 || date.getDate() !== Number(match[2])) return "";
  return date.toLocaleDateString(undefined, { month: "long", day: "numeric" });
};

const addOrbitFriend = async (peerUid) => {
  if (!state.uid || !peerUid || peerUid === state.uid) return false;
  const batch = writeBatch(db);
  batch.update(doc(db, "users", state.uid), { friends: arrayUnion(peerUid) });
  batch.update(doc(db, "users", peerUid), { friends: arrayUnion(state.uid) });
  try {
    await batch.commit();
  } catch {
    toast("Could not add friend. Check your connection and try again.");
    return false;
  }
  const friends = [...new Set([...(state.me?.friends || []), peerUid])];
  state.me = { ...(state.me || {}), uid: state.uid, friends };
  state.cache.users.set(state.uid, state.me);
  state.cache.users.delete(peerUid);
  return true;
};

const removeOrbitFriend = async (peerUid) => {
  if (!state.uid || !peerUid || peerUid === state.uid) return false;
  const batch = writeBatch(db);
  batch.update(doc(db, "users", state.uid), { friends: arrayRemove(peerUid) });
  batch.update(doc(db, "users", peerUid), { friends: arrayRemove(state.uid) });
  try {
    await batch.commit();
  } catch {
    toast("Could not remove friend. Check your connection and try again.");
    return false;
  }
  const friends = (state.me?.friends || []).filter((friendUid) => friendUid !== peerUid);
  state.me = { ...(state.me || {}), uid: state.uid, friends };
  state.cache.users.set(state.uid, state.me);
  state.cache.users.delete(peerUid);
  return true;
};

const orbitFriendControls = (user, { compact = false, stacked = false } = {}) => {
  const peerUid = user?.uid;
  if (!peerUid || peerUid === state.uid) return null;
  let isFriend = (state.me?.friends || []).includes(peerUid);
  const friendButton = el("button", {
    class: `btn sm ${isFriend ? "ghost" : "primary"}`,
    title: isFriend ? `Open ${user.name || "friend"} info` : `Add ${user.name || "user"} as a friend`,
    onclick: async () => {
      if (isFriend) {
        location.hash = `#friends/${peerUid}`;
        return;
      }
      friendButton.disabled = true;
      friendButton.textContent = "Adding…";
      const added = await addOrbitFriend(peerUid);
      if (!added) {
        friendButton.disabled = false;
        friendButton.textContent = "Add friend";
        return;
      }
      isFriend = true;
      friendButton.className = "btn sm ghost";
      friendButton.textContent = "Friends";
      friendButton.title = `Open ${user.name || "friend"} info`;
      location.hash = `#friends/${peerUid}`;
    },
  }, isFriend ? "Friends" : "Add friend");
  const infoButton = el("button", {
    class: "btn sm ghost",
    title: `Info about ${user.name || "user"}`,
    "aria-label": `Info about ${user.name || "user"}`,
    onclick: () => { location.hash = `#friends/${peerUid}`; },
  }, el("i", { class: "ri-information-line" }), compact ? "" : " Info");
  return el("div", {
    class: `orbit-user-actions${compact ? " compact" : ""}${stacked ? " stacked" : ""}`,
  }, friendButton, infoButton);
};

const renderProfile = async (root, uid) => {
  const routeRenderToken = root._routeRenderToken;
  // Always use fresh data for own profile (bypass stale cache after Pro activation)
  let u;
  if (uid === state.uid) {
    state.cache.users.delete(uid);
    u = await fetchUser(uid);
    if (u) state.me = { ...state.me, ...u };
  } else {
    u = await fetchUser(uid);
  }
  if (routeRenderToken !== root._routeRenderToken) return;
  if (!u) {
    root.appendChild(el("div", { class: "empty" }, el("i", { class: "ri-user-line" }), el("div", { class: "t" }, "User not found")));
    return;
  }
  const isMe = uid === state.uid;
  let _isFriend = (state.me?.friends || []).includes(uid);
  const canViewPrivateProfile = isMe || !u.privateAccount || _isFriend || (state.me?.following || []).includes(uid);

  // Live-update follower count in-place — no full page re-render on follow/unfollow
  const followersCountEl = el("strong", {}, String((u.followers || []).length));
  const postsCountEl = el("strong", {}, String(u.postCount || 0));

  let profileFriendBtn = null;
  let compactFriendBtn = null;
  let friendWriteInProgress = false;
  const syncFriendButtons = () => {
    [profileFriendBtn, compactFriendBtn].filter(Boolean).forEach((button) => {
      button.disabled = false;
      button.className = `btn ${_isFriend ? "ghost" : "primary"}${button === compactFriendBtn ? " compact-follow" : ""}`;
      button.textContent = _isFriend ? "Friends" : "Add friend";
    });
  };
  const openFriendInfo = () => { location.hash = `#friends/${uid}`; };
  const addFriendOrOpenPage = async () => {
    if (_isFriend) { openFriendInfo(); return; }
    if (friendWriteInProgress || isMe) return;
    friendWriteInProgress = true;
    [profileFriendBtn, compactFriendBtn].filter(Boolean).forEach((button) => {
      button.disabled = true;
      button.textContent = "Adding…";
    });
    const added = await addOrbitFriend(uid);
    friendWriteInProgress = false;
    if (!added) { syncFriendButtons(); return; }
    _isFriend = true;
    syncFriendButtons();
    openFriendInfo();
  };
  if (!isMe) {
    profileFriendBtn = el("button", {
      class: `btn ${_isFriend ? "ghost" : "primary"}`,
      onclick: addFriendOrOpenPage,
    }, _isFriend ? "Friends" : "Add friend");
  }
  const profileInfoBtn = !isMe
    ? el("button", {
        class: "btn ghost friend-info-btn",
        title: "Open friend info",
        onclick: openFriendInfo,
      }, el("i", { class: "ri-information-line" }), " Info")
    : null;

  const profileShell = el("div", { class: "profile-shell" });
  root.appendChild(profileShell);
  const profileAvatar = el("div", {
    class: "avatar xl profile-main-avatar orbit-character",
    role: "img",
    "aria-label": `${u.name || "Profile"} 3D character`,
  }, el("img", { class: "orbit-character-fallback", src: avatarFor(u), alt: "", loading: "lazy" }));
  const profileHead = el("div", { class: "profile-head" },
    profileCoverFor(u)
      ? el("div", { class: "profile-cover" },
          el("img", { src: profileCoverFor(u), alt: `${u.name || "Profile"} cover photo` }))
      : el("div", { class: "profile-cover profile-cover-empty" }),
    el("div", { class: "profile-head-main" },
      profileAvatar,
      el("div", { class: "profile-head-copy" },
        el("div", { class: "name-row" }, u.name,
          u.verified ? el("span", { class: "verified lg", title: "Location verified", html: '<i class="ri-check-line"></i>' }) : null,
          u.isPro ? el("span", { class: "pro-name-badge" }, el("i", { class: "ri-vip-crown-fill" }), " Pro") : null),
        el("div", { class: "uname" }, "@" + u.username),
        el("div", { class: "stats" },
          el("div", { class: "stat" }, postsCountEl, el("span", {}, "posts")),
          el("div", { class: "stat" }, followersCountEl, el("span", {}, "followers")),
          el("div", { class: "stat" }, el("strong", {}, String((u.following || []).length)), el("span", {}, "following")),
        ),
        u.bio ? el("div", { class: "bio", text: u.bio }) : null,
        u.birthday && formatProfileBirthday(u.birthday)
          ? el("div", { class: "profile-birthday" }, el("i", { class: "ri-cake-2-line" }), `Birthday ${formatProfileBirthday(u.birthday)}`)
          : null,
        el("div", { class: "profile-actions" },
          isMe
            ? el("button", { class: "btn ghost", onclick: () => openProfileEditModal() }, el("i", { class: "ri-edit-line" }), "Edit profile")
            : profileFriendBtn,
          profileInfoBtn,
          isMe ? el("button", { class: "btn ghost", onclick: () => { location.hash = "#friends"; } },
            el("i", { class: "ri-group-line" }), "Friends") : null,
          !isMe && u.allowMessages !== false ? el("button", { class: "btn ghost", onclick: () => location.hash = `#chats/${uid}` },
            el("i", { class: "ri-chat-3-line" }), "Message") : null,
          isMe && !u.verified ? el("button", { class: "btn ghost", onclick: requestLocationVerification },
            el("i", { class: "ri-shield-check-line" }), "Get verified") : null,
        ),
      ),
    ),
  );
  profileShell.appendChild(profileHead);
  const profileCharacterCleanup = [];

  const compactPostsCountEl = el("span", {}, `${postsCountEl.textContent} posts`);
  const compactAvatar = el("div", {
    class: "avatar sm profile-compact-avatar orbit-character",
    role: "img",
    "aria-label": `${u.name || "Profile"} 3D character`,
  }, el("img", { class: "orbit-character-fallback", src: avatarFor(u), alt: "", loading: "lazy" }));
  const compactBar = el("div", { class: "profile-compact-bar" },
    compactAvatar,
    el("div", { class: "profile-compact-name" },
      el("strong", {}, u.name || "User"),
      compactPostsCountEl,
    ),
    el("span", { class: "profile-compact-count" }, `${postsCountEl.textContent} posts`),
  );
  if (!isMe) {
    compactFriendBtn = el("button", {
      class: `btn compact-follow ${_isFriend ? "ghost" : "primary"}`,
      onclick: addFriendOrOpenPage,
    }, _isFriend ? "Friends" : "Add friend");
    compactBar.appendChild(compactFriendBtn);
  }
  profileShell.appendChild(compactBar);
import("./character.js?v=orbit-avatar-1").then(({ mountProfileCharacter }) => {
  if (routeRenderToken !== root._routeRenderToken || !profileShell.isConnected) return;
  profileCharacterCleanup.push(
    mountProfileCharacter(profileAvatar, {
      photoURL: avatarFor(u),
      alt: `${u.name || "Profile"} character avatar`,
      scrollRoot: root,
      modelURL: u.avatarModelUrl || null,
      animationMap: u.avatarAnimationMap || null,
    }),
    mountProfileCharacter(compactAvatar, {
      photoURL: avatarFor(u),
      alt: `${u.name || "Profile"} character avatar`,
      scrollRoot: root,
      modelURL: u.avatarModelUrl || null,
      animationMap: u.avatarAnimationMap || null,
    }),
  );
}).catch((error) => console.warn("Orbit character module failed to load.", error));
  const onProfileScroll = () => profileShell.classList.toggle("profile-scrolled", root.scrollTop > 170);
  root.addEventListener("scroll", onProfileScroll, { passive: true });
  profileShell._cleanupScroll = () => root.removeEventListener("scroll", onProfileScroll);
  root._profileCleanup = () => {
    profileShell._cleanupScroll?.();
    profileCharacterCleanup.forEach((cleanup) => cleanup());
    if (_profileTabUnsub) {
      _profileTabUnsub();
      _profileTabUnsub = null;
    }
  };

  // Feature: Pro section — rendered directly below header, always visible
  const proSection = el("div", { class: "profile-pro-section" });
  profileShell.appendChild(proSection);
  import("./features.js").then((m) => {
    if (u.isPro) {
      m.renderOrbitScoreBadge(proSection, uid);
      m.renderTechStack(proSection, u, isMe);
      m.renderSkillBadges(proSection, uid, isMe);
    } else if (isMe) {
      m.renderGoProBanner(proSection);
    }
    // Academy badges — visible to all users who earned them
    m.renderLearnBadges(proSection, uid);
  }).catch(() => {});

  // Tabs: Posts | Media | About | Mutuals
  const tabs = el("div", { class: "profile-tabs" },
    el("button", { class: "profile-tab active", "data-ptab": "posts" }, "Posts"),
    el("button", { class: "profile-tab", "data-ptab": "media" }, "Media"),
    el("button", { class: "profile-tab", "data-ptab": "about" }, "About"),
    el("button", { class: "profile-tab", "data-ptab": "mutuals" },
      el("i", { class: "ri-team-line" }), " Mutuals"),
  );
  profileShell.appendChild(tabs);
  const body = el("div", {});
  profileShell.appendChild(body);

  if (!canViewPrivateProfile) {
    body.appendChild(el("div", { class: "private-profile-notice" },
      el("i", { class: "ri-lock-2-line" }),
      el("strong", {}, "This account is private"),
      el("span", {}, "Follow this account to see their posts and media."),
    ));
    return;
  }

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
      // Live listener — any post created or deleted by this user reflects
      // on their profile immediately.  We use docChanges() so that a simple
      // orbit/like write (type:"modified") does NOT wipe and re-render the
      // feed — which would interrupt any playing video back to the start.
      // The orbitBtn already updates its icon/count optimistically, so we
      // can safely skip re-rendering on "modified".
      let _profFeed = null;
      const _postEls = new Map(); // postId → article element

      _profileTabUnsub = onSnapshot(
        query(collection(db, "posts"), where("authorUid", "==", uid), limit(60)),
        (snap) => {
          const changes = snap.docChanges();

          // ── First paint: all changes arrive as "added" ──────────────────
          if (!_profFeed) {
            body.innerHTML = "";
            if (snap.empty) {
              body.appendChild(el("div", { class: "empty" }, el("i", { class: "ri-image-line" }), el("div", { class: "t" }, "No posts yet")));
              return;
            }
            const posts = snap.docs
              .map((d) => ({ id: d.id, ...d.data() }))
              .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
            postsCountEl.textContent = String(posts.length);
            compactPostsCountEl.textContent = `${posts.length} posts`;
            compactBar.querySelector(".profile-compact-count").textContent = `${posts.length} posts`;
            _profFeed = el("div", { class: "profile-feed-list" }); body.appendChild(_profFeed);
            posts.forEach((p) => {
              const card = renderPost(p, u, { hideComments: true });
              _postEls.set(p.id, card);
              _profFeed.appendChild(card);
            });
            _setupFeedVideoScroll(_profFeed);
            return;
          }

          // ── Incremental updates ──────────────────────────────────────────
          for (const change of changes) {
            if (change.type === "removed") {
              const card = _postEls.get(change.doc.id);
              if (card) { card.remove(); _postEls.delete(change.doc.id); }
              if (_postEls.size === 0) {
                _profFeed.remove(); _profFeed = null;
                body.appendChild(el("div", { class: "empty" }, el("i", { class: "ri-image-line" }), el("div", { class: "t" }, "No posts yet")));
              }
            } else if (change.type === "added") {
              const p = { id: change.doc.id, ...change.doc.data() };
              postsCountEl.textContent = String((parseInt(postsCountEl.textContent) || 0) + 1);
              compactPostsCountEl.textContent = `${postsCountEl.textContent} posts`;
              compactBar.querySelector(".profile-compact-count").textContent = `${postsCountEl.textContent} posts`;
              const card = renderPost(p, u, { hideComments: true });
              _postEls.set(p.id, card);
              _profFeed.prepend(card);
            }
            // "modified" (e.g. orbit/like write) — intentionally ignored:
            // the orbitBtn already updated its own UI optimistically.
          }
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
      body.appendChild(el("div", { class: "settings" },
        el("div", { class: "group" },
          el("h3", {}, "About"),
          el("div", { class: "row" }, el("div", { class: "label" }, el("div", { class: "t" }, "Joined"), el("div", { class: "d" }, fmtTime(u.createdAt) || "—"))),
          u.location ? el("div", { class: "row" }, el("div", { class: "label" }, el("div", { class: "t" }, "Verified location"), el("div", { class: "d" }, u.location.city || `${u.location.lat?.toFixed(2)}, ${u.location.lng?.toFixed(2)}`))) : null,
          u.showOnline !== false
            ? el("div", { class: "row" }, el("div", { class: "label" }, el("div", { class: "t" }, "Status"), el("div", { class: "d" }, u.online ? "Online now" : `Last seen ${fmtTime(u.lastSeen)}`)))
            : el("div", { class: "row" }, el("div", { class: "label" }, el("div", { class: "t" }, "Status"), el("div", { class: "d" }, "Online status hidden")),
        ),
    )  ));
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
  const birthdayInput = document.getElementById("editBirthday");
  if (birthdayInput) {
    const birthday = String(state.me.birthday || "");
    const monthDay = /^\d{2}-\d{2}$/.test(birthday) ? birthday : /^\d{4}-\d{2}-\d{2}$/.test(birthday) ? birthday.slice(5) : "";
    birthdayInput.value = monthDay ? `2000-${monthDay}` : "";
  }
  const birthdayAnnounce = document.getElementById("editBirthdayAnnounce");
  if (birthdayAnnounce) birthdayAnnounce.checked = state.me.birthdayAnnounceEnabled === true;
  const av = document.getElementById("editAvatar");   if (av) av.src = state.me.photoURL || avatarFor(state.me);
  const cover = document.getElementById("editCover"); if (cover) {
    cover.src = profileCoverFor(state.me) || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='640' height='180' viewBox='0 0 640 180'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' x2='1'%3E%3Cstop stop-color='%237c5cff'/%3E%3Cstop offset='1' stop-color='%23ff5cae'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='640' height='180' fill='url(%23g)'/%3E%3C/svg%3E";
  }
  modal.classList.remove("hidden");
  modal.style.display = "flex";
};

const renderProfileByUsername = async (root, username) => {
  if (!username) { location.hash = "#feed"; return; }
  const routeRenderToken = root._routeRenderToken;
  const qs = await getDocs(query(collection(db, "users"), where("username", "==", username.toLowerCase()), limit(1)));
  if (routeRenderToken !== root._routeRenderToken) return;
  if (qs.empty) {
    root.appendChild(el("div", { class: "empty" }, el("i", { class: "ri-user-unfollow-line" }), el("div", { class: "t" }, `@${username} not found`)));
    return;
  }
  const u = { uid: qs.docs[0].id, ...qs.docs[0].data() };
  renderProfile(root, u.uid);
};

const friendLastActive = (profile) => {
  if (profile?.showOnline === false) return "Hidden by privacy settings";
  if (profile?.online) return "Online now";
  const raw = profile?.lastSeen;
  const stamp = raw?.toMillis?.() || raw?.seconds * 1000 || (raw instanceof Date ? raw.getTime() : Date.parse(raw));
  if (!Number.isFinite(stamp) || stamp <= 0) return "Activity unavailable";
  const elapsed = Math.max(0, Date.now() - stamp);
  if (elapsed < 60_000) return "Active just now";
  if (elapsed < 3_600_000) return `Active ${Math.floor(elapsed / 60_000)} min ago`;
  if (elapsed < 86_400_000) return `Active ${Math.floor(elapsed / 3_600_000)} hr ago`;
  return `Last active ${new Date(stamp).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}`;
};

const friendLocationLabel = (profile, canSeeLocation) => {
  if (!canSeeLocation) return "Visible to friends";
  if (profile?.showLocation === false || !profile?.verified || !profile?.location) return "Not shared";
  return profile.location.city || "Verified area";
};

const approximateFriendDistance = (first, second) => {
  const a = first?.location;
  const b = second?.location;
  if (!first?.verified || !second?.verified || !a || !b ||
      !Number.isFinite(Number(a.lat)) || !Number.isFinite(Number(a.lng)) ||
      !Number.isFinite(Number(b.lat)) || !Number.isFinite(Number(b.lng))) return null;
  const toRad = (value) => Number(value) * Math.PI / 180;
  const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
  const dLat = lat2 - lat1, dLng = toRad(b.lng) - toRad(a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round(6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
};

const renderFriends = async (root, peerUid = null) => {
  const routeRenderToken = root._routeRenderToken;
  const page = el("div", { class: "friends-page" });
  root.appendChild(page);
  const isDetail = Boolean(peerUid && peerUid !== state.uid);
  page.appendChild(el("header", { class: "friends-page-head" },
    isDetail
      ? el("button", {
          class: "icon-btn friends-page-back",
          title: "Back to friends",
          onclick: () => { location.hash = "#friends"; },
        }, el("i", { class: "ri-arrow-left-line" }))
      : el("span", { class: "friends-page-mark" }, el("i", { class: "ri-group-line" })),
    el("div", {},
      el("h1", {}, isDetail ? "Friend info" : "Friends"),
      el("p", {}, isDetail ? "Your Orbit connection" : "People in your Orbit"),
    ),
  ));

  if (!isDetail) {
    const friendIds = [...new Set((state.me?.friends || []).filter((id) => id && id !== state.uid))];
    let friends = [];
    try {
      friends = (await Promise.all(friendIds.map((id) => fetchUser(id)))).filter(Boolean);
    } catch {
      if (routeRenderToken === root._routeRenderToken) {
        page.appendChild(el("div", { class: "friends-empty" },
          el("i", { class: "ri-wifi-off-line" }),
          el("h2", {}, "Couldn’t load friends"),
          el("p", {}, "Check your connection and try again."),
        ));
      }
      return;
    }
    if (routeRenderToken !== root._routeRenderToken || !page.isConnected) return;
    if (!friends.length) {
      page.appendChild(el("div", { class: "friends-empty" },
        el("i", { class: "ri-user-heart-line" }),
        el("h2", {}, "Your Orbit starts with a friend"),
        el("p", {}, "Open someone’s profile and choose Add friend to meet them here."),
        el("button", { class: "btn primary", onclick: () => { location.hash = "#explore"; } },
          el("i", { class: "ri-compass-3-line" }), " Explore people"),
      ));
      return;
    }

    const list = el("div", { class: "friends-list" });
    page.appendChild(list);
    friends.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    friends.forEach((friend) => {
      const infoButton = el("button", {
        class: "btn ghost",
        title: `Info about ${friend.name || "friend"}`,
        onclick: () => { location.hash = `#friends/${friend.uid}`; },
      }, el("i", { class: "ri-information-line" }), " Info");
      const messageButton = friend.allowMessages !== false
        ? el("button", {
            class: "btn primary",
            title: `Message ${friend.name || "friend"}`,
            onclick: () => { location.hash = `#chats/${friend.uid}`; },
          }, el("i", { class: "ri-chat-3-line" }))
        : null;
      list.appendChild(el("article", { class: "friend-list-card" },
        el("img", { class: "avatar md", src: avatarFor(friend), alt: `${friend.name || "Friend"} profile photo` }),
        el("div", { class: "friend-list-meta" },
          el("strong", {}, friend.name || "Orbit friend"),
          el("span", {}, `@${friend.username || "member"} · ${friendLastActive(friend)}`),
        ),
        el("div", { class: "friend-list-actions" }, infoButton, messageButton),
      ));
    });
    return;
  }

  let peer;
  try {
    peer = await fetchUser(peerUid);
  } catch {
    peer = null;
  }
  if (routeRenderToken !== root._routeRenderToken || !page.isConnected) return;
  if (!peer) {
    page.appendChild(el("div", { class: "friends-empty" },
      el("i", { class: "ri-user-unfollow-line" }),
      el("h2", {}, "This profile isn’t available"),
      el("p", {}, "The account may have been removed or is temporarily unavailable."),
      el("button", { class: "btn ghost", onclick: () => { location.hash = "#friends"; } }, "Back to friends"),
    ));
    return;
  }

  const me = state.me || await fetchUser(state.uid);
  if (routeRenderToken !== root._routeRenderToken || !page.isConnected) return;
  const isFriend = (me?.friends || []).includes(peerUid);
  const canSeePeerDetails = !peer.privateAccount || isFriend || (me?.following || []).includes(peerUid);
  const leftCharacter = el("div", { class: "friend-character-model friend-character-left" });
  const rightCharacter = el("div", { class: "friend-character-model friend-character-right" });
  const scene = el("section", {
    class: "friend-meet-scene",
    "aria-label": `A green Orbit scene with ${me?.name || "you"} and ${peer.name || "your friend"}`,
  },
    el("div", { class: "friend-scene-sun", "aria-hidden": "true" }),
    el("div", { class: "friend-scene-cloud cloud-a", "aria-hidden": "true" }),
    el("div", { class: "friend-scene-cloud cloud-b", "aria-hidden": "true" }),
    el("div", { class: "friend-scene-tree tree-a", "aria-hidden": "true" }),
    el("div", { class: "friend-scene-tree tree-b", "aria-hidden": "true" }),
    el("div", { class: "friend-scene-road", "aria-hidden": "true" }),
    el("div", { class: "friend-meet-badge" }, isFriend ? "Orbit friends" : "Friend preview"),
    el("div", { class: "friend-character-slot left" },
      leftCharacter,
      el("div", { class: "friend-character-label" }, me?.name || "You"),
    ),
    el("div", { class: "friend-character-slot right" },
      rightCharacter,
      el("div", { class: "friend-character-label" }, peer.name || "Orbit friend"),
    ),
  );
  page.appendChild(scene);

  const actions = el("div", { class: "friend-detail-actions" });
  if (isFriend) {
    actions.appendChild(el("button", {
      class: "btn ghost",
      onclick: async () => {
        if (!confirm(`Remove ${peer.name || "this friend"} from your friends?`)) return;
        if (await removeOrbitFriend(peerUid)) location.hash = "#friends";
      },
    }, el("i", { class: "ri-user-unfollow-line" }), " Remove friend"));
  } else {
    actions.appendChild(el("button", {
      class: "btn primary",
      onclick: async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        button.textContent = "Adding…";
        if (await addOrbitFriend(peerUid)) router();
        else { button.disabled = false; button.textContent = "Add friend"; }
      },
    }, el("i", { class: "ri-user-add-line" }), " Add friend"));
  }
  actions.appendChild(el("button", {
    class: "btn ghost",
    onclick: () => { location.hash = `#profile/${peerUid}`; },
  }, el("i", { class: "ri-user-line" }), " View profile"));
  if (peer.allowMessages !== false) {
    actions.appendChild(el("button", {
      class: "btn primary",
      onclick: () => { location.hash = `#chats/${peerUid}`; },
    }, el("i", { class: "ri-chat-3-line" }), " Message"));
  }
  page.appendChild(actions);

  const infoRow = (label, value) => el("div", { class: "friend-info-row" },
    el("span", {}, label),
    el("span", {}, value || "—"),
  );
  const aboutCard = el("article", { class: "friend-info-card" },
    el("h3", {}, el("i", { class: "ri-user-line" }), " About"),
    el("div", { class: "friend-info-bio" }, canSeePeerDetails
      ? (peer.bio || "No bio added yet.")
      : "Private profile. Add each other as friends to see more details."),
    infoRow("Username", peer.username ? `@${peer.username}` : "—"),
    canSeePeerDetails && peer.birthday ? infoRow("Birthday", formatProfileBirthday(peer.birthday) || "—") : null,
    infoRow("Member since", peer.createdAt?.toDate
      ? peer.createdAt.toDate().toLocaleDateString([], { month: "long", year: "numeric" })
      : "—"),
  );
  const activityCard = el("article", { class: "friend-info-card" },
    el("h3", {}, el("i", { class: "ri-pulse-line" }), " Activity"),
    infoRow("Last active", canSeePeerDetails ? friendLastActive(peer) : "Available to friends"),
    infoRow("Connection", isFriend ? "Friends on Orbit" : "Not friends yet"),
    canSeePeerDetails && peer.verified ? infoRow("Verification", "Location verified") : null,
  );

  const canSeeLocations = isFriend;
  const locationPair = el("div", { class: "friend-location-pair" },
    el("div", { class: "friend-location-person" },
      el("img", { class: "avatar", src: avatarFor(me), alt: "" }),
      el("div", {}, el("strong", {}, me?.name || "You"), el("span", {}, friendLocationLabel(me, true))),
    ),
    el("div", { class: "friend-location-person" },
      el("img", { class: "avatar", src: avatarFor(peer), alt: "" }),
      el("div", {}, el("strong", {}, peer.name || "Friend"), el("span", {}, friendLocationLabel(peer, canSeeLocations))),
    ),
  );
  const distance = canSeeLocations ? approximateFriendDistance(me, peer) : null;
  const locationCard = el("article", { class: "friend-info-card" },
    el("h3", {}, el("i", { class: "ri-map-pin-line" }), " Location"),
    locationPair,
    distance == null ? null : el("div", { class: "friend-distance" }, `About ${distance} km apart · approximate`),
  );
  page.appendChild(el("section", { class: "friend-info-grid" }, aboutCard, activityCard, locationCard));

  const characterCleanup = [];
  root._friendsCleanup = () => characterCleanup.forEach((cleanup) => cleanup());
import("./character.js?v=orbit-avatar-1").then(({ mountProfileCharacter }) => {
  if (routeRenderToken !== root._routeRenderToken || !page.isConnected) return;
  characterCleanup.push(
    mountProfileCharacter(leftCharacter, {
      photoURL: avatarFor(me),
      alt: `${me?.name || "You"} character`,
      scrollRoot: root,
      rotationY: Math.PI / 2,
      waveOnInitialView: true,
      modelURL: me?.avatarModelUrl || null,
      animationMap: me?.avatarAnimationMap || null,
    }),
    mountProfileCharacter(rightCharacter, {
      photoURL: avatarFor(peer),
      alt: `${peer.name || "Friend"} character`,
      scrollRoot: root,
      rotationY: -Math.PI / 2,
      waveOnInitialView: true,
      modelURL: peer?.avatarModelUrl || null,
      animationMap: peer?.avatarAnimationMap || null,
    }),
  );
}).catch((error) => console.warn("Orbit friend characters failed to load.", error));
};

// =========================================================================
// 13. SETTINGS — theme, verification, notifications
// =========================================================================
const renderSettings = async (root) => {
  const routeRenderToken = root._routeRenderToken;
  root.innerHTML = "";
  const settingSwitch = (key, title, description, onChange = null) => {
    const defaultValue = !["privateAccount", "hideSensitive"].includes(key);
    const current = state.me?.[key] ?? defaultValue;
    const sw = el("button", {
      class: `switch${current ? " on" : ""}`,
      type: "button",
      role: "switch",
      "aria-checked": String(current),
      "aria-label": title,
    });
    sw.addEventListener("click", async () => {
      const next = !sw.classList.contains("on");
      sw.classList.toggle("on", next);
      sw.setAttribute("aria-checked", String(next));
      if (state.me) state.me[key] = next;
      await updateDoc(doc(db, "users", state.uid), { [key]: next }).catch(() => {
        sw.classList.toggle("on", !next);
        sw.setAttribute("aria-checked", String(!next));
        if (state.me) state.me[key] = !next;
        toast("Could not save setting");
      });
      if (onChange) onChange(next);
    });
    return el("div", { class: "row setting-row" },
      el("div", { class: "label" }, el("div", { class: "t" }, title), el("div", { class: "d" }, description)),
      sw,
    );



};
const wrap = el("div", { class: "settings" },
    el("h2", { style: "margin-top:0;font-family:var(--font-display);" }, "Settings"),
    el("div", { class: "group" },
      el("h3", {}, "Appearance"),
      el("div", { class: "row" },
        el("div", { class: "label" },
          el("div", { class: "t" }, "Theme"),
          el("div", { class: "d" }, "Choose your visual style — saved across devices."),
        ),
        (() => {
          const _themes = [
            { id: "dark",  label: "Dark",  icon: "ri-moon-line" },
            { id: "light", label: "Light", icon: "ri-sun-line" },
            { id: "glass", label: "Glass", icon: "ri-contrast-2-line" },
          ];
          const _cur = document.documentElement.getAttribute("data-theme") || "dark";
          const picker = el("div", { class: "theme-picker" });
          _themes.forEach(({ id, label, icon }) => {
            const btn = el("button", { class: `theme-opt${_cur === id ? " active" : ""}` },
              el("i", { class: icon }), label);
            btn.addEventListener("click", () => {
              applyTheme(id);
              picker.querySelectorAll(".theme-opt").forEach((b) => b.classList.remove("active"));
              btn.classList.add("active");
              updateDoc(doc(db, "users", state.uid), { themePref: id }).catch(() => {});
            });
            picker.appendChild(btn);
          });
          return picker;
        })(),
      ),
      el("div", { class: "row" },
        el("div", { class: "label" },
          el("div", { class: "t" }, "Language"),
          el("div", { class: "d" }, "Choose your preferred display language."),
        ),
        (() => {
          const LANGUAGES = [
            { code: "en",    label: "English" },
            { code: "es",    label: "Español" },
            { code: "fr",    label: "Français" },
            { code: "de",    label: "Deutsch" },
            { code: "pt",    label: "Português" },
            { code: "it",    label: "Italiano" },
            { code: "nl",    label: "Nederlands" },
            { code: "ru",    label: "Русский" },
            { code: "pl",    label: "Polski" },
            { code: "uk",    label: "Українська" },
            { code: "sv",    label: "Svenska" },
            { code: "no",    label: "Norsk" },
            { code: "da",    label: "Dansk" },
            { code: "fi",    label: "Suomi" },
            { code: "ro",    label: "Română" },
            { code: "cs",    label: "Čeština" },
            { code: "hu",    label: "Magyar" },
            { code: "sk",    label: "Slovenčina" },
            { code: "bg",    label: "Български" },
            { code: "hr",    label: "Hrvatski" },
            { code: "sr",    label: "Српски" },
            { code: "el",    label: "Ελληνικά" },
            { code: "tr",    label: "Türkçe" },
            { code: "ar",    label: "العربية" },
            { code: "he",    label: "עברית" },
            { code: "hi",    label: "हिन्दी" },
            { code: "bn",    label: "বাংলা" },
            { code: "ja",    label: "日本語" },
            { code: "ko",    label: "한국어" },
            { code: "zh-CN", label: "中文 (简体)" },
            { code: "zh-TW", label: "中文 (繁體)" },
            { code: "vi",    label: "Tiếng Việt" },
            { code: "th",    label: "ภาษาไทย" },
            { code: "id",    label: "Bahasa Indonesia" },
            { code: "ms",    label: "Bahasa Melayu" },
          ];
          const saved = state.me?.langPref || localStorage.getItem("orbit_lang") || "en";
          const sel = el("select", { class: "settings-lang-select" });
          LANGUAGES.forEach(({ code, label }) => {
            const opt = el("option", { value: code }, label);
            if (code === saved) opt.selected = true;
            sel.appendChild(opt);
          });
          sel.onchange = async () => {
            const code = sel.value;
            localStorage.setItem("orbit_lang", code);
            if (state.me) state.me.langPref = code;
            await updateDoc(doc(db, "users", state.uid), { langPref: code }).catch(() => {});
            toast("Language updated — reloading…");
            setTimeout(() => orbitTranslate(code), 600);
          };
          return sel;
        })(),
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
      el("div", { class: "row" },
        el("div", { class: "label" },
          el("div", { class: "t" }, "Test group notification"),
          el("div", { class: "d" }, "Send yourself a test push notification for a group message.")),
        el("button", { class: "btn ghost", onclick: () => {
          import("./notifications.js").then((m) => m.sendTestGroupNotification());
        }}, "Send test"),
      ),
      settingSwitch("emailNotifications", "Email notifications", "Receive account and social activity updates by email."),
      settingSwitch("showOnline", "Show when you’re online", "Let people see your online status and last active time."),
    ),

    el("div", { class: "group" },
      el("h3", {}, "Privacy & safety"),
      settingSwitch("privateAccount", "Private account", "Only people you approve can follow you and view your posts."),
      settingSwitch("allowMessages", "Allow direct messages", "Let other Orbit members start a chat with you."),
      settingSwitch("hideSensitive", "Hide sensitive content", "Hide posts that have been marked as sensitive."),
    ),

    el("div", { class: "group" },
      el("h3", {}, "Content preferences"),
      settingSwitch("autoplayVideos", "Autoplay videos", "Play feed videos automatically when they come into view."),
      el("div", { class: "row" },
        el("div", { class: "label" },
          el("div", { class: "t" }, "Saved posts"),
          el("div", { class: "d" }, `${(state.me?.saved || []).length} posts saved for later.`),
        ),
        el("button", { class: "btn ghost", onclick: () => { location.hash = "#saved"; } }, "View saved"),
      ),
    ),

    el("div", { class: "group" },
      el("h3", {}, "Account"),
      el("div", { class: "row" }, el("div", { class: "label" }, el("div", { class: "t" }, "Email"), el("div", { class: "d" }, state.me.email || "—"))),
      el("div", { class: "row" }, el("div", { class: "label" }, el("div", { class: "t" }, "Username"), el("div", { class: "d" }, "@" + state.me.username))),
      el("div", { class: "row" },
        el("div", { class: "label" },
          el("div", { class: "t" }, "Change password"),
          el("div", { class: "d" }, "Send a secure password reset link to your email."),
        ),
        el("button", { class: "btn ghost", onclick: async () => {
          if (!state.me.email) { toast("No email address is attached to this account"); return; }
          await sendPasswordResetEmail(auth, state.me.email).then(
            () => toast("Password reset link sent"),
            () => toast("Could not send password reset link"),
          );
        }}, "Reset password"),
      ),
      el("div", { class: "row" },
        el("div", { class: "label" },
          el("div", { class: "t" }, "Download your data"),
          el("div", { class: "d" }, "Save a copy of your Orbit profile and preferences."),
        ),
        el("button", { class: "btn ghost", onclick: () => {
          const blob = new Blob([JSON.stringify(state.me || {}, null, 2)], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url; a.download = "orbit-account-data.json"; a.click();
          URL.revokeObjectURL(url);
        }}, "Download"),
      ),
      el("div", { class: "row" },
        el("div", { class: "label" }, el("div", { class: "t" }, "Sign out"), el("div", { class: "d" }, "End your session on this device.")),
        el("button", { class: "btn ghost", onclick: () => $("#signOutBtn").click() }, "Sign out"),
      ),
      el("div", { class: "row danger-setting-row" },
        el("div", { class: "label" },
          el("div", { class: "t" }, "Deactivate account"),
          el("div", { class: "d" }, "Hide your profile until you sign in again."),
        ),
        el("button", { class: "btn ghost danger-btn", onclick: async () => {
          if (!confirm("Deactivate your Orbit profile? You can restore it by signing in again.")) return;
          await updateDoc(doc(db, "users", state.uid), { deactivated: true, online: false, lastSeen: serverTimestamp() });
          await signOut(auth);
        }}, "Deactivate"),
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
// ── Custom avatar section ──────────────────────────────────────────
const avatarSettingsCard = await mountAvatarSettingsCard();
if (routeRenderToken !== root._routeRenderToken) return;
wrap.appendChild(avatarSettingsCard);
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
$("#topbarComposeBtn")?.addEventListener("click", () => openCreatePost());
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
    const invitedMemberIds = await resolveGroupMemberIds(fd.get("memberUsernames") || "");
    const memberIds = [...new Set([state.uid, ...invitedMemberIds])];
    if (memberIds.length > MAX_GROUP_MEMBERS) {
      toast(`A group can have at most ${MAX_GROUP_MEMBERS} members, including you.`);
      return;
    }
    const iconFile = fd.get("iconFile");
    let iconUrl = "";
    if (iconFile instanceof File && iconFile.size > 0) {
      btn.textContent = "Uploading picture…";
      iconUrl = (await uploadToCloudinary(iconFile, "image")).url;
    }
    const ref = await addDoc(collection(db, "groups"), {
      name,
      about: fd.get("about") || "",
      groupLink: (fd.get("groupLink") || "").trim(),
      iconUrl,
      isPublic: fd.get("isPublic") === "on",
      ownerUid: state.uid,
      admins: [state.uid],
      members: memberIds,
      memberCount: memberIds.length,
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
const CR_TEXT_COLORS = ["#ffffff","#000000","#ff5c7a","#ffb04a","#3fdca0","#5cd3ff","#8b6cff","#ff5cae"];

let crState = null;
const _crFreshState = () => ({
  step: "pick",           // pick | cam | editor | music | details
  slides: [],             // [{ type:'image'|'video', file, url, overlays:[], recordedInApp? }]
  textOnly: false,        // true when publishing a text-only post (no media)
  isSponsored: false,
  adHeadline: "",
  adLink: "",
  adCta: "Learn more",
  song: null,             // { id, name, artist, url, duration }
  caption: "",
  location: null,
  activeSlide: 0,
  selectedLayerId: null,
  camStream: null,
  camRecorder: null,
  camChunks: [],
  camTimer: null,
});

// Music can only be attached to a single video that was recorded in-app —
// never to images, carousels, or videos picked from the device library.
// Keeps licensing/rights simple and matches how the feature was designed.
const crCanAddMusic = () =>
  crState.slides.length === 1 && crState.slides[0].type === "video" && crState.slides[0].recordedInApp === true;

const crLayerId = () => "l" + Math.random().toString(36).slice(2, 9);

function openCreatePost() {
  if (crState) return; // already open
  crState = _crFreshState();
  const root = el("div", { class: "cr-root", id: "crRoot" });
  document.body.appendChild(root);
  crRenderShell(root);
  crGoto("pick");
}

function crClose() {
  if (!crState) return;
  crStopCamera();
  crState.slides.forEach((s) => { try { URL.revokeObjectURL(s.url); } catch {} });
  crState = null;
  $("#crRoot")?.remove();
}

let _crShellRefs = null;
function crRenderShell(root) {
  const closeBtn = el("button", { class: "cr-head-close", onclick: () => crClose() }, el("i", { class: "ri-close-line" }));
  const backBtn = el("button", { class: "cr-head-close", style: "display:none;", onclick: () => crBack() }, el("i", { class: "ri-arrow-left-line" }));
  const title = el("div", { class: "cr-head-title", text: "New post" });
  const nextBtn = el("button", { class: "cr-head-btn primary", type: "button", style: "display:none;" }, "Next");
  const head = el("div", { class: "cr-head" }, el("div", { style: "display:flex;align-items:center;gap:8px;" }, backBtn, closeBtn), title, nextBtn);
  const stepsWrap = el("div", { class: "cr-steps" });
  root.appendChild(head);
  root.appendChild(stepsWrap);
  _crShellRefs = { head, backBtn, closeBtn, title, nextBtn, stepsWrap };
}

function crBack() {
  if (crState.step === "cam") { crStopCamera(); crGoto("pick"); return; }
  const order = crState.textOnly
    ? ["pick", "details"]
    : (crCanAddMusic() ? ["pick", "editor", "music", "details"] : ["pick", "editor", "details"]);
  const idx = order.indexOf(crState.step);
  if (idx <= 0) { crClose(); return; }
  crGoto(order[idx - 1]);
}

function crGoto(step) {
  if (step === "music" && !crCanAddMusic()) step = "details"; // music is video-only + recorded-in-app only
  crState.step = step;
  const { stepsWrap, backBtn, nextBtn, title } = _crShellRefs;
  stepsWrap.innerHTML = "";
  backBtn.style.display = step === "pick" ? "none" : "";
  nextBtn.style.display = "none";
   if (step === "pick") { title.textContent = crState.isSponsored ? "New sponsored ad" : "New post"; stepsWrap.appendChild(crBuildPickStep()); }
  else if (step === "cam") { title.textContent = "Record video"; stepsWrap.appendChild(crBuildCamStep()); }
  else if (step === "editor") {
    title.textContent = "Edit";
    stepsWrap.appendChild(crBuildEditorStep());
    nextBtn.style.display = ""; nextBtn.textContent = "Next"; nextBtn.onclick = () => crGoto(crCanAddMusic() ? "music" : "details");
  } else if (step === "music") {
    title.textContent = "Add music";
    stepsWrap.appendChild(crBuildMusicStep());
    nextBtn.style.display = ""; nextBtn.textContent = "Next"; nextBtn.onclick = () => crGoto("details");
  } else if (step === "details") {
     title.textContent = crState.isSponsored ? "Create ad" : "Share";
    stepsWrap.appendChild(crBuildDetailsStep());
     nextBtn.style.display = ""; nextBtn.textContent = crState.isSponsored ? "Create ad" : "Post"; nextBtn.onclick = () => crSubmitPost(nextBtn);
  }
}

// ---------------- Step 1: pick media ----------------
function crBuildPickStep() {
  crState.textOnly = false;
  const fileInput = el("input", { type: "file", accept: "image/*,video/*", multiple: true, hidden: true });
  const sponsoredInput = el("input", { type: "checkbox" });
  sponsoredInput.checked = crState.isSponsored === true;
  sponsoredInput.addEventListener("change", () => {
    crState.isSponsored = sponsoredInput.checked;
    if (_crShellRefs?.title) _crShellRefs.title.textContent = crState.isSponsored ? "New sponsored ad" : "New post";
  });
  const sponsoredToggle = el("label", { class: "cr-ad-mode-toggle" },
    sponsoredInput,
    el("span", {},
      el("strong", {}, "Create this as an ad"),
      el("small", {}, "Adds a Sponsored label and a destination link. No ad budget or paid placement is set up."),
    ),
  );
  fileInput.addEventListener("change", (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const hasVideo = files.some((f) => f.type.startsWith("video/"));
    if (hasVideo) {
      const f = files.find((f) => f.type.startsWith("video/"));
      // recordedInApp:false — uploaded videos can't have music attached, only ones recorded with the in-app camera.
      crState.slides = [{ type: "video", file: f, url: URL.createObjectURL(f), overlays: [], recordedInApp: false }];
    } else {
      crState.slides = files.slice(0, 10).map((f) => ({ type: "image", file: f, url: URL.createObjectURL(f), overlays: [] }));
    }
    crState.activeSlide = 0;
    crGoto("editor");
  });
  const step = el("div", { class: "cr-step active" },
    el("div", { class: "cr-pick" },
      el("div", { class: "cr-pick-title" }, "Create a post"),
      el("div", { class: "cr-pick-sub" }, "Photos, a video, a carousel, or just words."),
      el("div", { class: "cr-pick-grid" },
        el("button", { class: "cr-pick-opt", onclick: () => fileInput.click() },
          el("i", { class: "ri-image-add-line" }), el("span", {}, "Photos / video")),
        el("button", { class: "cr-pick-opt", onclick: () => crGoto("cam") },
          el("i", { class: "ri-camera-line" }), el("span", {}, "Record video")),
        el("button", { class: "cr-pick-opt", onclick: () => { crState.textOnly = true; crState.slides = []; crGoto("details"); } },
          el("i", { class: "ri-text" }), el("span", {}, "Text post")),
      ),
      sponsoredToggle,
      el("div", { class: "cr-pick-hint" }, "Pick multiple photos to make a swipeable carousel. Music can be added to videos you record in-app."),
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
}

function crBuildCamStep() {
  const video = el("video", { autoplay: true, muted: true, playsinline: true });
  const timer = el("div", { class: "cr-cam-timer" }, el("span", { class: "dot" }), el("span", { class: "t" }, "0:00"));
  const recBtn = el("button", { class: "cr-rec-btn" });
  const cam = el("div", { class: "cr-cam" },
    video, timer,
    el("button", { class: "cr-cam-close", onclick: () => { crStopCamera(); crGoto("pick"); } }, el("i", { class: "ri-close-line" })),
    el("div", { class: "cr-cam-bar" }, recBtn),
  );
  const step = el("div", { class: "cr-step active" }, cam);

  navigator.mediaDevices?.getUserMedia({ video: { facingMode: "user" }, audio: true }).then((stream) => {
    crState.camStream = stream;
    video.srcObject = stream;
  }).catch(() => { toast("Camera access denied or unavailable"); crGoto("pick"); });

  let seconds = 0;
  recBtn.addEventListener("click", () => {
    if (!crState.camStream) return;
    if (!crState.camRecorder || crState.camRecorder.state === "inactive") {
      crState.camChunks = [];
      const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus") ? "video/webm;codecs=vp9,opus" : "video/webm";
      const rec = new MediaRecorder(crState.camStream, { mimeType: mime });
      rec.ondataavailable = (ev) => { if (ev.data.size) crState.camChunks.push(ev.data); };
      rec.onstop = () => {
        const blob = new Blob(crState.camChunks, { type: "video/webm" });
        const file = new File([blob], `orbit-recording-${Date.now()}.webm`, { type: "video/webm" });
        crState.slides = [{ type: "video", file, url: URL.createObjectURL(file), overlays: [], recordedInApp: true }];
        crState.activeSlide = 0;
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
  const overlayLayer = el("div", { class: "cr-overlay-layer", style: "touch-action:none;" });
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
        style: `left:${ov.x}%;top:${ov.y}%;transform:translate(-50%,-50%) rotate(${ov.rotation}deg);touch-action:none;` +
          (ov.type === "text" ? `color:${ov.color};` : ""),
      },
        ov.type === "text" ? el("span", { text: ov.text, contenteditable: false }) : ov.icon,
        el("button", { class: "cr-layer-del", onclick: (e) => { e.stopPropagation(); slide.overlays = slide.overlays.filter((o) => o.id !== ov.id); crState.selectedLayerId = null; paintStage(); } }, el("i", { class: "ri-close-line" })),
      );
      layer.style.fontSize = crFontPx(ov, rect().width || 320) + "px";

      // Tap-to-edit: a tap (pointerdown+up with negligible movement) on a
      // layer that was ALREADY selected enters edit mode immediately — this
      // is far more reliable on touch than waiting for a true dblclick,
      // which conflicts with the pointer-capture drag logic below. The
      // first tap on an unselected layer just selects it (shows handles);
      // the very next tap edits it. Desktop dblclick still works too.
      let dragging = false, moved = false, sx = 0, sy = 0, ox = 0, oy = 0, wasSelectedBeforeTap = false;
      layer.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        wasSelectedBeforeTap = crState.selectedLayerId === ov.id;
        crState.selectedLayerId = ov.id;
        paintLayerControls();
        $$(".cr-layer", overlayLayer).forEach((l) => l.classList.remove("selected"));
        layer.classList.add("selected");
        dragging = true; moved = false; sx = e.clientX; sy = e.clientY; ox = ov.x; oy = ov.y;
        layer.setPointerCapture(e.pointerId);
      }, { passive: false });
      layer.addEventListener("pointermove", (e) => {
        if (!dragging) return;
        e.preventDefault(); // must be non-passive or mobile browsers ignore this
        const dx = e.clientX - sx, dy = e.clientY - sy;
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
        const r = rect();
        ov.x = Math.min(96, Math.max(4, ox + (dx / r.width) * 100));
        ov.y = Math.min(96, Math.max(4, oy + (dy / r.height) * 100));
        layer.style.left = ov.x + "%"; layer.style.top = ov.y + "%";
      }, { passive: false });
      layer.addEventListener("pointerup", () => {
        dragging = false;
        if (!moved && ov.type === "text" && wasSelectedBeforeTap) {
          // Call directly (no rAF) — iOS Safari only allows focus() inside a
          // synchronous user-gesture handler; delaying via rAF exits that
          // stack and iOS silently ignores the focus() call.
          crEnterTextEdit(layer, ov);
        }
      });
      layer.addEventListener("pointercancel", () => { dragging = false; });
      if (ov.type === "text") {
        layer.addEventListener("dblclick", () => crEnterTextEdit(layer, ov));
      }
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

function crEnterTextEdit(layer, ov) {
  const span = layer.querySelector("span");
  span.contentEditable = "true";
  span.focus();
  const sel = getSelection(); sel.selectAllChildren(span);
  span.addEventListener("blur", () => { ov.text = span.textContent.trim() || "Tap to edit"; span.contentEditable = "false"; span.textContent = ov.text; }, { once: true });
}

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

// Internet Archive's public catalog needs no API key/signup at all — its
// search + metadata endpoints are open and CORS-enabled. We search the
// "audio" mediatype for Creative-Commons-friendly netlabel/free-music
// collections, then resolve a playable mp3 URL per result via /metadata.
const ARCHIVE_AUDIO_COLLECTIONS = "(collection:netlabels OR collection:opensource_audio OR collection:free_music_archive)";
async function crSearchMusic(qText, results) {
  results.innerHTML = `<div class="cr-music-empty"><i class="ri-loader-4-line"></i> Loading…</div>`;
  try {
    const q = qText
      ? `${ARCHIVE_AUDIO_COLLECTIONS} AND mediatype:audio AND (${qText})`
      : `${ARCHIVE_AUDIO_COLLECTIONS} AND mediatype:audio`;
    const searchUrl = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(q)}&fl[]=identifier&fl[]=title&fl[]=creator&rows=20&output=json`;
    const r = await fetch(searchUrl);
    const j = await r.json();
    const docs = j.response?.docs || [];
    results.innerHTML = "";
    if (!docs.length) { results.appendChild(el("div", { class: "cr-music-empty" }, "No tracks found — try a different search")); return; }
    docs.forEach((doc) => results.appendChild(crTrackRow(doc, results)));
  } catch {
    results.innerHTML = "";
    results.appendChild(el("div", { class: "cr-music-empty" }, "Couldn't load music right now"));
  }
}
// Each search result is an Archive.org "item" that can contain several
// files; resolve the first playable mp3/ogg file lazily (only once the
// user actually previews or picks the track, to avoid 20 metadata calls
// per search).
async function crResolveTrackUrl(identifier) {
  const r = await fetch(`https://archive.org/metadata/${identifier}`);
  const j = await r.json();
  const file = (j.files || []).find((f) => /\.(mp3|ogg)$/i.test(f.name) && f.source === "derivative")
    || (j.files || []).find((f) => /\.(mp3|ogg)$/i.test(f.name));
  if (!file) return null;
  return `https://archive.org/download/${identifier}/${encodeURIComponent(file.name)}`;
}
function crTrackRow(doc, results) {
  const isActive = crState.song?.id === doc.identifier;
  const title = doc.title || doc.identifier;
  const creator = Array.isArray(doc.creator) ? doc.creator[0] : (doc.creator || "Unknown artist");
  const playIcon = el("i", { class: "ri-play-fill" });
  const playBtn = el("button", { class: "cr-track-play" }, playIcon);
  const pickBtn = el("button", { class: "cr-track-pick" }, isActive ? "Selected" : "Use");
  const row = el("div", { class: "cr-track" + (isActive ? " active" : "") },
    el("div", { class: "cr-track-art" }, el("i", { class: "ri-music-2-fill" })),
    el("div", { class: "cr-track-info" }, el("div", { class: "n" }, title), el("div", { class: "a" }, creator)),
    playBtn,
    pickBtn,
  );
  playBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (_crPreviewAudio && _crPreviewAudio._identifier === doc.identifier && !_crPreviewAudio.paused) {
      crStopPreview(); playIcon.className = "ri-play-fill"; return;
    }
    crStopPreview();
    playIcon.className = "ri-loader-4-line";
    const url = await crResolveTrackUrl(doc.identifier).catch(() => null);
    if (!url) { playIcon.className = "ri-play-fill"; toast("Couldn't load that track"); return; }
    _crPreviewAudio = new Audio(url);
    _crPreviewAudio._identifier = doc.identifier;
    _crPreviewAudio.play().catch(() => {});
    playIcon.className = "ri-pause-fill";
    _crPreviewAudio.addEventListener("ended", () => { playIcon.className = "ri-play-fill"; });
  });
  pickBtn.addEventListener("click", async () => {
    pickBtn.textContent = "…";
    const url = _crPreviewAudio?._identifier === doc.identifier ? _crPreviewAudio.src : await crResolveTrackUrl(doc.identifier).catch(() => null);
    if (!url) { toast("Couldn't load that track"); pickBtn.textContent = "Use"; return; }
    crState.song = { id: doc.identifier, name: title, artist: creator, url };
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
  const caption = el("textarea", { placeholder: crState.textOnly ? "What's on your mind?" : "Write a caption… use #hashtags and @mentions" });
  caption.value = crState.caption;
  caption.addEventListener("input", () => { crState.caption = caption.value; });

  let sponsoredFields = null;
  if (crState.isSponsored) {
    const headline = el("input", { type: "text", maxlength: "80", placeholder: "Ad headline (optional)" });
    headline.value = crState.adHeadline || "";
    headline.addEventListener("input", () => { crState.adHeadline = headline.value; });
    const destination = el("input", { type: "url", placeholder: "https://your-site.com" });
    destination.value = crState.adLink || "";
    destination.addEventListener("input", () => { crState.adLink = destination.value; });
    const cta = el("select", {},
      el("option", { value: "Learn more" }, "Learn more"),
      el("option", { value: "Shop now" }, "Shop now"),
      el("option", { value: "Sign up" }, "Sign up"),
      el("option", { value: "Contact us" }, "Contact us"),
    );
    cta.value = crState.adCta || "Learn more";
    cta.addEventListener("change", () => { crState.adCta = cta.value; });
    sponsoredFields = el("div", { class: "cr-ad-fields" },
      el("div", { class: "cr-ad-fields-title" }, el("i", { class: "ri-advertisement-line" }), "Sponsored ad details"),
      el("label", {}, "Headline", headline),
      el("label", {}, "Destination link (required)", destination),
      el("label", {}, "Button text", cta),
    );
  }

  const locRow = el("div", { class: "cr-details-row" },
    el("div", { class: "l" }, el("i", { class: "ri-map-pin-line" }), "Tag location"),
    el("div", { class: "v" }, crState.location?.city || "Not tagged"),
  );
  locRow.addEventListener("click", () => {
    if (!("geolocation" in navigator)) { toast("Location not available"); return; }
    locRow.querySelector(".v").textContent = "Locating…";
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const { latitude: lat, longitude: lng } = pos.coords; let city = null;
      try {
        const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=10`);
        const j = await r.json();
        city = j.address?.city || j.address?.town || j.address?.state || (j.display_name || "").split(",")[0] || null;
      } catch {}
      crState.location = { lat: Math.round(lat * 100) / 100, lng: Math.round(lng * 100) / 100, city };
      locRow.querySelector(".v").textContent = city || "My location";
    }, () => { toast("Location access denied"); locRow.querySelector(".v").textContent = crState.location?.city || "Not tagged"; }, { timeout: 8000 });
  });

  const musicRow = crCanAddMusic() ? el("div", { class: "cr-details-row" },
    el("div", { class: "l" }, el("i", { class: "ri-music-2-line" }), "Music"),
    el("div", { class: "v" }, crState.song ? `${crState.song.name} — ${crState.song.artist}` : "None"),
  ) : null;
  musicRow?.addEventListener("click", () => crGoto("music"));

  return el("div", { class: "cr-step active" },
    el("div", { class: "cr-details" },
      crState.textOnly ? null : el("div", { class: "cr-details-preview" },
        thumbSlide.type === "video"
          ? el("video", { src: thumbSlide.url, class: "cr-details-thumb", muted: true })
          : el("img", { src: thumbSlide.url, class: "cr-details-thumb" }),
        el("div", { style: "flex:1;color:var(--text-mute);font-size:13px;" },
          crState.slides.length > 1 ? `${crState.slides.length} photos in this post` : (thumbSlide.type === "video" ? "1 video" : "1 photo")),
      ),
      caption,
      sponsoredFields,
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
  if (!crState.textOnly && !crState.slides.length) { toast("Pick a photo or video first"); return; }
  if (crState.textOnly && !crState.caption.trim()) { toast("Write something first"); return; }
  const isSponsored = crState.isSponsored === true;
  let adDestinationUrl = "";
  if (isSponsored) {
    if (!crState.adLink?.trim()) { toast("Add a destination link for your ad"); return; }
    if (!crState.caption.trim() && !crState.adHeadline?.trim()) { toast("Add ad text or a headline"); return; }
    try {
      const parsedUrl = new URL(crState.adLink.trim());
      if (!["http:", "https:"].includes(parsedUrl.protocol)) throw new Error("Unsupported link");
      adDestinationUrl = parsedUrl.href;
    } catch {
      toast("Enter a valid link starting with https://");
      return;
    }
  }
  btn.disabled = true; btn.textContent = isSponsored ? "Creating ad…" : "Posting…";
  try {
    let media;
    if (!crState.textOnly) {
      toast("Uploading…");
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
    }
    const text = crState.caption.trim();
    const hashtags = extractHashtags(text);
    const postData = {
      authorUid: state.uid, text, hashtags,
      orbits: [], orbitCount: 0, commentCount: 0, createdAt: serverTimestamp(),
    };
    if (media) postData.media = media;
    if (crState.location) postData.location = crState.location;
    if (crState.song) postData.song = crState.song;
    if (isSponsored) {
      postData.isSponsored = true;
      postData.ad = {
        headline: crState.adHeadline.trim(),
        destinationUrl: adDestinationUrl,
        cta: crState.adCta || "Learn more",
      };
    }
    const newPostRef = await addDoc(collection(db, "posts"), postData);
    sfxPost();
    toast(isSponsored ? "Ad created and marked Sponsored" : "Posted!");
    showPostSuccess();
    crClose();
    addDoc(collection(db, "notifications", state.uid, "items"), {
      type: "postConfirm", postId: newPostRef.id, text: "Your post is live!", read: false, createdAt: serverTimestamp(),
    }).catch(() => {});
    if (!isSponsored) (async () => {
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
    btn.disabled = false; btn.textContent = isSponsored ? "Create ad" : "Post";
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
      .filter(u => u.uid !== state.uid);
    for (let i = _all.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [_all[i], _all[j]] = [_all[j], _all[i]]; }
    let added = 0;
    _all.forEach((u) => {
      if (added >= 6) return;
      added++;
      scroller.appendChild(el("div", { class: "feed-sugg-person" },
        el("img", { class: "avatar md", src: avatarFor(u), onclick: () => location.hash = `#profile/${u.uid}` }),
        el("div", { class: "feed-sugg-name" }, u.name || "User"),
        el("div", { class: "feed-sugg-meta" }, "@" + (u.username || "")),
        orbitFriendControls(u, { compact: true, stacked: true })
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
          try {
            const members = await changeGroupMembers(g.id, member ? { remove: [state.uid] } : { add: [state.uid] });
            member = members.includes(state.uid);
          } catch (error) {
            toast(error?.message || "Could not update group membership");
            return;
          }
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

const showOnboardingGuide = () => {
  const overlay = el("div", { class: "onboarding-guide-overlay" });
  const card = el("div", { class: "onboarding-guide-card" });
  const progress = el("div", { class: "onboarding-guide-progress" });
  const body = el("div", { class: "onboarding-guide-body" });
  let step = 0;
  const steps = [
    { icon: "ri-user-smile-line", title: "Set up your profile", sub: "Make your Orbit feel like you." },
    { icon: "ri-user-heart-line", title: "Find your people", sub: "Follow a few people to personalize your feed." },
    { icon: "ri-group-2-line", title: "Join your communities", sub: "Pick groups that match your interests." },
  ];
  const finish = async () => {
    try {
      await updateDoc(doc(db, "users", state.uid), { onboardingCompleted: true });
      state.me.onboardingCompleted = true;
    } catch {}
    overlay.remove();
    showFirstPostPrompt();
  };
  const close = () => finish();
  const renderProgress = () => {
    progress.innerHTML = "";
    steps.forEach((s, i) => progress.appendChild(el("span", { class: i <= step ? "active" : "" })));
  };
  const renderStep = () => {
    renderProgress();
    body.innerHTML = "";
    const current = steps[step];
    body.appendChild(el("div", { class: "onboarding-guide-icon" }, el("i", { class: current.icon })));
    body.appendChild(el("div", { class: "onboarding-guide-kicker" }, `STEP ${step + 1} OF ${steps.length}`));
    body.appendChild(el("h2", {}, current.title));
    body.appendChild(el("p", { class: "onboarding-guide-sub" }, current.sub));

    if (step === 0) {
      const name = el("input", { type: "text", value: state.me?.name || "", placeholder: "Your name" });
      const username = el("input", { type: "text", value: state.me?.username || "", placeholder: "Username" });
      const bio = el("textarea", { placeholder: "A short bio (optional)", rows: "3" }, state.me?.bio || "");
      const save = el("button", { class: "btn primary block" }, "Save profile");
      save.onclick = async () => {
        if (!name.value.trim() || !username.value.trim()) { toast("Add your name and username"); return; }
        save.disabled = true; save.textContent = "Saving…";
        await updateDoc(doc(db, "users", state.uid), { name: name.value.trim(), username: username.value.trim().toLowerCase().replace(/[^a-z0-9_]/g, ""), bio: bio.value.trim() });
        Object.assign(state.me, { name: name.value.trim(), username: username.value.trim(), bio: bio.value.trim() });
        step = 1; renderStep();
      };
      body.append(el("div", { class: "onboarding-guide-fields" }, name, username, bio, save));
    } else {
      const list = el("div", { class: "onboarding-guide-list" }, el("div", { class: "onboarding-guide-loading" }, el("i", { class: "ri-loader-4-line" }), " Finding suggestions…"));
      const next = el("button", { class: "btn primary block" }, step === steps.length - 1 ? "Finish setup" : "Continue");
      next.onclick = () => { if (step === steps.length - 1) finish(); else { step += 1; renderStep(); } };
      body.append(list, next);
      const load = async () => {
        const source = step === 1
          ? await getDocs(query(collection(db, "users"), orderBy("createdAt", "desc"), limit(6)))
          : await getDocs(query(collection(db, "groups"), orderBy("createdAt", "desc"), limit(6)));
        list.innerHTML = "";
        source.docs.forEach((d) => {
          const item = { id: d.id, ...d.data() };
          if (step === 1 && item.id === state.uid) return;
          let selected = step === 1 ? (state.me.following || []).includes(item.id) : (item.members || []).includes(state.uid);
          const button = el("button", { class: `onboarding-guide-select${selected ? " selected" : ""}` }, selected ? "Selected" : "Select");
          button.onclick = async () => {
            const nextSelected = !selected;
            try {
              if (step === 1) {
                await updateDoc(doc(db, "users", state.uid), { following: nextSelected ? arrayUnion(item.id) : arrayRemove(item.id) });
                state.me.following = nextSelected ? [...new Set([...(state.me.following || []), item.id])] : (state.me.following || []).filter((id) => id !== item.id);
                selected = nextSelected;
              } else {
                const members = await changeGroupMembers(item.id, nextSelected ? { add: [state.uid] } : { remove: [state.uid] });
                selected = members.includes(state.uid);
              }
              button.textContent = selected ? "Selected" : "Select";
              button.classList.toggle("selected", selected);
            } catch (error) {
              toast(error?.message || "Could not update group membership");
            }
          };
          list.appendChild(el("div", { class: "onboarding-guide-row" },
            el("img", { class: "avatar sm", src: step === 1 ? avatarFor(item) : (item.iconUrl || item.photoURL || `https://api.dicebear.com/7.x/shapes/svg?seed=${item.id}`) }),
            el("div", { class: "onboarding-guide-row-info" },
              el("strong", {}, item.name || "Orbit member"),
              el("small", {}, step === 1 ? `@${item.username || "user"}` : `${(item.members || []).length} members`),
            ),
            button,
          ));
        });
        if (!list.children.length) list.appendChild(el("div", { class: "onboarding-guide-empty" }, "No suggestions yet — you can continue."));
      };
      load().catch(() => { list.innerHTML = ""; list.appendChild(el("div", { class: "onboarding-guide-empty" }, "You can continue and explore later.")); });
    }
  };
  card.append(
    el("button", { class: "icon-btn onboarding-guide-close", onclick: close }, el("i", { class: "ri-close-line" })),
    el("div", { class: "onboarding-guide-brand" }, el("i", { class: "ri-planet-fill" }), " ORBIT"),
    progress,
    body,
  );
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  renderStep();
};

const showFirstPostPrompt = () => {
  const overlay = el("div", { class: "first-post-overlay" });
  const card = el("div", { class: "first-post-card" },
    el("div", { class: "first-post-sparkles" }, "✦  ✧  ✦"),
    el("div", { class: "first-post-orbit" }, el("i", { class: "ri-quill-pen-line" })),
    el("h2", {}, "Your Orbit is ready"),
    el("p", {}, "Share something that feels like you and start your first conversation."),
    el("div", { class: "first-post-actions" },
      el("button", { class: "btn primary", onclick: () => { overlay.remove(); openCreatePost(); } }, el("i", { class: "ri-add-line" }), " Create your first post"),
      el("button", { class: "btn ghost", onclick: () => overlay.remove() }, "I’ll do it later"),
    ),
  );
  overlay.appendChild(card);
  document.body.appendChild(overlay);
};

const showOnboardingModal = () => {
  const overlay = el("div", { class: "onboard-overlay" });
  const modal   = el("div", { class: "onboard-modal" });

  const close = () => overlay.remove();

  // Header
  modal.appendChild(el("div", { class: "onboard-header" },
    el("div", { class: "onboard-logo" }, el("i", { class: "ri-planet-fill" })),
    el("h2", {}, `Welcome to Orbit, ${(state.me?.name || "there").split(" ")[0]}! 🚀`),
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
      let member = (g.members || []).includes(state.uid);
      const btn = el("button", {
        class: `btn sm ${member ? "ghost" : "primary"}`,
        onclick: async () => {
          try {
            const members = await changeGroupMembers(g.id, member ? { remove: [state.uid] } : { add: [state.uid] });
            member = members.includes(state.uid);
          } catch (error) {
            toast(error?.message || "Could not update group membership");
            return;
          }
          btn.textContent = member ? "✓ Joined" : "Join";
          btn.className = `btn sm ${member ? "ghost" : "primary"}`;
        }
      }, member ? "✓ Joined" : "Join");
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
      .filter(u => u.uid !== state.uid);
    for (let i = _all.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [_all[i], _all[j]] = [_all[j], _all[i]]; }
    _all.slice(0, 5).forEach((u) => {
      list.appendChild(el("div", { class: "suggest-row" },
        el("img", { class: "avatar sm", src: avatarFor(u), onclick: () => location.hash = `#profile/${u.uid}` }),
        el("div", { class: "meta" },
          el("div", { class: "name" }, u.name,
            u.verified ? el("span", { class: "verified", html: '<i class="ri-check-line"></i>' }) : null),
          el("div", { class: "uname" }, "@" + u.username),
        ),
        orbitFriendControls(u, { compact: true, stacked: true }),
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
  let pendingCoverFile = null;
  const closeModal = () => { modal.style.display = "none"; modal.classList.add("hidden"); pendingAvFile = null; pendingCoverFile = null; };
  document.getElementById("profileEditClose")?.addEventListener("click", closeModal);
  document.getElementById("editProfileCancel")?.addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });
  document.getElementById("editAvatarWrap")?.addEventListener("click", () => document.getElementById("editAvatarInput")?.click());
  document.getElementById("editAvatarInput")?.addEventListener("change", (e) => { const f = e.target.files?.[0]; if (!f) return; pendingAvFile = f; const av = document.getElementById("editAvatar"); if (av) av.src = URL.createObjectURL(f); });
  document.getElementById("editCoverWrap")?.addEventListener("click", () => document.getElementById("editCoverInput")?.click());
  document.getElementById("editCoverInput")?.addEventListener("change", (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    pendingCoverFile = f;
    const cover = document.getElementById("editCover");
    if (cover) cover.src = URL.createObjectURL(f);
  });
  save.addEventListener("click", async () => {
    const nameV = (document.getElementById("editName")?.value || "").trim();
    const userV = (document.getElementById("editUsername")?.value || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
    const bioV  = (document.getElementById("editBio")?.value || "").trim();
    const birthdayDate = document.getElementById("editBirthday")?.value || "";
    const birthday = /^\d{4}-(\d{2}-\d{2})$/.exec(birthdayDate)?.[1] || null;
    const birthdayAnnounceEnabled = !!birthday && document.getElementById("editBirthdayAnnounce")?.checked === true;
    if (!nameV) { toast("Name cannot be empty"); return; }
    const st = document.getElementById("editSaveText"); if (st) st.textContent = "Saving..."; save.disabled = true;
    try {
      const updates = {
        name: nameV, bio: bioV, username: userV || state.me.username,
        birthday, birthdayAnnounceEnabled,
      };
      if (pendingAvFile) { toast("Uploading photo..."); const up = await uploadToCloudinary(pendingAvFile, "image"); updates.photoURL = up.url; }
      if (pendingCoverFile) { toast("Uploading cover photo..."); const up = await uploadToCloudinary(pendingCoverFile, "image"); updates.coverURL = up.url; }
      await updateDoc(doc(db, "users", state.uid), updates);
      state.me = { ...state.me, ...updates };
      state.cache.users.delete(state.uid);
      announceBirthdayIfDue().catch((err) => console.warn("Birthday announcement failed:", err));
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
      style: "display:flex;align-items:center;gap:12px;padding:14px 16px;cursor:pointer;border-bottom:1px solid var(--border,rgba(255,255,255,0.07));background:linear-gradient(90deg,rgba(108,99,255,0.10) 0%,transparent 100%);flex-shrink:0;",
      onclick: () => location.hash = "#chats/ai",
    },
      el("div", { class: "av", style: "position:relative;" },
        el("div", { style: "width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,#6c63ff,#ff6b9d);display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;" }, state.aiAvatar),
        el("span", { style: "position:absolute;bottom:1px;right:1px;width:10px;height:10px;border-radius:50%;background:#22c55e;border:2px solid var(--bg2,#1a1a2e);" }),
      ),
      el("div", { class: "meta", style: "min-width:0;flex:1;" },
        el("div", { class: "name", style: "font-weight:700;font-size:15px;" }, state.aiName,
          el("span", { style: "font-size:10px;font-weight:700;color:#6c63ff;margin-left:6px;background:rgba(108,99,255,.15);padding:1px 6px;border-radius:20px;" }, "AI"),
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
    wrap.appendChild(el("div", { style: "width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,var(--grad-1,#6c63ff),var(--grad-2,#ff6b9d));display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0;" }, state.aiAvatar));
  }
  const bubble = el("div", { style: `max-width:75%;padding:10px 14px;border-radius:${isAI ? "4px 18px 18px 18px" : "18px 4px 18px 18px"};background:${isAI ? "var(--bg3,#2a2a3a)" : "var(--primary,#6c63ff)"};color:${isAI ? "var(--text)" : "#fff"};font-size:14px;line-height:1.5;word-break:break-word;` });
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
    typingWrap.appendChild(el("div", { style: "width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,var(--grad-1,#6c63ff),var(--grad-2,#ff6b9d));display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0;" }, state.aiAvatar));
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
    .ai-chat-textarea:focus { border-color:var(--primary,#6c63ff); }
    .ai-chat-send-btn { width:40px;height:40px;border-radius:50%;background:var(--primary,#6c63ff);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:#fff; }
    .ai-chat-send-btn:hover { opacity:.85; }
    .ai-settings-sheet { display:flex;flex-direction:column;gap:10px;max-height:80dvh;overflow-y:auto; }
    .ai-settings-section { font-size:11px;font-weight:700;letter-spacing:.7px;text-transform:uppercase;color:var(--text3);margin-top:8px; }
    .ai-name-input { width:100%;padding:10px 14px;border:1px solid var(--border,rgba(255,255,255,0.12));border-radius:12px;background:var(--bg3);color:var(--text);font-size:14px;outline:none;box-sizing:border-box; }
    .ai-avatar-grid { display:flex;flex-wrap:wrap;gap:8px;margin-top:4px; }
    .ai-avatar-opt { width:42px;height:42px;border-radius:50%;border:2px solid transparent;display:flex;align-items:center;justify-content:center;font-size:22px;cursor:pointer;background:var(--bg3);transition:border-color .15s; }
    .ai-avatar-opt.sel { border-color:var(--primary,#6c63ff); }
    .ai-tone-list { display:flex;flex-direction:column;gap:6px;margin-top:4px; }
    .ai-tone-opt { display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:12px;border:1px solid transparent;cursor:pointer;background:var(--bg3);transition:border-color .15s; }
    .ai-tone-opt.sel { border-color:var(--primary,#6c63ff);background:rgba(108,99,255,.1); }
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
    localStorage.setItem("orbit:ai_name",   state.aiName);
    localStorage.setItem("orbit:ai_avatar", state.aiAvatar);
    localStorage.setItem("orbit:ai_tone",   state.aiTone);
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
    el("div", { style: "width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,var(--grad-1,#6c63ff),var(--grad-2,#ff6b9d));display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;" }, state.aiAvatar),
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
// Boot screen is hidden by onAuthStateChanged — do NOT hide it on a timer,
// or there will be a blank-page flash while Firebase resolves auth state.
