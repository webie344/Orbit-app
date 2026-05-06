// =========================================================================
// Orbit — additional.js
// Stories (24 hr), Notifications full-page view, Voice + Video Calls (WebRTC)
// Drop this file alongside app.js, chat.js, etc. — it self-wires via events.
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
// 1. STORIES
// =========================================================================
const STORY_TTL_MS = 24 * 60 * 60 * 1000;

export const injectStoryBar = (feedWrap) => {
  if (!feedWrap) return;
  const existing = feedWrap.querySelector(".story-bar");
  if (existing) existing.remove();

  const bar = document.createElement("div");
  bar.className = "story-bar";

  // "Your story" tile
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

      // My stories
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
// 3. VOICE + VIDEO CALLS (WebRTC, Firebase signaling)
// =========================================================================

const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
  ],
};

let _activeCall = null;

export const startCall = async ({ peerId, chatId, isGroup, type = "voice" }) => {
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
    type, chatId, isGroup,
    participants: [state.uid],
    status: "ringing",
  });
  const callId = callRef.id;

  // Notify peer(s)
  if (isGroup) {
    const gSnap = await getDoc(doc(db, "groups", chatId)).catch(() => null);
    const members = (gSnap?.data()?.members || []).filter(u => u !== state.uid);
    for (const uid of members.slice(0, 14)) {
      writeNotif(uid, "call", {
        text: `${state.me?.name || "Someone"} started a group call`,
        callId,
      }).catch(() => {});
    }
  } else {
    writeNotif(peerId, "call", {
      text: `${state.me?.name || "Someone"} is calling you`,
      callId,
    }).catch(() => {});
  }

  const overlay = _buildCallOverlay({ callId, localStream, isGroup, type, chatId, role: "caller" });
  document.body.appendChild(overlay);
  _activeCall = { callId, overlay, localStream, peers: {}, unsubs: [] };

  if (!isGroup) {
    _connectPeer({ callId, localStream, peerId, overlay, type });
  } else {
    const gSnap = await getDoc(doc(db, "groups", chatId)).catch(() => null);
    const members = (gSnap?.data()?.members || []).filter(u => u !== state.uid).slice(0, 14);
    for (const uid of members) {
      _connectPeer({ callId, localStream, peerId: uid, overlay, type });
    }
  }
};

const _connectPeer = async ({ callId, localStream, peerId, overlay, type }) => {
  const pc = new RTCPeerConnection(ICE_SERVERS);
  if (_activeCall) _activeCall.peers[peerId] = pc;

  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  pc.ontrack = e => _addRemoteStream(overlay, peerId, e.streams[0]);

  const candCol = collection(db, "calls", callId, `cand_${state.uid}_${peerId}`);
  pc.onicecandidate = e => {
    if (e.candidate) addDoc(candCol, e.candidate.toJSON()).catch(() => {});
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await setDoc(doc(db, "calls", callId, "offers", peerId), {
    from: state.uid, sdp: offer.sdp, type: offer.type,
  });

  // Wait for answer
  const u1 = onSnapshot(doc(db, "calls", callId, "answers", state.uid), async snap => {
    if (!snap.exists()) return;
    const ans = snap.data();
    if (ans.from !== peerId || pc.remoteDescription) return;
    await pc.setRemoteDescription(new RTCSessionDescription(ans)).catch(() => {});
  });

  // Remote ICE candidates
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
  if (!callSnap?.exists() || callSnap.data().status !== "ringing") {
    toast("Call no longer available"); return;
  }
  const call = callSnap.data();
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

  const overlay = _buildCallOverlay({
    callId, localStream, isGroup: call.isGroup, type: call.type,
    chatId: call.chatId, role: "callee",
  });
  document.body.appendChild(overlay);
  _activeCall = { callId, overlay, localStream, peers: {}, unsubs: [] };

  // Watch for incoming offers (caller sends us one)
  const u0 = onSnapshot(doc(db, "calls", callId, "offers", state.uid), async snap => {
    if (!snap.exists()) return;
    const offer = snap.data();
    const peerId = offer.from;
    if (_activeCall?.peers[peerId]) return;

    const pc = new RTCPeerConnection(ICE_SERVERS);
    if (_activeCall) _activeCall.peers[peerId] = pc;

    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    pc.ontrack = e => _addRemoteStream(overlay, peerId, e.streams[0]);

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

const _addRemoteStream = (overlay, peerId, stream) => {
  const grid = overlay.querySelector(".call-remote-grid");
  if (!grid) return;
  if (grid.querySelector(`[data-peer="${peerId}"]`)) return;

  overlay.querySelector(".call-status-wrap")?.remove();

  const peerEl = document.createElement("div");
  peerEl.className = "call-remote-peer";
  peerEl.dataset.peer = peerId;

  const hasVid = stream.getVideoTracks().length > 0;
  if (hasVid) {
    const vid = document.createElement("video");
    vid.autoplay = true; vid.playsInline = true; vid.srcObject = stream;
    peerEl.appendChild(vid);
  } else {
    const box = document.createElement("div");
    box.className = "call-audio-peer";
    fetchUser(peerId).then(u => {
      box.innerHTML = `<img class="avatar lg" src="${avatarFor(u)}" /><div class="call-peer-name">${u?.name || "User"}</div>`;
    });
    peerEl.appendChild(box);
  }
  grid.appendChild(peerEl);
};

const _buildCallOverlay = ({ callId, localStream, isGroup, type, chatId, role }) => {
  const overlay = document.createElement("div");
  overlay.className = "call-overlay";
  const hasVideo = type === "video";
  let muted = false, camOff = false;

  overlay.innerHTML = `
    <div class="call-container">
      <div class="call-remote-grid"></div>
      <div class="call-status-wrap">
        <div class="call-status-icon"><i class="ri-${hasVideo ? "vidicon" : "phone"}-fill"></i></div>
        <div class="call-status-text">${role === "caller" ? "Calling…" : "Connecting…"}</div>
      </div>
      ${hasVideo
        ? `<video id="callLocalVid" autoplay muted playsinline class="call-local-video"></video>`
        : `<div class="call-local-audio"><img class="avatar xl" src="${avatarFor(state.me)}" /><div class="call-my-name">${state.me?.name || "Me"}</div></div>`}
      <div class="call-controls">
        <button class="call-ctrl" id="ccMute" title="Mute"><i class="ri-mic-line"></i></button>
        ${hasVideo ? `<button class="call-ctrl" id="ccCam" title="Camera"><i class="ri-vidicon-line"></i></button>` : ""}
        <button class="call-ctrl danger" id="ccEnd" title="End call"><i class="ri-phone-fill" style="transform:rotate(135deg);"></i></button>
      </div>
    </div>`;

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
  };

  if (hasVideo) {
    overlay.querySelector("#ccCam").onclick = () => {
      camOff = !camOff;
      localStream.getVideoTracks().forEach(t => { t.enabled = !camOff; });
      const btn = overlay.querySelector("#ccCam");
      btn.querySelector("i").className = camOff ? "ri-vidicon-off-line" : "ri-vidicon-line";
      btn.classList.toggle("active", camOff);
    };
  }

  overlay.querySelector("#ccEnd").onclick = () => _endCall(callId, overlay, localStream);

  return overlay;
};

const _endCall = async (callId, overlay, localStream) => {
  localStream?.getTracks().forEach(t => t.stop());
  if (_activeCall) {
    Object.values(_activeCall.peers || {}).forEach(pc => { try { pc.close(); } catch {} });
    (_activeCall.unsubs || []).forEach(u => { try { u(); } catch {} });
    _activeCall = null;
  }
  overlay.remove();
  await updateDoc(doc(db, "calls", callId), { status: "ended" }).catch(() => {});
};

// Incoming call notification listener
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
  if (!callSnap?.exists() || callSnap.data().status !== "ringing") return;
  const call = callSnap.data();

  const caller = await fetchUser(call.callerId).catch(() => null);

  const banner = document.createElement("div");
  banner.className = "incoming-call-banner";
  banner.id = `icb_${n.callId}`;
  banner.innerHTML = `
    <img class="avatar md" src="${avatarFor(caller)}" alt="" />
    <div class="icb-info">
      <div class="icb-name">${caller?.name || n.fromName || "Someone"}</div>
      <div class="icb-type">${call.type === "video" ? "Video" : "Voice"} call${call.isGroup ? " (Group)" : ""}</div>
    </div>
    <button class="call-ctrl danger" id="icbDecline_${n.callId}" title="Decline">
      <i class="ri-phone-fill" style="transform:rotate(135deg);"></i>
    </button>
    <button class="call-ctrl accept" id="icbAccept_${n.callId}" title="Answer">
      <i class="ri-phone-fill"></i>
    </button>`;
  document.body.appendChild(banner);

  const dismiss = setTimeout(() => banner.remove(), 30000);

  banner.querySelector(`#icbDecline_${n.callId}`).onclick = () => {
    clearTimeout(dismiss); banner.remove();
    updateDoc(doc(db, "calls", n.callId), { status: "declined" }).catch(() => {});
  };

  banner.querySelector(`#icbAccept_${n.callId}`).onclick = async () => {
    clearTimeout(dismiss); banner.remove();
    await answerCall(n.callId);
  };

  // Auto-dismiss when call state changes
  const u = onSnapshot(doc(db, "calls", n.callId), snap => {
    if (!snap.exists() || snap.data().status !== "ringing") {
      clearTimeout(dismiss); banner.remove(); u();
    }
  });
};

// =========================================================================
// 4. INIT — fires once auth is ready
// =========================================================================
document.addEventListener("orbit:auth-ready", () => {
  initCallListener();

  // Watch for .feed-wrap appearing in #content and inject story bar
  const contentEl = document.getElementById("content") || document.body;
  const feedObserver = new MutationObserver(() => {
    const fw = contentEl.querySelector(".feed-wrap");
    if (fw && !fw.querySelector(".story-bar")) injectStoryBar(fw);
  });
  feedObserver.observe(contentEl, { childList: true, subtree: true });
});
