// =========================================================================
// Orbit — additional.js  (v2 — Agora group calls + raise hand)
// Stories (24 hr), Notifications full-page view,
// Group Voice Calls via Agora (2000+ users, crystal-clear audio),
// 1-on-1 Voice + Video Calls via WebRTC (unchanged).
// =========================================================================

import {
  state, db, $, $$, el, fmtTime, toast, avatarFor, fetchUser,
  uploadToCloudinary, writeNotif,
} from "./app.js";

import {
  doc, setDoc, getDoc, updateDoc, addDoc,
  collection, query, where, orderBy, limit, onSnapshot, getDocs,
  serverTimestamp, arrayUnion, arrayRemove, Timestamp,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

// =========================================================================
// AGORA CONFIG
// Sign up free at https://console.agora.io → create a project → copy App ID.
// Set Authentication to "No certificate" while testing (no token server needed).
// =========================================================================
const AGORA_APP_ID = "415f1487439241848e7841abca1b0d3a"; // ← paste your App ID here

// =========================================================================
// 1. STORIES
// =========================================================================
const STORY_TTL_MS = 24 * 60 * 60 * 1000;

export const injectStoryBar = (feedWrap) => {
  if (!feedWrap) return;
  const existing = feedWrap.querySelector(".story-bar");
  if (existing) existing.remove();

  const bar = document.createElement("div");
  bar.className = "story-bar";

  const myBtn = document.createElement("div");
  myBtn.className = "story-item my-story";
  myBtn.innerHTML = `
    <div class="story-ring no-story">
      <img class="story-av" src="${avatarFor(state.me)}" alt="" />
      <span class="story-add-icon"><i class="ri-add-line"></i></span>
    </div>
    <span class="story-name">Your story</span>`;
  myBtn.onclick = () => openStoryUploader();
  bar.appendChild(myBtn);

  const cutoff = Timestamp.fromMillis(Date.now() - STORY_TTL_MS);
  onSnapshot(
    query(collection(db, "stories"), where("expiresAt", ">", cutoff), orderBy("expiresAt", "asc"), limit(60)),
    async (snap) => {
      bar.querySelectorAll(".story-item:not(.my-story)").forEach(n => n.remove());

      const byUser = new Map();
      snap.docs.forEach(d => {
        const s = { id: d.id, ...d.data() };
        if (!byUser.has(s.authorUid)) byUser.set(s.authorUid, []);
        byUser.get(s.authorUid).push(s);
      });

      if (byUser.has(state.uid)) {
        const mine = byUser.get(state.uid);
        const hasUnseen = mine.some(s => !(s.viewers || []).includes(state.uid));
        const ring = myBtn.querySelector(".story-ring");
        ring.className = `story-ring ${hasUnseen ? "has-story" : "seen-story"}`;
        myBtn.onclick = () => openStoryViewer(state.uid, mine);
      } else {
        const ring = myBtn.querySelector(".story-ring");
        ring.className = "story-ring no-story";
        myBtn.onclick = () => openStoryUploader();
      }

      const otherUids = [...byUser.keys()].filter(u => u !== state.uid);
      const users = await Promise.all(otherUids.map(fetchUser));
      const userMap = Object.fromEntries(users.filter(Boolean).map(u => [u.uid, u]));

      otherUids.forEach(uid => {
        const user = userMap[uid];
        if (!user) return;
        const stories = byUser.get(uid);
        const allSeen = stories.every(s => (s.viewers || []).includes(state.uid));
        const item = document.createElement("div");
        item.className = "story-item";
        item.innerHTML = `
          <div class="story-ring ${allSeen ? "seen-story" : "has-story"}">
            <img class="story-av" src="${avatarFor(user)}" alt="" />
          </div>
          <span class="story-name">${(user.name || "User").split(" ")[0]}</span>`;
        item.onclick = () => openStoryViewer(uid, stories);
        bar.appendChild(item);
      });
    }
  );

  feedWrap.insertBefore(bar, feedWrap.firstChild);
};

const openStoryUploader = () => {
  const overlay = document.createElement("div");
  overlay.className = "story-upload-overlay";
  overlay.innerHTML = `
    <div class="story-upload-sheet">
      <button class="icon-btn story-close-btn"><i class="ri-close-line"></i></button>
      <div class="story-upload-title"><i class="ri-gallery-upload-line"></i> Add to your story</div>
      <div class="story-upload-opts">
        <button class="story-opt-btn" id="sPickImg"><i class="ri-image-line"></i><span>Photo</span></button>
        <button class="story-opt-btn" id="sPickVid"><i class="ri-vidicon-line"></i><span>Video</span></button>
        <button class="story-opt-btn" id="sPickTxt"><i class="ri-text"></i><span>Text only</span></button>
      </div>
      <div id="storyPreviewArea" class="story-preview-area"></div>
      <textarea id="storyCaptionInput" class="story-caption-input" placeholder="Add a caption…" maxlength="150"></textarea>
      <button class="btn primary" id="storyPostBtn" style="width:100%;margin-top:10px;"><i class="ri-check-line"></i> Share to story</button>
      <input type="file" id="storyFileInput" style="display:none;" />
    </div>`;
  overlay.querySelector(".story-close-btn").onclick = () => overlay.remove();
  overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);

  let pendingFile = null;
  const fileInput = overlay.querySelector("#storyFileInput");
  const previewArea = overlay.querySelector("#storyPreviewArea");

  overlay.querySelector("#sPickImg").onclick = () => { fileInput.accept = "image/*"; fileInput.click(); };
  overlay.querySelector("#sPickVid").onclick = () => { fileInput.accept = "video/*"; fileInput.click(); };
  overlay.querySelector("#sPickTxt").onclick = () => {
    pendingFile = null; previewArea.innerHTML = "";
    overlay.querySelector("#storyCaptionInput").placeholder = "What's on your mind? (text story)";
    toast("Type your story in the caption box below");
  };
  fileInput.onchange = e => {
    pendingFile = e.target.files[0] || null;
    if (!pendingFile) return;
    previewArea.innerHTML = "";
    const url = URL.createObjectURL(pendingFile);
    const med = pendingFile.type.startsWith("video")
      ? Object.assign(document.createElement("video"), { src: url, muted: true, controls: true })
      : Object.assign(document.createElement("img"), { src: url });
    med.style.cssText = "width:100%;max-height:240px;border-radius:10px;margin-top:8px;object-fit:cover;";
    previewArea.appendChild(med);
  };

  overlay.querySelector("#storyPostBtn").onclick = async () => {
    const caption = overlay.querySelector("#storyCaptionInput").value.trim();
    if (!pendingFile && !caption) { toast("Add media or write a text story"); return; }
    const btn = overlay.querySelector("#storyPostBtn");
    btn.disabled = true; btn.textContent = "Sharing…";
    try {
      let mediaUrl = null, mediaType = null;
      if (pendingFile) {
        toast("Uploading…");
        const up = await uploadToCloudinary(pendingFile, pendingFile.type.startsWith("video") ? "video" : "image");
        mediaUrl = up.url; mediaType = pendingFile.type.startsWith("video") ? "video" : "image";
      }
      await addDoc(collection(db, "stories"), {
        authorUid: state.uid, mediaUrl, mediaType,
        caption: caption || null, viewers: [],
        createdAt: serverTimestamp(),
        expiresAt: Timestamp.fromMillis(Date.now() + STORY_TTL_MS),
      });
      toast("Story shared!"); overlay.remove();
    } catch (err) {
      toast("Failed: " + (err.message || "check config"));
      btn.disabled = false; btn.textContent = "Share to story";
    }
  };
};

const openStoryViewer = (uid, stories) => {
  if (!stories?.length) return;
  let idx = 0;
  let timer = null;

  const overlay = document.createElement("div");
  overlay.className = "story-viewer-overlay";
  document.body.appendChild(overlay);

  const render = async () => {
    clearTimeout(timer);
    const s = stories[idx];
    if (!s) { overlay.remove(); return; }

    const segs = stories.map((_, i) =>
      `<div class="story-seg ${i < idx ? "done" : i === idx ? "active" : ""}"><div class="story-seg-fill" style="${i === idx ? "animation:story-prog 5s linear forwards;" : ""}"></div></div>`
    ).join("");

    const user = await fetchUser(uid).catch(() => null);

    overlay.innerHTML = `
      <div class="story-viewer">
        <div class="story-segs">${segs}</div>
        <div class="story-viewer-head">
          <img class="story-av" src="${avatarFor(user)}" style="width:36px;height:36px;border-radius:50%;border:2px solid white;" />
          <div class="story-viewer-uname">${user?.name || "User"}</div>
          <div style="margin-left:auto;font-size:12px;color:rgba(255,255,255,.7);">${fmtTime(s.createdAt)}</div>
          <button class="icon-btn story-viewer-close" style="color:#fff;margin-left:8px;"><i class="ri-close-line"></i></button>
        </div>
        <div class="story-viewer-media">
          ${s.mediaType === "video" && s.mediaUrl
            ? `<video src="${s.mediaUrl}" autoplay muted playsinline loop style="width:100%;height:100%;object-fit:cover;"></video>`
            : s.mediaUrl
            ? `<img src="${s.mediaUrl}" style="width:100%;height:100%;object-fit:cover;" />`
            : `<div class="story-text-card">${s.caption || ""}</div>`}
        </div>
        ${s.caption && s.mediaUrl ? `<div class="story-viewer-caption">${s.caption}</div>` : ""}
        <div class="story-tap-zones">
          <div class="story-tap-prev"></div>
          <div class="story-tap-next"></div>
        </div>
      </div>`;

    overlay.querySelector(".story-viewer-close").onclick = () => { clearTimeout(timer); overlay.remove(); };
    overlay.querySelector(".story-tap-prev").onclick = () => { idx = Math.max(0, idx - 1); render(); };
    overlay.querySelector(".story-tap-next").onclick = () => { idx++; render(); };

    if (s.mediaType !== "video") {
      timer = setTimeout(() => { idx++; render(); }, 5000);
    } else {
      const vid = overlay.querySelector("video");
      if (vid) vid.onended = () => { idx++; render(); };
    }

    if (!(s.viewers || []).includes(state.uid)) {
      updateDoc(doc(db, "stories", s.id), { viewers: arrayUnion(state.uid) }).catch(() => {});
    }
  };

  render();
};

// =========================================================================
// 2. NOTIFICATIONS — Full page view
// =========================================================================
export const renderNotifications = (root) => {
  root.innerHTML = "";

  const head = document.createElement("div");
  head.className = "section-head";
  head.innerHTML = `<h2 style="margin:0;">Notifications</h2>`;
  const markBtn = document.createElement("button");
  markBtn.className = "btn ghost";
  markBtn.style.cssText = "font-size:13px;";
  markBtn.innerHTML = `<i class="ri-check-double-line"></i> Mark all read`;
  head.appendChild(markBtn);
  root.appendChild(head);

  const list = document.createElement("div");
  list.className = "notif-full-list";
  list.innerHTML = `<div class="empty" style="padding:40px 0;"><i class="ri-loader-4-line" style="font-size:28px;animation:spin 1s linear infinite;"></i><div class="t">Loading…</div></div>`;
  root.appendChild(list);

  const iconMap = {
    orbit: "ri-fire-fill", follow: "ri-user-follow-fill", message: "ri-chat-1-fill",
    comment: "ri-chat-4-fill", experience: "ri-sparkling-fill", call: "ri-phone-fill",
  };
  const colMap = {
    orbit: "var(--grad-2)", follow: "var(--primary)", message: "var(--good)",
    comment: "var(--grad-3)", experience: "var(--grad-1)", call: "#3fdca0",
  };
  const descMap = {
    orbit: "orbited your post", follow: "followed you", message: "sent you a message",
    comment: "commented on your post", experience: "replied to your experience", call: "called you",
  };

  const q = query(
    collection(db, "notifications", state.uid, "items"),
    orderBy("createdAt", "desc"),
    limit(60)
  );

  let _unsub = null;
  _unsub = onSnapshot(q, (snap) => {
    markBtn.onclick = () => {
      snap.docs.filter(d => !d.data().read).forEach(d =>
        updateDoc(doc(db, "notifications", state.uid, "items", d.id), { read: true }).catch(() => {})
      );
      toast("All marked as read");
    };

    list.innerHTML = "";

    if (snap.empty) {
      list.innerHTML = `
        <div class="empty" style="padding:60px 0;">
          <i class="ri-notification-off-line" style="font-size:52px;opacity:.3;"></i>
          <div class="t">No notifications yet</div>
          <div>When someone orbits, follows, or messages you, it'll appear here.</div>
        </div>`;
      return;
    }

    snap.docs.forEach(d => {
      const n = { id: d.id, ...d.data() };
      const ic = iconMap[n.type] || "ri-notification-3-fill";
      const co = colMap[n.type] || "var(--primary)";
      const desc = descMap[n.type] || "interacted with you";
      const bodyTxt = n.text || `${n.fromName || "Someone"} ${desc}`;

      const item = document.createElement("div");
      item.className = "notif-full-item" + (n.read ? "" : " unread");
      item.innerHTML = `
        <div class="nfi-icon" style="background:${co}20;"><i class="${ic}" style="color:${co};font-size:18px;"></i></div>
        <img class="avatar sm nfi-av" src="${n.fromAvatar || `https://api.dicebear.com/7.x/shapes/svg?seed=${n.fromUid || "x"}`}" alt="" />
        <div class="nfi-body">
          <div class="nfi-text">${bodyTxt}</div>
          <div class="nfi-time">${n.createdAt ? fmtTime(n.createdAt) : ""}</div>
        </div>
        ${!n.read ? '<div class="nfi-dot"></div>' : ""}`;

      item.addEventListener("click", () => {
        if (!n.read) updateDoc(doc(db, "notifications", state.uid, "items", n.id), { read: true }).catch(() => {});
        item.classList.remove("unread");
        item.querySelector(".nfi-dot")?.remove();
        if (n.type === "message" && n.fromUid) location.hash = "#chats/" + n.fromUid;
        else if (n.type === "follow" && n.fromUid) location.hash = "#profile/" + n.fromUid;
        else if (n.type === "call" && n.callId) { /* handled by call banner */ }
        else location.hash = "#feed";
      });

      list.appendChild(item);
    });
  }, () => {
    list.innerHTML = `<div class="empty" style="padding:60px 0;"><i class="ri-error-warning-line"></i><div class="t">Could not load</div></div>`;
  });

  window.addEventListener("hashchange", () => { if (_unsub) _unsub(); }, { once: true });
};

// =========================================================================
// 3. VOICE CALLS
//
// GROUP calls  → Agora RTC (SFU, handles 2000+ people, noise-cancelled)
//                Voice only — no video in groups.
//                UI: Telegram-style slide-up bottom sheet.
//                Features: Raise Hand, speaking ring, mute, participant list.
//
// 1-on-1 calls → WebRTC P2P with Firebase signaling (unchanged).
//                Supports voice + video.
// =========================================================================

// ── Agora SDK lazy-loader ─────────────────────────────────────────────────
let _AgoraRTC = null;
const getAgora = () => new Promise((resolve, reject) => {
  if (_AgoraRTC) return resolve(_AgoraRTC);
  if (window.AgoraRTC) { _AgoraRTC = window.AgoraRTC; return resolve(_AgoraRTC); }
  const s = document.createElement("script");
  s.src = "https://download.agora.io/sdk/release/AgoraRTC_N-4.21.0.js";
  s.onload = () => { _AgoraRTC = window.AgoraRTC; resolve(_AgoraRTC); };
  s.onerror = () => reject(new Error("Failed to load Agora SDK"));
  document.head.appendChild(s);
});

// ── Active call state ─────────────────────────────────────────────────────
let _activeCall = null;

// =========================================================================
// GROUP VOICE CALL  (Agora)
// =========================================================================

export const startGroupVoiceCall = async ({ chatId, groupName = "Group" }) => {
  if (_activeCall) { toast("You're already in a call"); return; }
  if (AGORA_APP_ID === "YOUR_AGORA_APP_ID") {
    toast("Add your Agora App ID in additional.js to enable group calls");
    return;
  }

  // Check if a call already exists for this group
  const existing = await getDocs(
    query(collection(db, "calls"),
      where("chatId", "==", chatId),
      where("status", "==", "active"),
      where("isGroup", "==", true),
      limit(1))
  );

  let callId;
  if (!existing.empty) {
    callId = existing.docs[0].id;
    await updateDoc(doc(db, "calls", callId), {
      participants: arrayUnion(state.uid),
    }).catch(() => {});
  } else {
    const callRef = await addDoc(collection(db, "calls"), {
      createdAt: serverTimestamp(),
      callerId: state.uid,
      callerName: state.me?.name || "Someone",
      callerAvatar: state.me?.photoURL || "",
      type: "voice",
      chatId,
      isGroup: true,
      groupName,
      participants: [state.uid],
      raisedHands: [],
      status: "active",
    });
    callId = callRef.id;

    const gSnap = await getDoc(doc(db, "groups", chatId)).catch(() => null);
    const members = (gSnap?.data()?.members || []).filter(u => u !== state.uid);
    for (const uid of members) {
      writeNotif(uid, "call", {
        text: `${state.me?.name || "Someone"} started a voice call in ${groupName}`,
        callId,
        chatId,
        groupName,
      }).catch(() => {});
    }
  }

  await _joinAgoraGroupCall({ callId, chatId, groupName });
};

export const joinGroupVoiceCall = async ({ callId, chatId, groupName = "Group" }) => {
  if (_activeCall) { toast("Already in a call"); return; }
  await updateDoc(doc(db, "calls", callId), {
    participants: arrayUnion(state.uid),
  }).catch(() => {});
  await _joinAgoraGroupCall({ callId, chatId, groupName });
};

const _joinAgoraGroupCall = async ({ callId, chatId, groupName }) => {
  let AgoraRTC;
  try {
    AgoraRTC = await getAgora();
  } catch {
    toast("Could not load voice call engine — check your internet connection");
    return;
  }

  let localTrack;
  try {
    localTrack = await AgoraRTC.createMicrophoneAudioTrack({
      encoderConfig: { bitrate: 48, stereo: false },
      AEC: true,
      AGC: true,
      ANS: true,
    });
  } catch {
    toast("Microphone access denied — allow mic and try again");
    return;
  }

  const client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });

  try {
    await client.join(AGORA_APP_ID, callId, null, state.uid);
    await client.publish([localTrack]);
  } catch (err) {
    localTrack.stop(); localTrack.close();
    // Error 4096 (CAN_NOT_GET_GATEWAY_SERVER) = your Agora project has
    // "Primary Certificate" enabled. Fix:
    //   console.agora.io → your project → Edit → Auth → "No certificate"
    const code = String(err?.code ?? err?.message ?? "");
    if (code.includes("4096") || code.includes("GATEWAY") || code.includes("CAN_NOT_GET")) {
      toast(
        "Agora setup needed: go to console.agora.io → your project → Edit → " +
        "change Auth to 'No certificate', then try again."
      );
    } else if (!AGORA_APP_ID || AGORA_APP_ID === "YOUR_AGORA_APP_ID") {
      toast("Paste your Agora App ID in additional.js first");
    } else {
      toast("Voice call failed: " + (err?.message || "check console for details"));
    }
    return;
  }

  client.enableAudioVolumeIndicator();

  const remoteUsers = new Map();

  client.on("user-published", async (user, mediaType) => {
    await client.subscribe(user, mediaType);
    if (mediaType === "audio") {
      user.audioTrack.play();
      remoteUsers.set(String(user.uid), user);
      _groupCallAddParticipant(panel, String(user.uid));
    }
  });

  client.on("user-unpublished", (user) => {
    remoteUsers.delete(String(user.uid));
  });

  client.on("user-left", (user) => {
    remoteUsers.delete(String(user.uid));
    _groupCallRemoveParticipant(panel, String(user.uid));
    _groupCallUpdateCount(panel);
  });

  // Speaking indicator — glows the ring when someone is talking
  client.on("volume-indicator", (volumes) => {
    volumes.forEach(({ uid, level }) => {
      const tile = panel.querySelector(`.vc-tile[data-uid="${uid}"]`);
      if (tile) tile.classList.toggle("vc-speaking", level > 8);
    });
  });

  // ── Firestore real-time sync ───────────────────────────────────────────
  // Tracks participants joining/leaving + raised hands
  const callUnsub = onSnapshot(doc(db, "calls", callId), async (snap) => {
    if (!snap.exists() || snap.data().status === "ended") {
      _leaveAgoraCall();
      return;
    }
    const data = snap.data();
    _groupCallSyncParticipants(panel, data.participants || []);
    _groupCallSyncRaisedHands(panel, data.raisedHands || []);
  });

  // Build the Telegram-style slide-up panel
  const panel = _buildGroupCallPanel({ callId, groupName, localTrack });
  document.body.appendChild(panel);
  requestAnimationFrame(() => panel.classList.add("vc-visible"));

  let muted = false;
  let handRaised = false;

  // ── Mute ─────────────────────────────────────────────────────────────
  panel.querySelector("#vcMute").addEventListener("click", () => {
    muted = !muted;
    localTrack.setEnabled(!muted);
    const btn = panel.querySelector("#vcMute");
    btn.querySelector("i").className = muted ? "ri-mic-off-fill" : "ri-mic-fill";
    btn.classList.toggle("vc-btn-active", muted);
    btn.querySelector(".vc-btn-label").textContent = muted ? "Unmute" : "Mute";
    const myTile = panel.querySelector(`.vc-tile[data-uid="${state.uid}"]`);
    myTile?.classList.toggle("vc-muted", muted);
  });

  // ── Raise Hand ────────────────────────────────────────────────────────
  panel.querySelector("#vcHand").addEventListener("click", async () => {
    handRaised = !handRaised;
    const btn = panel.querySelector("#vcHand");
    btn.classList.toggle("vc-btn-active", handRaised);
    btn.querySelector("i").className = handRaised ? "ri-hand-coin-fill" : "ri-hand-coin-line";
    btn.querySelector(".vc-btn-label").textContent = handRaised ? "Lower hand" : "Raise hand";

    await updateDoc(doc(db, "calls", callId), {
      raisedHands: handRaised ? arrayUnion(state.uid) : arrayRemove(state.uid),
    }).catch(() => {});

    if (handRaised) toast("✋ Hand raised — the host can see this");
  });

  // ── Leave ─────────────────────────────────────────────────────────────
  panel.querySelector("#vcLeave").addEventListener("click", () => _leaveAgoraCall());

  // ── Minimise / expand ─────────────────────────────────────────────────
  panel.querySelector("#vcMinimise").addEventListener("click", () => {
    panel.classList.toggle("vc-minimised");
    panel.querySelector("#vcMinimise i").className =
      panel.classList.contains("vc-minimised") ? "ri-arrow-up-s-line" : "ri-arrow-down-s-line";
  });

  _activeCall = { type: "group", callId, client, localTrack, callUnsub, panel };

  // Add our own tile immediately
  _groupCallAddParticipant(panel, state.uid);

  // ── Leave handler ─────────────────────────────────────────────────────
  const _leaveAgoraCall = async () => {
    if (!_activeCall) return;
    const ac = _activeCall;
    _activeCall = null;

    ac.callUnsub?.();
    ac.localTrack?.stop();
    ac.localTrack?.close();
    try { await ac.client.leave(); } catch {}

    // Clear our raised hand on exit
    await updateDoc(doc(db, "calls", ac.callId), {
      participants: arrayRemove(state.uid),
      raisedHands: arrayRemove(state.uid),
    }).catch(() => {});

    // Mark ended if we were the last person
    const snap = await getDoc(doc(db, "calls", ac.callId)).catch(() => null);
    if (snap?.exists()) {
      const remaining = (snap.data().participants || []).filter(u => u !== state.uid);
      if (remaining.length === 0) {
        await updateDoc(doc(db, "calls", ac.callId), { status: "ended" }).catch(() => {});
      }
    }

    ac.panel.classList.remove("vc-visible");
    setTimeout(() => ac.panel.remove(), 380);
    toast("Left the call");
  };
};

// ── Telegram-style slide-up panel builder ─────────────────────────────────
const _buildGroupCallPanel = ({ callId, groupName }) => {
  const panel = document.createElement("div");
  panel.className = "vc-panel";
  panel.id = "vcPanel";
  panel.innerHTML = `
    <div class="vc-handle-bar"></div>

    <div class="vc-header">
      <div class="vc-header-left">
        <div class="vc-title">
          <i class="ri-mic-fill" style="color:var(--primary);font-size:16px;"></i>
          <span class="vc-title-text">${groupName}</span>
        </div>
        <div class="vc-subtitle">
          <span class="vc-count">1 participant</span>
          <span class="vc-dot-sep">·</span>
          <span class="vc-timer" id="vcTimer">00:00</span>
        </div>
      </div>
      <div class="vc-header-right">
        <button class="vc-icon-btn" id="vcMinimise" title="Minimise">
          <i class="ri-arrow-down-s-line"></i>
        </button>
      </div>
    </div>

    <!-- Raised-hands queue — appears when someone raises hand -->
    <div class="vc-hands-queue hidden" id="vcHandsQueue">
      <i class="ri-hand-coin-fill" style="color:#f6c90e;"></i>
      <span class="vc-hands-text" id="vcHandsText"></span>
    </div>

    <div class="vc-participants" id="vcParticipants"></div>

    <div class="vc-controls">
      <div class="vc-ctrl-col">
        <button class="vc-ctrl-btn" id="vcMute">
          <i class="ri-mic-fill"></i>
        </button>
        <span class="vc-btn-label">Mute</span>
      </div>
      <div class="vc-ctrl-col">
        <button class="vc-ctrl-btn" id="vcHand" title="Raise hand">
          <i class="ri-hand-coin-line"></i>
        </button>
        <span class="vc-btn-label">Raise hand</span>
      </div>
      <div class="vc-ctrl-col">
        <button class="vc-ctrl-btn vc-leave-btn" id="vcLeave">
          <i class="ri-phone-fill" style="transform:rotate(135deg);display:inline-block;"></i>
        </button>
        <span class="vc-btn-label">Leave</span>
      </div>
    </div>`;

  // Call timer
  const startMs = Date.now();
  const timerEl = panel.querySelector("#vcTimer");
  const timerInterval = setInterval(() => {
    if (!document.body.contains(panel)) { clearInterval(timerInterval); return; }
    const s = Math.floor((Date.now() - startMs) / 1000);
    timerEl.textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }, 1000);

  return panel;
};

// ── Participant tile helpers ───────────────────────────────────────────────
const _groupCallAddParticipant = async (panel, uid) => {
  const grid = panel.querySelector("#vcParticipants");
  if (!grid || grid.querySelector(`.vc-tile[data-uid="${uid}"]`)) return;

  const isMe = uid === state.uid;
  const tile = document.createElement("div");
  tile.className = "vc-tile";
  tile.dataset.uid = uid;
  tile.innerHTML = `
    <div class="vc-av-wrap">
      <img class="vc-av" src="${avatarFor(isMe ? state.me : { uid })}" alt="" />
      <div class="vc-speaking-ring"></div>
      <div class="vc-hand-badge hidden" title="Hand raised">✋</div>
    </div>
    <div class="vc-tile-name">${isMe ? (state.me?.name?.split(" ")[0] || "You") : "…"}</div>
    <div class="vc-tile-mic"><i class="ri-mic-off-fill"></i></div>`;

  if (!isMe) {
    fetchUser(uid).then(u => {
      if (!u) return;
      tile.querySelector(".vc-av").src = avatarFor(u);
      tile.querySelector(".vc-tile-name").textContent = (u.name || "User").split(" ")[0];
    });
  }

  grid.appendChild(tile);
  _groupCallUpdateCount(panel);
};

const _groupCallRemoveParticipant = (panel, uid) => {
  panel.querySelector(`.vc-tile[data-uid="${uid}"]`)?.remove();
};

const _groupCallUpdateCount = (panel) => {
  const count = panel.querySelectorAll(".vc-tile").length;
  const el2 = panel.querySelector(".vc-count");
  if (el2) el2.textContent = `${count} participant${count !== 1 ? "s" : ""}`;
};

const _groupCallSyncParticipants = (panel, uids) => {
  uids.forEach(uid => _groupCallAddParticipant(panel, uid));
  panel.querySelectorAll(".vc-tile").forEach(tile => {
    if (!uids.includes(tile.dataset.uid)) tile.remove();
  });
  _groupCallUpdateCount(panel);
};

// ── Raised-hand sync ─────────────────────────────────────────────────────
const _groupCallSyncRaisedHands = async (panel, raisedUids) => {
  // Update hand badge on every tile
  panel.querySelectorAll(".vc-tile").forEach(tile => {
    const badge = tile.querySelector(".vc-hand-badge");
    if (!badge) return;
    const hasHand = raisedUids.includes(tile.dataset.uid);
    badge.classList.toggle("hidden", !hasHand);
    tile.classList.toggle("vc-hand-raised", hasHand);
  });

  // Update the hands queue banner at the top
  const queue = panel.querySelector("#vcHandsQueue");
  const queueText = panel.querySelector("#vcHandsText");
  if (!queue || !queueText) return;

  if (raisedUids.length === 0) {
    queue.classList.add("hidden");
    return;
  }

  queue.classList.remove("hidden");

  // Resolve names for the banner (cache-friendly — fetchUser caches)
  const names = await Promise.all(
    raisedUids.slice(0, 3).map(uid =>
      uid === state.uid
        ? Promise.resolve(state.me?.name?.split(" ")[0] || "You")
        : fetchUser(uid).then(u => (u?.name || "Someone").split(" ")[0]).catch(() => "Someone")
    )
  );

  const extra = raisedUids.length > 3 ? ` +${raisedUids.length - 3} more` : "";
  queueText.textContent = `${names.join(", ")}${extra} raised hand${raisedUids.length > 1 ? "s" : ""}`;
};

// =========================================================================
// 1-ON-1 VOICE + VIDEO CALLS  (WebRTC P2P — unchanged)
// =========================================================================

const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
  ],
};

export const startCall = async ({ peerId, chatId, isGroup, type = "voice" }) => {
  // Group calls always use Agora
  if (isGroup) {
    const gSnap = await getDoc(doc(db, "groups", chatId)).catch(() => null);
    const groupName = gSnap?.data()?.name || "Group";
    return startGroupVoiceCall({ chatId, groupName });
  }

  if (_activeCall) { toast("You're already in a call"); return; }
  const hasVideo = type === "video";
  let localStream;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: hasVideo });
  } catch {
    toast("Microphone" + (hasVideo ? "/camera" : "") + " access denied");
    return;
  }

  const callRef = await addDoc(collection(db, "calls"), {
    createdAt: serverTimestamp(),
    callerId: state.uid,
    callerName: state.me?.name || "Someone",
    callerAvatar: state.me?.photoURL || "",
    type, chatId, isGroup: false,
    participants: [state.uid],
    status: "ringing",
  });
  const callId = callRef.id;

  writeNotif(peerId, "call", {
    text: `${state.me?.name || "Someone"} is calling you`,
    callId,
  }).catch(() => {});

  const overlay = _buildDMCallOverlay({ callId, localStream, type, role: "caller" });
  document.body.appendChild(overlay);
  _activeCall = { type: "dm", callId, overlay, localStream, peers: {}, unsubs: [] };

  _connectPeer({ callId, localStream, peerId, overlay, type });
};

const _connectPeer = async ({ callId, localStream, peerId, overlay }) => {
  const pc = new RTCPeerConnection(ICE_SERVERS);
  if (_activeCall) _activeCall.peers[peerId] = pc;

  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  pc.ontrack = e => _addDMRemoteStream(overlay, peerId, e.streams[0]);

  const candCol = collection(db, "calls", callId, `cand_${state.uid}_${peerId}`);
  pc.onicecandidate = e => {
    if (e.candidate) addDoc(candCol, e.candidate.toJSON()).catch(() => {});
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await setDoc(doc(db, "calls", callId, "offers", peerId), {
    from: state.uid, sdp: offer.sdp, type: offer.type,
  });

  const u1 = onSnapshot(doc(db, "calls", callId, "answers", state.uid), async snap => {
    if (!snap.exists()) return;
    const ans = snap.data();
    if (ans.from !== peerId || pc.remoteDescription) return;
    await pc.setRemoteDescription(new RTCSessionDescription(ans)).catch(() => {});
  });

  const u2 = onSnapshot(
    query(collection(db, "calls", callId, `cand_${peerId}_${state.uid}`), orderBy("__name__")),
    snap => {
      snap.docChanges().filter(c => c.type === "added").forEach(c => {
        pc.addIceCandidate(new RTCIceCandidate(c.doc.data())).catch(() => {});
      });
    }
  );

  if (_activeCall) { _activeCall.unsubs.push(u1, u2); }
};

export const answerCall = async (callId) => {
  const callSnap = await getDoc(doc(db, "calls", callId)).catch(() => null);
  if (!callSnap?.exists()) { toast("Call no longer available"); return; }

  const call = callSnap.data();

  if (call.isGroup) {
    if (call.status === "ended") { toast("This call has ended"); return; }
    return joinGroupVoiceCall({ callId, chatId: call.chatId, groupName: call.groupName || "Group" });
  }

  if (call.status !== "ringing") { toast("Call no longer available"); return; }
  if (_activeCall) { toast("Already in a call"); return; }

  let localStream;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: call.type === "video" });
  } catch {
    toast("Microphone access denied"); return;
  }

  await updateDoc(doc(db, "calls", callId), {
    participants: arrayUnion(state.uid), status: "active",
  });

  const overlay = _buildDMCallOverlay({ callId, localStream, type: call.type, role: "callee" });
  document.body.appendChild(overlay);
  _activeCall = { type: "dm", callId, overlay, localStream, peers: {}, unsubs: [] };

  const u0 = onSnapshot(doc(db, "calls", callId, "offers", state.uid), async snap => {
    if (!snap.exists()) return;
    const offer = snap.data();
    const peerId = offer.from;
    if (_activeCall?.peers[peerId]) return;

    const pc = new RTCPeerConnection(ICE_SERVERS);
    if (_activeCall) _activeCall.peers[peerId] = pc;

    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    pc.ontrack = e => _addDMRemoteStream(overlay, peerId, e.streams[0]);

    const candCol = collection(db, "calls", callId, `cand_${state.uid}_${peerId}`);
    pc.onicecandidate = e => {
      if (e.candidate) addDoc(candCol, e.candidate.toJSON()).catch(() => {});
    };

    await pc.setRemoteDescription(new RTCSessionDescription(offer)).catch(() => {});
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await setDoc(doc(db, "calls", callId, "answers", peerId), {
      from: state.uid, sdp: answer.sdp, type: answer.type,
    });

    const u2 = onSnapshot(
      query(collection(db, "calls", callId, `cand_${peerId}_${state.uid}`), orderBy("__name__")),
      snap => {
        snap.docChanges().filter(c => c.type === "added").forEach(c => {
          pc.addIceCandidate(new RTCIceCandidate(c.doc.data())).catch(() => {});
        });
      }
    );
    if (_activeCall) _activeCall.unsubs.push(u2);
  });
  if (_activeCall) _activeCall.unsubs.push(u0);
};

const _watchSpeaking = (stream, tileEl) => {
  try {
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const check = () => {
      if (!document.body.contains(tileEl)) { ctx.close(); return; }
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      tileEl.classList.toggle("speaking", avg > 12);
      requestAnimationFrame(check);
    };
    check();
  } catch {}
};

const _addDMRemoteStream = (overlay, peerId, stream) => {
  const grid = overlay.querySelector(".call-remote-grid");
  if (!grid || grid.querySelector(`[data-peer="${peerId}"]`)) return;
  overlay.querySelector(".call-status-wrap")?.remove();

  const peerEl = document.createElement("div");
  peerEl.className = "call-remote-peer";
  peerEl.dataset.peer = peerId;

  const hasVid = stream.getVideoTracks().length > 0;
  if (hasVid) {
    const vid = document.createElement("video");
    vid.autoplay = true; vid.playsInline = true; vid.srcObject = stream;
    vid.style.cssText = "width:100%;height:100%;object-fit:cover;border-radius:inherit;";
    peerEl.appendChild(vid);
  } else {
    const box = document.createElement("div");
    box.className = "call-audio-peer";
    peerEl.appendChild(box);
    fetchUser(peerId).then(u => {
      box.innerHTML = `<img class="avatar xl" src="${avatarFor(u)}" /><div class="call-peer-name">${u?.name || "User"}</div>`;
    });
  }

  const label = document.createElement("div");
  label.className = "call-tile-label";
  label.innerHTML = `<i class="ri-mic-line call-tile-mic"></i><span class="call-tile-name">…</span>`;
  fetchUser(peerId).then(u => {
    label.querySelector(".call-tile-name").textContent = (u?.name || "User").split(" ")[0];
  });
  peerEl.appendChild(label);
  _watchSpeaking(stream, peerEl);
  grid.appendChild(peerEl);
};

const _buildDMCallOverlay = ({ callId, localStream, type, role }) => {
  const overlay = document.createElement("div");
  overlay.className = "call-overlay";
  const hasVideo = type === "video";
  let muted = false, camOff = false;

  const startTime = Date.now();
  let timerInterval = null;

  overlay.innerHTML = `
    <div class="call-container">
      <div class="call-topbar">
        <div class="call-participant-count">1 participant</div>
        <div class="call-timer" id="callTimer">00:00</div>
        <div class="call-type-badge"><i class="ri-${hasVideo ? "vidicon" : "phone"}-fill"></i> ${hasVideo ? "Video" : "Voice"}</div>
      </div>
      <div class="call-remote-grid"></div>
      <div class="call-status-wrap">
        <div class="call-waiting-wrap">
          <img class="avatar xl call-waiting-av" src="${avatarFor(state.me)}" />
          <div class="call-ripple"></div>
        </div>
        <div class="call-status-text">${role === "caller" ? "Calling…" : "Connecting…"}</div>
      </div>
      ${hasVideo
        ? `<video id="callLocalVid" autoplay muted playsinline class="call-local-video"></video>`
        : `<div class="call-self-tile call-remote-peer">
             <div class="call-audio-peer">
               <img class="avatar xl" src="${avatarFor(state.me)}" />
               <div class="call-peer-name">${state.me?.name?.split(" ")[0] || "You"}</div>
             </div>
             <div class="call-tile-label">
               <i class="ri-mic-line call-tile-mic"></i>
               <span class="call-tile-name">You</span>
             </div>
           </div>`}
      <div class="call-controls">
        <div class="call-ctrl-group">
          <button class="call-ctrl" id="ccMute"><i class="ri-mic-line"></i></button>
          <span class="call-ctrl-label">Mute</span>
        </div>
        ${hasVideo ? `
        <div class="call-ctrl-group">
          <button class="call-ctrl" id="ccCam"><i class="ri-vidicon-line"></i></button>
          <span class="call-ctrl-label">Camera</span>
        </div>` : ""}
        <div class="call-ctrl-group">
          <button class="call-ctrl danger" id="ccEnd">
            <i class="ri-phone-fill" style="transform:rotate(135deg);"></i>
          </button>
          <span class="call-ctrl-label">End</span>
        </div>
      </div>
    </div>`;

  timerInterval = setInterval(() => {
    const s = Math.floor((Date.now() - startTime) / 1000);
    const el2 = overlay.querySelector("#callTimer");
    if (el2) el2.textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }, 1000);

  if (hasVideo) {
    const lv = overlay.querySelector("#callLocalVid");
    if (lv) lv.srcObject = localStream;
  }

  overlay.querySelector("#ccMute").onclick = () => {
    muted = !muted;
    localStream.getAudioTracks().forEach(t => { t.enabled = !muted; });
    const btn = overlay.querySelector("#ccMute");
    btn.querySelector("i").className = muted ? "ri-mic-off-line" : "ri-mic-line";
    btn.classList.toggle("active", muted);
    btn.closest(".call-ctrl-group").querySelector(".call-ctrl-label").textContent = muted ? "Unmute" : "Mute";
    overlay.querySelector(".call-self-tile .call-tile-mic")?.classList.toggle("muted", muted);
  };

  if (hasVideo) {
    overlay.querySelector("#ccCam").onclick = () => {
      camOff = !camOff;
      localStream.getVideoTracks().forEach(t => { t.enabled = !camOff; });
      const btn = overlay.querySelector("#ccCam");
      btn.querySelector("i").className = camOff ? "ri-vidicon-off-line" : "ri-vidicon-line";
      btn.classList.toggle("active", camOff);
      btn.closest(".call-ctrl-group").querySelector(".call-ctrl-label").textContent = camOff ? "Show cam" : "Camera";
    };
  }

  overlay.querySelector("#ccEnd").onclick = () => {
    clearInterval(timerInterval);
    _endDMCall(callId, overlay, localStream);
  };

  return overlay;
};

const _endDMCall = async (callId, overlay, localStream) => {
  localStream?.getTracks().forEach(t => t.stop());
  if (_activeCall) {
    Object.values(_activeCall.peers || {}).forEach(pc => { try { pc.close(); } catch {} });
    (_activeCall.unsubs || []).forEach(u => { try { u(); } catch {} });
    _activeCall = null;
  }
  overlay.remove();
  await updateDoc(doc(db, "calls", callId), { status: "ended" }).catch(() => {});
};

// =========================================================================
// Incoming call notification listener
// =========================================================================
const initCallListener = () => {
  onSnapshot(
    query(
      collection(db, "notifications", state.uid, "items"),
      where("type", "==", "call"),
      where("read", "==", false),
      limit(5)
    ),
    snap => {
      snap.docs.forEach(d => {
        const n = { id: d.id, ...d.data() };
        if (!n.callId) return;
        updateDoc(doc(db, "notifications", state.uid, "items", d.id), { read: true }).catch(() => {});
        _showIncomingBanner(n);
      });
    }
  );
};

const _showIncomingBanner = async (n) => {
  if (_activeCall) return;
  if (document.getElementById(`icb_${n.callId}`)) return;

  const callSnap = await getDoc(doc(db, "calls", n.callId)).catch(() => null);
  if (!callSnap?.exists()) return;
  const call = callSnap.data();
  if (!call.isGroup && call.status !== "ringing") return;
  if (call.status === "ended") return;

  const caller = await fetchUser(call.callerId).catch(() => null);
  const isGroup = !!call.isGroup;

  const banner = document.createElement("div");
  banner.className = "incoming-call-banner";
  banner.id = `icb_${n.callId}`;
  banner.innerHTML = `
    <img class="avatar md" src="${avatarFor(caller)}" alt="" />
    <div class="icb-info">
      <div class="icb-name">${caller?.name || n.fromName || "Someone"}</div>
      <div class="icb-type">Voice call${isGroup ? ` · ${call.groupName || "Group"}` : ""}</div>
    </div>
    <button class="call-ctrl danger" id="icbDecline_${n.callId}" title="Decline">
      <i class="ri-phone-fill" style="transform:rotate(135deg);"></i>
    </button>
    <button class="call-ctrl accept" id="icbAccept_${n.callId}" title="${isGroup ? "Join" : "Answer"}">
      <i class="ri-phone-fill"></i>
    </button>`;
  document.body.appendChild(banner);

  const dismiss = setTimeout(() => banner.remove(), 30000);

  banner.querySelector(`#icbDecline_${n.callId}`).onclick = () => {
    clearTimeout(dismiss); banner.remove();
    if (!isGroup) updateDoc(doc(db, "calls", n.callId), { status: "declined" }).catch(() => {});
  };

  banner.querySelector(`#icbAccept_${n.callId}`).onclick = async () => {
    clearTimeout(dismiss); banner.remove();
    await answerCall(n.callId);
  };

  if (!isGroup) {
    const u = onSnapshot(doc(db, "calls", n.callId), snap => {
      if (!snap.exists() || snap.data().status !== "ringing") {
        clearTimeout(dismiss); banner.remove(); u();
      }
    });
  }
};

// =========================================================================
// 4. INIT — fires once auth is ready
// =========================================================================
document.addEventListener("orbit:auth-ready", () => {
  initCallListener();

  const contentEl = document.getElementById("content") || document.body;
  const feedObserver = new MutationObserver(() => {
    const fw = contentEl.querySelector(".feed-wrap");
    if (fw && !fw.querySelector(".story-bar")) injectStoryBar(fw);
  });
  feedObserver.observe(contentEl, { childList: true, subtree: true });
});
