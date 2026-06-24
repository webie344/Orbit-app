// =========================================================================
// JC — additional.js  (v4 — no token server needed)
// Stories (24 hr), Notifications full-page view,
// Group Voice Calls via Agora (browser-side token generation),
// 1-on-1 Voice + Video Calls via WebRTC + TURN relay.
// =========================================================================

import {
  state, db, $, $$, el, fmtTime, toast, avatarFor, fetchUser,
  uploadToCloudinary, writeNotif,
} from "./app.js";

import {
  sfxCallEnd, sfxCallConnect, sfxNotification, sfxCallRing,
} from "./sounds.js";

import {
  doc, setDoc, getDoc, updateDoc, addDoc,
  collection, query, where, orderBy, limit, onSnapshot, getDocs,
  serverTimestamp, arrayUnion, arrayRemove, Timestamp,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

// =========================================================================
// GROUP CALL CONFIG
// WebRTC mesh — no third-party SDK or account required.
// Up to GROUP_CALL_MAX participants per call.
// =========================================================================
const GROUP_CALL_MAX = 20;

// =========================================================================
// 1. COMMUNITY BAR — shows user's joined communities as circular avatars
// =========================================================================

export const injectCommunityBar = (feedWrap) => {
  if (!feedWrap) return;

  // Remove any existing bar first (safe re-entrant guard)
  feedWrap.querySelector(".community-bar")?.remove();

  const bar = document.createElement("div");
  bar.className = "community-bar";

  // ── Insert SYNCHRONOUSLY so duplicate-check works on re-entrant calls ──
  const ref = feedWrap.querySelector(".feed-tab-bar") || feedWrap.firstChild;
  feedWrap.insertBefore(bar, ref);

  // "Browse" button — always first
  const findBtn = document.createElement("div");
  findBtn.className = "community-item";
  findBtn.innerHTML = `
    <div class="community-ring community-find">
      <i class="ri-community-line"></i>
    </div>
    <span class="community-name">Browse</span>`;
  findBtn.onclick = () => { location.hash = "#groups"; };
  bar.appendChild(findBtn);

  // Fetch joined groups and append — bar is already in the DOM
  getDocs(
    query(collection(db, "groups"), where("members", "array-contains", state.uid), limit(20))
  ).then((snap) => {
    snap.docs.forEach(d => {
      const g = { id: d.id, ...d.data() };
      const item = document.createElement("div");
      item.className = "community-item";
      const letter = (g.name || "?")[0].toUpperCase();
      item.innerHTML = `
        <div class="community-ring community-joined ${g.photoURL ? "has-photo" : ""}">
          ${g.photoURL
            ? `<img src="${g.photoURL}" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" />`
            : `<span class="community-letter">${letter}</span>`}
        </div>
        <span class="community-name">${(g.name || "Community").split(" ")[0]}</span>`;
      item.onclick = () => { location.hash = `#chats/${g.id}`; };
      bar.appendChild(item);
    });
  }).catch(console.error);
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
// GROUP calls  → Agora RTC, token generated in browser (no server needed)
// 1-on-1 calls → WebRTC P2P + TURN relay + Firebase signaling
// =========================================================================

let _activeCall = null;

// =========================================================================
// GROUP VOICE CALL  (WebRTC mesh — up to GROUP_CALL_MAX participants)
// Uses the same ICE / TURN servers as 1-on-1 calls.
// Firebase Firestore is used for signaling (offers, answers, ICE candidates).
// =========================================================================

// ICE servers shared by both group and 1-on-1 calls
const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "turn:openrelay.metered.ca:80",                username: "openrelayproject", credential: "openrelayproject" },
    { urls: "turn:openrelay.metered.ca:443",               username: "openrelayproject", credential: "openrelayproject" },
    { urls: "turn:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" },
  ],
};

export const startGroupVoiceCall = async ({ chatId, groupName = "Group" }) => {
  if (_activeCall) { toast("You're already in a call"); return; }

  const existing = await getDocs(
    query(collection(db, "calls"),
      where("chatId", "==", chatId),
      where("status", "==", "active"),
      where("isGroup", "==", true),
      limit(1))
  );

  let callId;
  if (!existing.empty) {
    const callData = existing.docs[0].data();
    if ((callData.participants || []).length >= GROUP_CALL_MAX) {
      toast(`Call is full — max ${GROUP_CALL_MAX} participants`);
      return;
    }
    callId = existing.docs[0].id;
    await updateDoc(doc(db, "calls", callId), { participants: arrayUnion(state.uid) }).catch(() => {});
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
        callId, chatId, groupName,
      }).catch(() => {});
    }
  }

  await _joinWebRTCGroupCall({ callId, groupName });
};

export const joinGroupVoiceCall = async ({ callId, chatId, groupName = "Group" }) => {
  if (_activeCall) { toast("Already in a call"); return; }
  const callSnap = await getDoc(doc(db, "calls", callId)).catch(() => null);
  if (!callSnap?.exists()) { toast("Call no longer available"); return; }
  const callData = callSnap.data();
  if ((callData.participants || []).length >= GROUP_CALL_MAX) {
    toast(`Call is full — max ${GROUP_CALL_MAX} participants`);
    return;
  }
  await updateDoc(doc(db, "calls", callId), { participants: arrayUnion(state.uid) }).catch(() => {});
  await _joinWebRTCGroupCall({ callId, groupName });
};

const _joinWebRTCGroupCall = async ({ callId, groupName }) => {
  let localStream;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch {
    toast("Microphone access denied — allow mic and try again");
    await updateDoc(doc(db, "calls", callId), { participants: arrayRemove(state.uid) }).catch(() => {});
    return;
  }

  const panel = _buildGroupCallPanel({ callId, groupName });
  document.body.appendChild(panel);
  requestAnimationFrame(() => panel.classList.add("vc-visible"));

  const peers  = {};   // peerId → RTCPeerConnection
  const unsubs = [];
  let muted      = false;
  let handRaised = false;

  _activeCall = { type: "group", callId, localStream, peers, unsubs, panel };
  _groupCallAddParticipant(panel, state.uid);

  // ── Build a peer connection to a remote participant ─────────────────────
  const _makePC = (peerId) => {
    if (peers[peerId] || peerId === state.uid) return null;
    const pc = new RTCPeerConnection(ICE_SERVERS);
    peers[peerId] = pc;
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

    pc.ontrack = (e) => {
      const stream = e.streams[0];
      if (!stream) return;
      // Re-use existing audio element if already attached
      const tile = panel.querySelector(`.vc-tile[data-uid="${peerId}"]`);
      let audio = tile?.querySelector("audio");
      if (!audio) {
        audio = document.createElement("audio");
        audio.autoplay = true;
        audio.setAttribute("playsinline", "");
        (tile || panel).appendChild(audio);
      }
      audio.srcObject = stream;
      _watchGroupSpeaking(stream, peerId, panel);
    };

    const iceCandCol = collection(db, "calls", callId, `gcand_${state.uid}_${peerId}`);
    pc.onicecandidate = e => {
      if (e.candidate) addDoc(iceCandCol, e.candidate.toJSON()).catch(() => {});
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
        _groupCallRemoveParticipant(panel, peerId);
        _groupCallUpdateCount(panel);
        try { pc.close(); } catch {}
        delete peers[peerId];
      }
    };

    // Listen for ICE candidates from the remote side
    const candUnsub = onSnapshot(
      query(collection(db, "calls", callId, `gcand_${peerId}_${state.uid}`), orderBy("__name__")),
      snap => {
        snap.docChanges().filter(c => c.type === "added").forEach(c => {
          pc.addIceCandidate(new RTCIceCandidate(c.doc.data())).catch(() => {});
        });
      }
    );
    unsubs.push(candUnsub);
    return pc;
  };

  // ── Send an offer to a participant (we are the later joiner) ───────────
  const _offerPeer = async (peerId) => {
    const pc = _makePC(peerId);
    if (!pc) return;
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await setDoc(doc(db, "calls", callId, "goffers", `${state.uid}_to_${peerId}`), {
      from: state.uid, to: peerId, sdp: offer.sdp, type: offer.type,
    });
    // Listen for the answer
    const ansUnsub = onSnapshot(doc(db, "calls", callId, "ganswers", `${peerId}_to_${state.uid}`), async snap => {
      if (!snap.exists() || pc.remoteDescription) return;
      const data = snap.data();
      if (data.from !== peerId) return;
      await pc.setRemoteDescription(new RTCSessionDescription(data)).catch(() => {});
    });
    unsubs.push(ansUnsub);
  };

  // ── Listen for offers addressed to us and answer them ─────────────────
  const offerUnsub = onSnapshot(
    query(collection(db, "calls", callId, "goffers"), where("to", "==", state.uid)),
    async (snap) => {
      snap.docChanges().filter(c => c.type === "added").forEach(async (change) => {
        const offer = change.doc.data();
        const peerId = offer.from;
        if (!peerId || peerId === state.uid) return;

        const pc = _makePC(peerId);
        if (!pc) return; // already connected

        _groupCallAddParticipant(panel, peerId);

        await pc.setRemoteDescription(new RTCSessionDescription(offer)).catch(() => {});
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await setDoc(doc(db, "calls", callId, "ganswers", `${state.uid}_to_${peerId}`), {
          from: state.uid, to: peerId, sdp: answer.sdp, type: answer.type,
        });
      });
    }
  );
  unsubs.push(offerUnsub);

  // ── Watch the call document for participant list / status changes ───────
  const callUnsub = onSnapshot(doc(db, "calls", callId), async (snap) => {
    if (!snap.exists() || snap.data().status === "ended") {
      await _leaveGroupCall();
      return;
    }
    const data = snap.data();
    const currentParticipants = data.participants || [];

    // Offer to any participant who joined before us (they wait for our offer)
    for (const peerId of currentParticipants) {
      if (peerId !== state.uid && !peers[peerId]) {
        _groupCallAddParticipant(panel, peerId);
        await _offerPeer(peerId);
      }
    }

    // Remove tiles for participants who left
    panel.querySelectorAll(".vc-tile").forEach(tile => {
      const uid = tile.dataset.uid;
      if (uid && uid !== state.uid && !currentParticipants.includes(uid)) {
        _groupCallRemoveParticipant(panel, uid);
        if (peers[uid]) { try { peers[uid].close(); } catch {} delete peers[uid]; }
      }
    });

    _groupCallSyncParticipants(panel, currentParticipants);
    _groupCallSyncRaisedHands(panel, data.raisedHands || []);
  });
  unsubs.push(callUnsub);

  // ── Leave handler ───────────────────────────────────────────────────────
  const _leaveGroupCall = async () => {
    if (!_activeCall) return;
    const ac = _activeCall;
    _activeCall = null;
    ac.unsubs?.forEach(u => { try { u(); } catch {} });
    Object.values(ac.peers || {}).forEach(pc => { try { pc.close(); } catch {} });
    ac.localStream?.getTracks().forEach(t => t.stop());
    await updateDoc(doc(db, "calls", ac.callId), {
      participants: arrayRemove(state.uid),
      raisedHands:  arrayRemove(state.uid),
    }).catch(() => {});
    const snap = await getDoc(doc(db, "calls", ac.callId)).catch(() => null);
    if (snap?.exists() && (snap.data().participants || []).filter(u => u !== state.uid).length === 0) {
      await updateDoc(doc(db, "calls", ac.callId), { status: "ended" }).catch(() => {});
    }
    ac.panel.classList.remove("vc-visible");
    setTimeout(() => ac.panel.remove(), 380);
    sfxCallEnd();
    toast("Left the call");
  };

  // ── Panel controls ──────────────────────────────────────────────────────
  panel.querySelector("#vcMute").addEventListener("click", () => {
    muted = !muted;
    localStream.getAudioTracks().forEach(t => { t.enabled = !muted; });
    const btn = panel.querySelector("#vcMute");
    btn.querySelector("i").className = muted ? "ri-mic-off-fill" : "ri-mic-fill";
    btn.classList.toggle("vc-btn-active", muted);
    // label is a sibling <span> outside the button — go up to .vc-ctrl-col first
    btn.closest(".vc-ctrl-col").querySelector(".vc-btn-label").textContent = muted ? "Unmute" : "Mute";
    panel.querySelector(`.vc-tile[data-uid="${state.uid}"]`)?.classList.toggle("vc-muted", muted);
  });

  panel.querySelector("#vcHand").addEventListener("click", async () => {
    handRaised = !handRaised;
    const btn = panel.querySelector("#vcHand");
    btn.classList.toggle("vc-btn-active", handRaised);
    btn.querySelector("i").className = handRaised ? "ri-hand-coin-fill" : "ri-hand-coin-line";
    // label is a sibling <span> outside the button — go up to .vc-ctrl-col first
    btn.closest(".vc-ctrl-col").querySelector(".vc-btn-label").textContent = handRaised ? "Lower hand" : "Raise hand";
    await updateDoc(doc(db, "calls", callId), {
      raisedHands: handRaised ? arrayUnion(state.uid) : arrayRemove(state.uid),
    }).catch(() => {});
    if (handRaised) toast("✋ Hand raised — the host can see this");
  });

  panel.querySelector("#vcLeave").addEventListener("click", () => _leaveGroupCall());

  panel.querySelector("#vcMinimise").addEventListener("click", () => {
    panel.classList.toggle("vc-minimised");
    panel.querySelector("#vcMinimise i").className =
      panel.classList.contains("vc-minimised") ? "ri-arrow-up-s-line" : "ri-arrow-down-s-line";
  });
};

// ── Speaking indicator for group call participants ─────────────────────────
const _watchGroupSpeaking = (stream, uid, panel) => {
  try {
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const check = () => {
      const tile = panel.querySelector(`.vc-tile[data-uid="${uid}"]`);
      if (!tile || !document.body.contains(panel)) { ctx.close(); return; }
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      tile.classList.toggle("vc-speaking", avg > 8);
      requestAnimationFrame(check);
    };
    check();
  } catch {}
};

// ── Inject group-call CSS once ─────────────────────────────────────────────
let _vcStylesReady = false;
const _injectVCStyles = () => {
  if (_vcStylesReady) return;
  _vcStylesReady = true;
  const s = document.createElement("style");
  s.textContent = `
    /* ── Group voice-call panel ───────────────────────────────────────── */
    .vc-panel {
      position: fixed;
      bottom: 0; left: 0; right: 0;
      max-height: 65vh;
      background: var(--bg-elev, #1e1e2e);
      border-top: 1px solid var(--line, rgba(255,255,255,.12));
      border-radius: 20px 20px 0 0;
      box-shadow: 0 -8px 40px rgba(0,0,0,.45);
      z-index: 4000;
      display: flex;
      flex-direction: column;
      transform: translateY(100%);
      transition: transform .32s cubic-bezier(.32,1,.32,1);
      overflow: hidden;
    }
    .vc-panel.vc-visible { transform: translateY(0); }
    .vc-panel.vc-minimised { max-height: 72px; }
    .vc-handle-bar {
      width: 36px; height: 4px;
      background: var(--line, rgba(255,255,255,.2));
      border-radius: 4px;
      margin: 10px auto 0;
      flex-shrink: 0;
    }
    .vc-header {
      display: flex; align-items: center;
      padding: 10px 16px 8px;
      flex-shrink: 0;
    }
    .vc-header-left { flex: 1; min-width: 0; }
    .vc-title {
      display: flex; align-items: center; gap: 6px;
      font-weight: 700; font-size: 15px;
      color: var(--text, #fff);
    }
    .vc-subtitle {
      display: flex; align-items: center; gap: 6px;
      font-size: 12px; color: var(--text-mute, rgba(255,255,255,.55));
      margin-top: 2px;
    }
    .vc-dot-sep { opacity: .5; }
    .vc-header-right { display: flex; gap: 4px; }
    .vc-icon-btn {
      width: 32px; height: 32px; border-radius: 50%;
      display: grid; place-items: center;
      background: none; border: none; cursor: pointer;
      color: var(--text-mute, rgba(255,255,255,.55));
      font-size: 18px;
      transition: background .15s;
    }
    .vc-icon-btn:hover { background: rgba(255,255,255,.08); }
    .vc-hands-queue {
      display: flex; align-items: center; gap: 8px;
      padding: 6px 16px;
      background: rgba(246,201,14,.1);
      font-size: 13px; color: #f6c90e;
      flex-shrink: 0;
    }
    .vc-hands-queue.hidden { display: none !important; }
    .vc-participants {
      display: flex; flex-wrap: wrap; gap: 10px;
      padding: 12px 16px;
      overflow-y: auto;
      flex: 1;
    }
    .vc-tile {
      display: flex; flex-direction: column; align-items: center; gap: 4px;
      width: 72px;
    }
    .vc-av-wrap { position: relative; width: 56px; height: 56px; }
    .vc-av {
      width: 56px; height: 56px; border-radius: 50%;
      object-fit: cover;
      border: 2px solid rgba(255,255,255,.15);
    }
    .vc-speaking-ring {
      position: absolute; inset: -3px; border-radius: 50%;
      border: 2.5px solid transparent;
      pointer-events: none;
      transition: border-color .15s, box-shadow .15s;
    }
    .vc-tile.vc-speaking .vc-speaking-ring {
      border-color: #4ade80;
      box-shadow: 0 0 10px rgba(74,222,128,.5);
    }
    .vc-hand-badge {
      position: absolute; top: -2px; right: -2px;
      font-size: 14px; line-height: 1;
    }
    .vc-hand-badge.hidden { display: none !important; }
    .vc-tile-name {
      font-size: 11px; color: var(--text-mute, rgba(255,255,255,.6));
      text-align: center; max-width: 72px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .vc-tile-mic { font-size: 12px; color: var(--text-mute, rgba(255,255,255,.4)); }
    .vc-tile.vc-muted .vc-tile-mic { color: #f87171; }
    .vc-controls {
      display: flex; justify-content: center; gap: 24px;
      padding: 12px 16px 22px;
      border-top: 1px solid var(--line, rgba(255,255,255,.1));
      flex-shrink: 0;
    }
    .vc-ctrl-col { display: flex; flex-direction: column; align-items: center; gap: 5px; }
    .vc-ctrl-btn {
      width: 52px; height: 52px; border-radius: 50%;
      background: rgba(255,255,255,.1); border: none; cursor: pointer;
      color: #fff; font-size: 22px;
      display: grid; place-items: center;
      transition: background .15s, transform .1s;
    }
    .vc-ctrl-btn:active { transform: scale(.93); }
    .vc-ctrl-btn.vc-btn-active { background: rgba(255,255,255,.28); }
    .vc-ctrl-btn.vc-leave-btn { background: #ef4444; }
    .vc-ctrl-btn.vc-leave-btn:hover { background: #dc2626; }
    .vc-btn-label { font-size: 11px; color: var(--text-mute, rgba(255,255,255,.55)); }
  `;
  document.head.appendChild(s);
};

// ── Panel builder ─────────────────────────────────────────────────────────
const _buildGroupCallPanel = ({ groupName }) => {
  _injectVCStyles();
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
    <div class="vc-hands-queue hidden" id="vcHandsQueue">
      <i class="ri-hand-coin-fill" style="color:#f6c90e;"></i>
      <span class="vc-hands-text" id="vcHandsText"></span>
    </div>
    <div class="vc-participants" id="vcParticipants"></div>
    <div class="vc-controls">
      <div class="vc-ctrl-col">
        <button class="vc-ctrl-btn" id="vcMute"><i class="ri-mic-fill"></i></button>
        <span class="vc-btn-label">Mute</span>
      </div>
      <div class="vc-ctrl-col">
        <button class="vc-ctrl-btn" id="vcHand" title="Raise hand"><i class="ri-hand-coin-line"></i></button>
        <span class="vc-btn-label">Raise hand</span>
      </div>
      <div class="vc-ctrl-col">
        <button class="vc-ctrl-btn vc-leave-btn" id="vcLeave">
          <i class="ri-phone-fill" style="transform:rotate(135deg);display:inline-block;"></i>
        </button>
        <span class="vc-btn-label">Leave</span>
      </div>
    </div>`;

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

const _groupCallSyncRaisedHands = async (panel, raisedUids) => {
  panel.querySelectorAll(".vc-tile").forEach(tile => {
    const badge = tile.querySelector(".vc-hand-badge");
    if (!badge) return;
    const hasHand = raisedUids.includes(tile.dataset.uid);
    badge.classList.toggle("hidden", !hasHand);
    tile.classList.toggle("vc-hand-raised", hasHand);
  });
  const queue = panel.querySelector("#vcHandsQueue");
  const queueText = panel.querySelector("#vcHandsText");
  if (!queue || !queueText) return;
  if (raisedUids.length === 0) { queue.classList.add("hidden"); return; }
  queue.classList.remove("hidden");
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
// 1-ON-1 VOICE + VIDEO CALLS  (WebRTC + TURN relay)
// TURN servers added so calls work through firewalls and mobile networks.
// =========================================================================

// ICE_SERVERS defined above in the group call section

export const startCall = async ({ peerId, chatId, isGroup, type = "voice" }) => {
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

  _connectPeer({ callId, localStream, peerId, overlay });

  // Watch for decline / hang-up from the other side
  const statusUnsub = onSnapshot(doc(db, "calls", callId), snap => {
    if (!snap.exists()) return;
    const status = snap.data().status;
    if (status === "declined") { toast("Call declined"); _endDMCall(callId, overlay, localStream); statusUnsub(); }
    else if (status === "ended") { _endDMCall(callId, overlay, localStream); statusUnsub(); }
  });
  if (_activeCall) _activeCall.unsubs.push(statusUnsub);
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
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed") toast("Connection failed — check your internet connection");
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

  if (_activeCall) _activeCall.unsubs.push(u1, u2);
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
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") toast("Connection failed — check your internet connection");
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
    // Audio-only: MUST create an <audio> element so the remote stream is heard
    const aud = document.createElement("audio");
    aud.autoplay = true;
    aud.srcObject = stream;
    peerEl.appendChild(aud);

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
  sfxCallConnect();
};

const _injectDMCallStyles = (() => {
  let _done = false;
  return () => {
    if (_done) return; _done = true;
    const s = document.createElement("style");
    s.textContent = `
/* ── DM Call overlay ───────────────────────────────────────────────────── */
.call-overlay{position:fixed;inset:0;z-index:9000;display:flex;align-items:center;
  justify-content:center;background:rgba(0,0,0,.88);backdrop-filter:blur(8px);
  animation:coFadeIn .25s ease;}
@keyframes coFadeIn{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}
.call-overlay-exit{animation:coFadeOut .3s ease forwards!important}
@keyframes coFadeOut{to{opacity:0;transform:scale(.94)}}
.call-container{position:relative;width:min(520px,96vw);max-height:92vh;
  display:flex;flex-direction:column;align-items:center;gap:12px;padding:20px 16px 16px;
  background:linear-gradient(160deg,#1a1a2e 0%,#16213e 100%);
  border-radius:24px;border:1px solid rgba(255,255,255,.08);overflow:hidden;}
.call-topbar{width:100%;display:flex;align-items:center;justify-content:space-between;
  font-size:13px;color:rgba(255,255,255,.5);}
.call-timer{font-size:15px;font-weight:600;color:#fff;letter-spacing:.05em;}
.call-type-badge{display:flex;align-items:center;gap:5px;
  background:rgba(255,255,255,.08);padding:3px 10px;border-radius:20px;font-size:12px;}
.call-remote-grid{width:100%;display:flex;flex-wrap:wrap;gap:10px;
  justify-content:center;min-height:0;}
.call-remote-peer{position:relative;width:220px;height:180px;flex:1 1 180px;
  background:rgba(255,255,255,.06);border-radius:16px;overflow:hidden;
  display:flex;align-items:center;justify-content:center;}
.call-self-tile{position:relative;width:220px;height:180px;flex:1 1 180px;
  background:rgba(255,255,255,.06);border-radius:16px;overflow:hidden;
  display:flex;align-items:center;justify-content:center;}
.call-audio-peer{display:flex;flex-direction:column;align-items:center;gap:10px;padding:12px;}
.call-audio-peer .avatar{width:72px;height:72px;border-radius:50%;object-fit:cover;
  border:2px solid rgba(255,255,255,.2);}
.call-peer-name{font-size:14px;font-weight:500;color:#fff;text-align:center;}
.call-tile-label{position:absolute;bottom:8px;left:50%;transform:translateX(-50%);
  display:flex;align-items:center;gap:4px;background:rgba(0,0,0,.55);
  padding:3px 10px;border-radius:20px;white-space:nowrap;}
.call-tile-mic{font-size:12px;color:rgba(255,255,255,.7);}
.call-tile-mic.muted{color:#f87171;}
.call-tile-name{font-size:12px;color:rgba(255,255,255,.85);}
.call-status-wrap{display:flex;flex-direction:column;align-items:center;gap:14px;
  padding:24px 0;}
.call-waiting-wrap{position:relative;width:90px;height:90px;
  display:flex;align-items:center;justify-content:center;}
.call-waiting-av{width:80px;height:80px;border-radius:50%;object-fit:cover;
  position:relative;z-index:1;border:3px solid rgba(255,255,255,.25);}
.call-ripple{position:absolute;inset:-10px;border-radius:50%;
  border:2px solid rgba(99,179,237,.5);animation:ripple 1.8s ease-out infinite;}
@keyframes ripple{0%{transform:scale(1);opacity:.7}100%{transform:scale(1.9);opacity:0}}
.call-status-text{font-size:15px;color:rgba(255,255,255,.6);letter-spacing:.03em;}
.call-local-video{width:110px;height:80px;border-radius:12px;object-fit:cover;
  border:2px solid rgba(255,255,255,.15);position:absolute;bottom:72px;right:18px;}
.call-controls{display:flex;align-items:center;gap:14px;padding:8px 0 4px;width:100%;
  justify-content:center;}
.call-ctrl-group{display:flex;flex-direction:column;align-items:center;gap:5px;}
.call-ctrl{width:52px;height:52px;border-radius:50%;border:none;cursor:pointer;
  display:flex;align-items:center;justify-content:center;font-size:20px;
  background:rgba(255,255,255,.12);color:#fff;transition:background .2s,transform .15s;}
.call-ctrl:hover{background:rgba(255,255,255,.22);transform:scale(1.08);}
.call-ctrl.active{background:rgba(99,179,237,.3);color:#63b3ed;}
.call-ctrl.danger{background:#dc2626;color:#fff;}
.call-ctrl.danger:hover{background:#b91c1c;}
.call-ctrl.accept{background:#16a34a;color:#fff;}
.call-ctrl.accept:hover{background:#15803d;}
.call-ctrl-label{font-size:11px;color:rgba(255,255,255,.55);white-space:nowrap;}
/* ── Incoming call banner ───────────────────────────────────────────────── */
.incoming-call-banner{position:fixed;top:16px;right:16px;z-index:9100;
  display:flex;align-items:center;gap:12px;padding:14px 16px;
  background:linear-gradient(135deg,#1e293b,#0f172a);
  border:1px solid rgba(255,255,255,.12);border-radius:18px;
  box-shadow:0 8px 32px rgba(0,0,0,.5);
  animation:bannerSlide .3s cubic-bezier(.32,1,.32,1);}
@keyframes bannerSlide{from{opacity:0;transform:translateY(-20px)}to{opacity:1;transform:translateY(0)}}
.incoming-call-banner .avatar{width:44px;height:44px;border-radius:50%;object-fit:cover;flex-shrink:0;}
.icb-info{flex:1;min-width:0;}
.icb-name{font-size:14px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.icb-type{font-size:12px;color:rgba(255,255,255,.5);margin-top:2px;}
`.trim();
    document.head.appendChild(s);
  };
})();

const _buildDMCallOverlay = ({ callId, localStream, type, role }) => {
  _injectDMCallStyles();
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
  sfxCallEnd();
  overlay.classList.add("call-overlay-exit");
  setTimeout(() => overlay.remove(), 320);
  await updateDoc(doc(db, "calls", callId), { status: "ended" }).catch(() => {});
};

// =========================================================================
// Incoming call listener
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

  sfxNotification();
  const _stopRing = sfxCallRing();

  const banner = document.createElement("div");
  banner.className = "incoming-call-banner";
  banner.id = `icb_${n.callId}`;
  banner.innerHTML = `
    <img class="avatar md" src="${avatarFor(caller)}" alt="" />
    <div class="icb-info">
      <div class="icb-name">${caller?.name || n.fromName || "Someone"}</div>
      <div class="icb-type">${isGroup ? "Voice" : (call.type === "video" ? "Video" : "Voice")} call${isGroup ? ` · ${call.groupName || "Group"}` : ""}</div>
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
    _stopRing(); clearTimeout(dismiss); banner.remove();
    if (!isGroup) updateDoc(doc(db, "calls", n.callId), { status: "declined" }).catch(() => {});
  };

  banner.querySelector(`#icbAccept_${n.callId}`).onclick = async () => {
    _stopRing(); clearTimeout(dismiss); banner.remove();
    await answerCall(n.callId);
  };

  if (!isGroup) {
    const u = onSnapshot(doc(db, "calls", n.callId), snap => {
      if (!snap.exists() || snap.data().status !== "ringing") {
        _stopRing(); clearTimeout(dismiss); banner.remove(); u();
      }
    });
  }
};

// =========================================================================
// TIKTOK-STYLE TOAST NOTIFICATION POPUP
// =========================================================================
const _injectToastNotifStyles = (() => {
  let _done = false;
  return () => {
    if (_done) return; _done = true;
    const s = document.createElement("style");
    s.textContent = `
.orbit-toast-stack{position:fixed;top:0;left:50%;transform:translateX(-50%);
  z-index:9500;display:flex;flex-direction:column;align-items:center;
  gap:8px;padding-top:12px;pointer-events:none;width:min(420px,96vw);}
.orbit-toast{pointer-events:all;display:flex;align-items:center;gap:12px;
  padding:12px 16px;border-radius:20px;cursor:pointer;
  background:rgba(15,15,25,.92);backdrop-filter:blur(16px) saturate(1.6);
  border:1px solid rgba(255,255,255,.1);
  box-shadow:0 8px 32px rgba(0,0,0,.45),0 2px 8px rgba(0,0,0,.3);
  width:100%;max-width:420px;box-sizing:border-box;
  transform:translateY(-110%);opacity:0;
  transition:transform .38s cubic-bezier(.32,1,.32,1),opacity .28s ease;}
.orbit-toast.orbit-toast-in{transform:translateY(0);opacity:1;}
.orbit-toast.orbit-toast-out{transform:translateY(-115%);opacity:0;
  transition:transform .3s cubic-bezier(.6,0,.4,1),opacity .22s ease;}
.orbit-toast-av{width:42px;height:42px;border-radius:50%;object-fit:cover;
  flex-shrink:0;border:2px solid rgba(255,255,255,.15);}
.orbit-toast-av-icon{width:42px;height:42px;border-radius:50%;flex-shrink:0;
  background:linear-gradient(135deg,#7c5cff,#ff5cae);
  display:flex;align-items:center;justify-content:center;font-size:20px;}
.orbit-toast-body{flex:1;min-width:0;}
.orbit-toast-name{font-size:13px;font-weight:700;color:#fff;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.orbit-toast-msg{font-size:13px;color:rgba(255,255,255,.65);margin-top:2px;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.orbit-toast-app{font-size:11px;color:rgba(255,255,255,.35);margin-bottom:2px;
  text-transform:uppercase;letter-spacing:.06em;}
.orbit-toast-close{background:none;border:none;color:rgba(255,255,255,.4);
  font-size:18px;cursor:pointer;padding:4px;flex-shrink:0;line-height:1;}
.orbit-toast-close:hover{color:rgba(255,255,255,.8);}
.orbit-toast-progress{position:absolute;bottom:0;left:0;height:2px;
  border-radius:0 0 20px 20px;background:var(--primary,#7c5cff);
  animation:toastProgress var(--tp-dur,4s) linear forwards;}
@keyframes toastProgress{from{width:100%}to{width:0%}}
    `.trim();
    document.head.appendChild(s);
  };
})();

let _toastStack = null;
const _getToastStack = () => {
  if (!_toastStack || !document.body.contains(_toastStack)) {
    _toastStack = document.createElement("div");
    _toastStack.className = "orbit-toast-stack";
    document.body.appendChild(_toastStack);
  }
  return _toastStack;
};

export const showToastNotif = ({ avatar, icon, name, app = "JC", body, href, duration = 4000 }) => {
  _injectToastNotifStyles();
  const stack = _getToastStack();

  const wrap = document.createElement("div");
  wrap.className = "orbit-toast";
  wrap.style.setProperty("--tp-dur", duration + "ms");
  wrap.style.position = "relative";
  wrap.style.overflow = "hidden";

  const avEl = avatar
    ? Object.assign(document.createElement("img"), { className: "orbit-toast-av", src: avatar, alt: "" })
    : Object.assign(document.createElement("div"), { className: "orbit-toast-av-icon", textContent: icon || "🔔" });

  const bodyEl = document.createElement("div");
  bodyEl.className = "orbit-toast-body";
  bodyEl.innerHTML = `
    <div class="orbit-toast-app">${app}</div>
    <div class="orbit-toast-name">${name || ""}</div>
    <div class="orbit-toast-msg">${body || ""}</div>
  `;

  const closeBtn = document.createElement("button");
  closeBtn.className = "orbit-toast-close";
  closeBtn.innerHTML = '<i class="ri-close-line"></i>';

  const progress = document.createElement("div");
  progress.className = "orbit-toast-progress";

  wrap.appendChild(avEl);
  wrap.appendChild(bodyEl);
  wrap.appendChild(closeBtn);
  wrap.appendChild(progress);
  stack.appendChild(wrap);

  // Slide in
  requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.add("orbit-toast-in")));

  const dismiss = () => {
    wrap.classList.add("orbit-toast-out");
    wrap.classList.remove("orbit-toast-in");
    setTimeout(() => wrap.remove(), 350);
  };

  const timer = setTimeout(dismiss, duration);

  closeBtn.onclick = (e) => { e.stopPropagation(); clearTimeout(timer); dismiss(); };

  if (href) {
    wrap.onclick = () => { clearTimeout(timer); dismiss(); location.hash = href; };
    wrap.style.cursor = "pointer";
  }
};

// General notification listener — shows toast for messages, orbits, comments
const _initToastListener = () => {
  // Firebase functions are already imported at the top of this file
  onSnapshot(
    query(
      collection(db, "notifications", state.uid, "items"),
      where("read", "==", false),
      limit(10),
    ),
    async snap => {
      for (const change of snap.docChanges()) {
        if (change.type !== "added") continue;
        const n = { id: change.doc.id, ...change.doc.data() };
        if (n.type === "call") continue; // handled separately in initCallListener

        // Mark read so it doesn't re-fire on next load
        updateDoc(doc(db, "notifications", state.uid, "items", n.id), { read: true }).catch(() => {});

        let avatar = null, name = "JC", body = n.text || "", href = "";
        try {
          if (n.fromUid || n.fromName) {
            const sender = n.fromUid ? await fetchUser(n.fromUid) : null;
            avatar = sender ? avatarFor(sender) : null;
            name = sender?.name || n.fromName || "Someone";
          }
          if (n.type === "message") {
            href = "chats";
            body = n.text || "Sent you a message";
          } else if (n.type === "orbit") {
            href = n.postId ? `post/${n.postId}` : "";
            body = body || "reacted to your post 🔥";
          } else if (n.type === "comment") {
            href = n.postId ? `post/${n.postId}` : "";
            body = body || "Commented on your post";
          } else if (n.type === "follow") {
            href = n.fromUid ? `profile/${n.fromUid}` : "";
            body = body || "Started following you";
          }
        } catch {}

        showToastNotif({ avatar, name, body, href, app: "JC" });
      }
    }
  );
};

// =========================================================================

// =========================================================================
// GROUP INFO PANEL — WhatsApp-style full-screen group profile
// Admin can edit group name, description, and group photo.
// =========================================================================

let _giStylesReady = false;
const _injectGroupInfoStyles = () => {
  if (_giStylesReady) return;
  _giStylesReady = true;
  const s = document.createElement("style");
  s.textContent = `
/* ── Group Info overlay ────────────────────────────────────────────────── */
.gi-overlay {
  position: fixed; inset: 0; z-index: 3000;
  background: var(--bg, #0f0f1a);
  display: flex; flex-direction: column;
  transform: translateX(100%);
  transition: transform .32s cubic-bezier(.32,1,.32,1);
  overflow-y: auto;
}
.gi-overlay.gi-open { transform: translateX(0); }

.gi-topbar {
  display: flex; align-items: center; gap: 12px;
  padding: 14px 16px 10px;
  position: sticky; top: 0; z-index: 10;
  background: var(--bg2, #1a1a2e);
  border-bottom: 1px solid var(--border, rgba(255,255,255,.07));
  flex-shrink: 0;
}
.gi-topbar-title { flex: 1; font-weight: 700; font-size: 17px; color: var(--text); }

.gi-avatar-wrap {
  display: flex; justify-content: center; align-items: center;
  padding: 28px 16px 14px;
  position: relative; flex-direction: column; gap: 10px;
  background: linear-gradient(180deg, var(--bg2, #1a1a2e) 0%, transparent 100%);
}
.gi-avatar {
  width: 100px; height: 100px; border-radius: 50%;
  object-fit: cover;
  border: 3px solid var(--primary, #6c63ff);
  box-shadow: 0 4px 24px rgba(108,99,255,.35);
}
.gi-cam-btn {
  position: absolute; bottom: 18px; right: calc(50% - 58px);
  width: 32px; height: 32px; border-radius: 50%;
  background: var(--primary, #6c63ff);
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 16px; cursor: pointer;
  box-shadow: 0 2px 8px rgba(0,0,0,.4);
  transition: opacity .15s;
}
.gi-cam-btn:hover { opacity: .85; }

.gi-name {
  text-align: center; font-size: 22px; font-weight: 800;
  color: var(--text); padding: 0 20px 4px;
}
.gi-desc {
  text-align: center; font-size: 14px;
  color: var(--text-mute, rgba(255,255,255,.55));
  padding: 0 24px 18px; line-height: 1.5; min-height: 20px;
}

.gi-meta {
  display: flex; flex-direction: column; gap: 0;
  background: var(--bg2, #1a1a2e);
  border-top: 1px solid var(--border, rgba(255,255,255,.07));
  border-bottom: 1px solid var(--border, rgba(255,255,255,.07));
}
.gi-meta-item {
  display: flex; align-items: center; gap: 14px;
  padding: 14px 20px; font-size: 14px;
  color: var(--text-mute, rgba(255,255,255,.6));
  border-bottom: 1px solid var(--border, rgba(255,255,255,.05));
}
.gi-meta-item:last-child { border-bottom: none; }
.gi-meta-item i { font-size: 18px; color: var(--primary, #6c63ff); flex-shrink: 0; }

.gi-section {
  margin-top: 12px; background: var(--bg2, #1a1a2e);
  border-top: 1px solid var(--border, rgba(255,255,255,.07));
  border-bottom: 1px solid var(--border, rgba(255,255,255,.07));
}
.gi-section-title {
  display: flex; align-items: center; gap: 8px;
  padding: 14px 20px 8px; font-size: 12px; font-weight: 700;
  letter-spacing: .6px; text-transform: uppercase;
  color: var(--primary, #6c63ff);
}

.gi-members { display: flex; flex-direction: column; }
.gi-member-row {
  display: flex; align-items: center; gap: 12px;
  padding: 11px 20px; cursor: pointer;
  border-bottom: 1px solid var(--border, rgba(255,255,255,.05));
  transition: background .15s;
}
.gi-member-row:last-child { border-bottom: none; }
.gi-member-row:hover { background: rgba(255,255,255,.04); }
.gi-member-info { flex: 1; min-width: 0; }
.gi-member-name {
  font-size: 14px; font-weight: 600; color: var(--text);
  display: flex; align-items: center; gap: 6px;
}
.gi-member-sub { font-size: 12px; color: var(--text-mute, rgba(255,255,255,.5)); margin-top: 2px; }
.gi-badge {
  font-size: 10px; font-weight: 700; padding: 2px 7px;
  border-radius: 20px; letter-spacing: .4px;
}
.gi-badge.admin {
  background: rgba(108,99,255,.18); color: var(--primary, #6c63ff);
  border: 1px solid rgba(108,99,255,.3);
}
.gi-member-menu-btn { width: 32px; height: 32px; flex-shrink: 0; color: var(--text-mute, rgba(255,255,255,.4)); }

.gi-edit-overlay {
  position: fixed; inset: 0; z-index: 4000;
  background: rgba(0,0,0,.6);
  display: flex; align-items: flex-end; justify-content: center;
}
.gi-edit-sheet {
  background: var(--bg2, #1a1a2e); border-radius: 20px 20px 0 0;
  padding: 20px 18px 36px; width: 100%; max-width: 480px;
  transform: translateY(100%);
  transition: transform .3s cubic-bezier(.32,1,.32,1);
}
.gi-edit-sheet.open { transform: translateY(0); }
.gi-edit-label {
  font-size: 11px; font-weight: 700; letter-spacing: .6px;
  text-transform: uppercase; color: var(--text-mute); margin: 14px 0 6px;
}
.gi-edit-input {
  width: 100%; padding: 11px 14px;
  border: 1px solid var(--border, rgba(255,255,255,.12));
  border-radius: 12px; background: var(--bg3, #2a2a3a);
  color: var(--text); font-size: 14px; outline: none; box-sizing: border-box;
}
.gi-edit-input:focus { border-color: var(--primary, #6c63ff); }
textarea.gi-edit-input { resize: none; min-height: 80px; line-height: 1.5; }

.gi-danger { margin: 12px 0 32px; padding: 4px 0; }
.gi-danger-btn {
  display: flex; align-items: center; justify-content: center;
  gap: 8px; width: calc(100% - 40px); margin: 8px 20px;
  padding: 13px; border-radius: 14px; font-size: 15px; font-weight: 600;
  background: rgba(239,68,68,.12); color: #ef4444;
  border: 1px solid rgba(239,68,68,.25); cursor: pointer; transition: background .15s;
}
.gi-danger-btn:hover { background: rgba(239,68,68,.22); }

.gi-member-action-overlay {
  position: fixed; inset: 0; z-index: 5000;
  background: rgba(0,0,0,.55);
  display: flex; align-items: flex-end; justify-content: center;
}
.gi-member-action-sheet {
  background: var(--bg2, #1a1a2e); border-radius: 20px 20px 0 0;
  width: 100%; max-width: 480px; padding: 10px 0 28px;
  transform: translateY(100%);
  transition: transform .28s cubic-bezier(.32,1,.32,1);
}
.gi-member-action-sheet.open { transform: translateY(0); }
.gi-maction-header {
  display: flex; align-items: center; gap: 12px;
  padding: 14px 18px 10px;
  border-bottom: 1px solid var(--border, rgba(255,255,255,.07));
}
.gi-maction-name { font-weight: 700; font-size: 15px; flex: 1; color: var(--text); }
.gi-maction-row {
  display: flex; align-items: center; gap: 14px;
  padding: 14px 20px; font-size: 15px; color: var(--text);
  cursor: pointer; transition: background .15s;
}
.gi-maction-row:hover { background: rgba(255,255,255,.05); }
.gi-maction-row i { font-size: 20px; color: var(--text-mute); }
.gi-maction-row.danger { color: #ef4444; }
.gi-maction-row.danger i { color: #ef4444; }
  `;
  document.head.appendChild(s);
};

// ── Member action bottom-sheet (admin only) ──────────────────────────────
const _openMemberMenu = (u, group, chatId, onRefresh) => {
  const isOwner = u.uid === group.ownerUid;
  const overlay = document.createElement("div");
  overlay.className = "gi-member-action-overlay";
  const sheet = document.createElement("div");
  sheet.className = "gi-member-action-sheet";
  overlay.appendChild(sheet);

  const close = () => { sheet.classList.remove("open"); setTimeout(() => overlay.remove(), 280); };
  overlay.addEventListener("click", e => { if (e.target === overlay) close(); });

  sheet.innerHTML = `
    <div class="gi-maction-header">
      <img class="avatar sm" src="${avatarFor(u)}" alt="" />
      <div class="gi-maction-name">${u.name || "User"}</div>
      <div style="font-size:12px;color:var(--text-mute);">@${u.username || "user"}</div>
    </div>`;

  const mkRow = (icon, label, danger, onclick) => {
    const row = document.createElement("div");
    row.className = "gi-maction-row" + (danger ? " danger" : "");
    row.innerHTML = `<i class="${icon}"></i><span>${label}</span>`;
    row.onclick = () => { close(); onclick(); };
    sheet.appendChild(row);
  };

  mkRow("ri-user-line", "View profile", false, () => { location.hash = `#profile/${u.uid}`; });

  if (!isOwner) {
    mkRow("ri-shield-user-line", "Make admin", false, async () => {
      await updateDoc(doc(db, "groups", chatId), { ownerUid: u.uid });
      toast(`${u.name || "User"} is now admin`);
      onRefresh();
    });
    mkRow("ri-user-unfollow-line", "Remove from group", true, async () => {
      if (!confirm(`Remove ${u.name || "User"} from the group?`)) return;
      await updateDoc(doc(db, "groups", chatId), { members: arrayRemove(u.uid) });
      toast(`${u.name || "User"} removed`);
      onRefresh();
    });
  }

  document.body.appendChild(overlay);
  requestAnimationFrame(() => sheet.classList.add("open"));
};

// ── Admin edit sheet ─────────────────────────────────────────────────────
const _openGroupEdit = (chatId, group, onRefresh) => {
  const editOverlay = document.createElement("div");
  editOverlay.className = "gi-edit-overlay";
  const sheet = document.createElement("div");
  sheet.className = "gi-edit-sheet";
  editOverlay.appendChild(sheet);

  const closeEdit = () => { sheet.classList.remove("open"); setTimeout(() => editOverlay.remove(), 300); };
  editOverlay.addEventListener("click", e => { if (e.target === editOverlay) closeEdit(); });

  sheet.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
      <h3 style="margin:0;font-size:17px;font-weight:700;">Edit Group Info</h3>
      <button class="icon-btn gi-edit-close-btn"><i class="ri-close-line"></i></button>
    </div>
    <div class="gi-edit-label">Group Name</div>
    <input class="gi-edit-input" id="giEditName" type="text" maxlength="60"
      value="${(group.name || "").replace(/"/g, "&quot;")}" placeholder="Group name" />
    <div class="gi-edit-label">Description</div>
    <textarea class="gi-edit-input" id="giEditDesc" maxlength="200"
      placeholder="What's this group about?">${group.description || ""}</textarea>
    <button class="btn primary" id="giSaveBtn" style="width:100%;margin-top:18px;">Save changes</button>`;

  sheet.querySelector(".gi-edit-close-btn").onclick = closeEdit;

  sheet.querySelector("#giSaveBtn").onclick = async () => {
    const name = sheet.querySelector("#giEditName").value.trim();
    const description = sheet.querySelector("#giEditDesc").value.trim();
    if (!name) { toast("Group name cannot be empty"); return; }
    const saveBtn = sheet.querySelector("#giSaveBtn");
    saveBtn.disabled = true; saveBtn.textContent = "Saving…";
    try {
      await updateDoc(doc(db, "groups", chatId), { name, description });
      toast("Group info updated!");
      closeEdit();
      onRefresh();
    } catch {
      toast("Save failed — try again");
      saveBtn.disabled = false; saveBtn.textContent = "Save changes";
    }
  };

  document.body.appendChild(editOverlay);
  requestAnimationFrame(() => sheet.classList.add("open"));
};

// ── Main export ──────────────────────────────────────────────────────────
export const openGroupInfo = async (chatId, groupData = {}) => {
  _injectGroupInfoStyles();

  const snap = await getDoc(doc(db, "groups", chatId)).catch(() => null);
  if (!snap?.exists()) { toast("Group not found"); return; }

  document.getElementById("groupInfoOverlay")?.remove();

  const overlay = document.createElement("div");
  overlay.id = "groupInfoOverlay";
  overlay.className = "gi-overlay";
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add("gi-open"));

  const close = () => {
    overlay.classList.remove("gi-open");
    setTimeout(() => overlay.remove(), 340);
  };

  const render = async () => {
    const freshSnap = await getDoc(doc(db, "groups", chatId)).catch(() => null);
    const g = freshSnap?.exists() ? { id: chatId, ...freshSnap.data() } : { id: chatId, ...groupData };
    const isAdmin = g.ownerUid === state.uid;

    overlay.innerHTML = "";

    // ── Top bar ──────────────────────────────────────────────────────────
    const topBar = document.createElement("div");
    topBar.className = "gi-topbar";
    const backBtn = document.createElement("button");
    backBtn.className = "icon-btn";
    backBtn.innerHTML = '<i class="ri-arrow-left-line"></i>';
    backBtn.onclick = close;
    topBar.appendChild(backBtn);
    const titleEl = document.createElement("span");
    titleEl.className = "gi-topbar-title";
    titleEl.textContent = "Group Info";
    topBar.appendChild(titleEl);
    if (isAdmin) {
      const editBtn = document.createElement("button");
      editBtn.className = "btn ghost";
      editBtn.style.cssText = "padding:6px 12px;font-size:13px;gap:6px;";
      editBtn.innerHTML = '<i class="ri-edit-line"></i> Edit';
      editBtn.onclick = () => _openGroupEdit(chatId, g, render);
      topBar.appendChild(editBtn);
    }
    overlay.appendChild(topBar);

    // ── Avatar hero ──────────────────────────────────────────────────────
    const avatarWrap = document.createElement("div");
    avatarWrap.className = "gi-avatar-wrap";
    const avatarImg = document.createElement("img");
    avatarImg.className = "gi-avatar";
    avatarImg.src = g.photoURL || `https://api.dicebear.com/7.x/shapes/svg?seed=${chatId}`;
    avatarImg.alt = g.name || "Group";
    avatarWrap.appendChild(avatarImg);

    if (isAdmin) {
      const fileInput = document.createElement("input");
      fileInput.type = "file"; fileInput.accept = "image/*";
      fileInput.style.display = "none";
      fileInput.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        toast("Uploading photo…");
        try {
          const up = await uploadToCloudinary(file, "image");
          await updateDoc(doc(db, "groups", chatId), { photoURL: up.url });
          toast("Group photo updated!");
          render();
        } catch { toast("Upload failed — try again"); }
      };
      const camBtn = document.createElement("div");
      camBtn.className = "gi-cam-btn";
      camBtn.innerHTML = '<i class="ri-camera-line"></i>';
      camBtn.title = "Change group photo";
      camBtn.onclick = () => fileInput.click();
      avatarWrap.appendChild(camBtn);
      avatarWrap.appendChild(fileInput);
    }
    overlay.appendChild(avatarWrap);

    // ── Name & description ───────────────────────────────────────────────
    const nameEl = document.createElement("div");
    nameEl.className = "gi-name";
    nameEl.textContent = g.name || "Group";
    overlay.appendChild(nameEl);

    const descEl = document.createElement("div");
    descEl.className = "gi-desc";
    descEl.textContent = g.description || (isAdmin ? "Tap Edit to add a description" : "No description");
    overlay.appendChild(descEl);

    // ── Meta pills ───────────────────────────────────────────────────────
    const meta = document.createElement("div");
    meta.className = "gi-meta";

    const memberMeta = document.createElement("div");
    memberMeta.className = "gi-meta-item";
    memberMeta.innerHTML = `<i class="ri-group-line"></i><span>${(g.members || []).length} members · ${g.isPublic ? "Public group" : "Private group"}</span>`;
    meta.appendChild(memberMeta);

    if (g.createdAt?.seconds) {
      const dateMeta = document.createElement("div");
      dateMeta.className = "gi-meta-item";
      const dateStr = new Date(g.createdAt.seconds * 1000).toLocaleDateString([], { year: "numeric", month: "long", day: "numeric" });
      dateMeta.innerHTML = `<i class="ri-calendar-line"></i><span>Created ${dateStr}</span>`;
      meta.appendChild(dateMeta);
    }
    overlay.appendChild(meta);

    // ── Members section ──────────────────────────────────────────────────
    const membersSection = document.createElement("div");
    membersSection.className = "gi-section";
    const secTitle = document.createElement("div");
    secTitle.className = "gi-section-title";
    secTitle.innerHTML = `<i class="ri-group-line"></i> Members (${(g.members || []).length})`;
    membersSection.appendChild(secTitle);

    const membersList = document.createElement("div");
    membersList.className = "gi-members";
    membersList.innerHTML = `<div style="padding:16px 20px;font-size:13px;color:var(--text-mute);"><i class="ri-loader-4-line" style="animation:spin 1s linear infinite;font-size:18px;"></i></div>`;
    membersSection.appendChild(membersList);
    overlay.appendChild(membersSection);

    Promise.all((g.members || []).map(uid => fetchUser(uid))).then(users => {
      membersList.innerHTML = "";
      const sorted = users.filter(Boolean).sort((a, b) => {
        if (a.uid === g.ownerUid) return -1;
        if (b.uid === g.ownerUid) return 1;
        return 0;
      });
      sorted.forEach(u => {
        const isOwner = u.uid === g.ownerUid;
        const row = document.createElement("div");
        row.className = "gi-member-row";
        row.innerHTML = `
          <img class="avatar sm" src="${avatarFor(u)}" alt="" style="flex-shrink:0;" />
          <div class="gi-member-info">
            <div class="gi-member-name">
              ${u.name || "User"}
              ${isOwner ? '<span class="gi-badge admin">Admin</span>' : ""}
            </div>
            <div class="gi-member-sub">@${u.username || "user"}${u.online ? " · Online" : ""}</div>
          </div>`;
        row.onclick = () => { close(); location.hash = `#profile/${u.uid}`; };
        if (isAdmin && !isOwner) {
          const mBtn = document.createElement("button");
          mBtn.className = "icon-btn gi-member-menu-btn";
          mBtn.innerHTML = '<i class="ri-more-2-line"></i>';
          mBtn.onclick = (e) => { e.stopPropagation(); _openMemberMenu(u, g, chatId, render); };
          row.appendChild(mBtn);
        }
        membersList.appendChild(row);
      });
    }).catch(() => {});

    // ── Danger zone ──────────────────────────────────────────────────────
    const danger = document.createElement("div");
    danger.className = "gi-danger";
    if (isAdmin) {
      const delBtn = document.createElement("button");
      delBtn.className = "gi-danger-btn";
      delBtn.innerHTML = '<i class="ri-delete-bin-line"></i> Delete Group';
      delBtn.onclick = async () => {
        if (!confirm("Delete this group for everyone?")) return;
        try {
          const { deleteDoc } = await import("https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js");
          await deleteDoc(doc(db, "groups", chatId));
          close();
          location.hash = "#chats";
        } catch { toast("Delete failed — try again"); }
      };
      danger.appendChild(delBtn);
    } else {
      const leaveBtn = document.createElement("button");
      leaveBtn.className = "gi-danger-btn";
      leaveBtn.innerHTML = '<i class="ri-logout-box-line"></i> Leave Group';
      leaveBtn.onclick = async () => {
        if (!confirm("Leave this group?")) return;
        await updateDoc(doc(db, "groups", chatId), { members: arrayRemove(state.uid) });
        close();
        location.hash = "#chats";
      };
      danger.appendChild(leaveBtn);
    }
    overlay.appendChild(danger);
  };

  await render();
};

// 4. INIT
// =========================================================================
document.addEventListener("orbit:auth-ready", () => {
  initCallListener();
  _initToastListener();

  const contentEl = document.getElementById("content") || document.body;
  const feedObserver = new MutationObserver(() => {
    const fw = contentEl.querySelector(".feed-wrap");
    if (fw && !fw.querySelector(".community-bar")) injectCommunityBar(fw);
  });
  feedObserver.observe(contentEl, { childList: true, subtree: true });
});

// ── Typing sound — fires on keydown inside any chat/comment input ─────────
document.addEventListener("keydown", (e) => {
  const tag = e.target.tagName;
  if (tag !== "INPUT" && tag !== "TEXTAREA") return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === "Enter" || e.key === "Tab") return;
  // Only trigger inside message/comment inputs (not search, username, etc.)
  const el = e.target;
  const inChat = el.closest(".chat-input-area, .cmt-form, .comment-form, .compose-box, [data-chat-input]");
  if (inChat) window.sfxTyping?.();
}, { passive: true });
