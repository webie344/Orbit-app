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
  doc, setDoc, getDoc, updateDoc, addDoc, deleteDoc,
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

  // allGroups is shared across snapshot updates so swiping always uses latest data
  let _allGroups = [];

  const cutoff = Timestamp.fromMillis(Date.now() - STORY_TTL_MS);
  onSnapshot(
    query(collection(db, "stories"), where("expiresAt", ">", cutoff), limit(60)),
    async (snap) => {
      bar.querySelectorAll(".story-item:not(.my-story)").forEach(n => n.remove());
      _allGroups = [];

      const sorted = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.expiresAt?.toMillis?.() || 0) - (b.expiresAt?.toMillis?.() || 0));

      const byUser = new Map();
      sorted.forEach(s => {
        if (!byUser.has(s.authorUid)) byUser.set(s.authorUid, []);
        byUser.get(s.authorUid).push(s);
      });

      // Own stories go first in the group list
      if (byUser.has(state.uid)) {
        const mine = byUser.get(state.uid);
        _allGroups.push({ uid: state.uid, stories: mine });
        const hasUnseen = mine.some(s => !(s.viewers || []).includes(state.uid));
        myBtn.querySelector(".story-ring").className =
          `story-ring ${hasUnseen ? "has-story" : "seen-story"}`;
        myBtn.onclick = () => openStoryViewer([..._allGroups], 0);
      } else {
        myBtn.querySelector(".story-ring").className = "story-ring no-story";
        myBtn.onclick = () => openStoryUploader();
      }

      const otherUids = [...byUser.keys()].filter(u => u !== state.uid);
      const users = await Promise.all(otherUids.map(fetchUser));
      const userMap = Object.fromEntries(users.filter(Boolean).map(u => [u.uid, u]));

      otherUids.forEach(uid => {
        const user = userMap[uid];
        if (!user) return;
        const stories = byUser.get(uid);
        _allGroups.push({ uid, stories });
        const gIdx = _allGroups.length - 1;
        const allSeen = stories.every(s => (s.viewers || []).includes(state.uid));
        const item = document.createElement("div");
        item.className = "story-item";
        item.innerHTML = `
          <div class="story-ring ${allSeen ? "seen-story" : "has-story"}">
            <img class="story-av" src="${avatarFor(user)}" alt="" />
          </div>
          <span class="story-name">${(user.name || "User").split(" ")[0]}</span>`;
        item.onclick = () => openStoryViewer([..._allGroups], gIdx);
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

// allGroups: [{ uid, stories: [...] }, ...]
// startGroupIdx: which user's stories to open first
const openStoryViewer = (allGroups, startGroupIdx = 0) => {
  if (!allGroups?.length) return;

  let groupIdx = Math.min(startGroupIdx, allGroups.length - 1);
  let storyIdx = 0;
  let timer = null;
  let isPaused = false;
  let elapsed = 0;
  let timerStart = null;
  const DURATION = 5000;

  const overlay = document.createElement("div");
  overlay.className = "story-viewer-overlay";
  document.body.appendChild(overlay);

  // ── Pause / Resume ───────────────────────────────────────────────────────
  const pauseStory = () => {
    if (isPaused) return;
    isPaused = true;
    clearTimeout(timer);
    if (timerStart) { elapsed += Date.now() - timerStart; timerStart = null; }
    const fill = overlay.querySelector(".story-seg.active .story-seg-fill");
    if (fill) fill.style.animationPlayState = "paused";
    const vid = overlay.querySelector("video");
    if (vid && !vid.paused) vid.pause();
  };

  const resumeStory = () => {
    if (!isPaused) return;
    isPaused = false;
    const fill = overlay.querySelector(".story-seg.active .story-seg-fill");
    if (fill) fill.style.animationPlayState = "running";
    const vid = overlay.querySelector("video");
    if (vid) { vid.play().catch(() => {}); return; }
    const remaining = Math.max(300, DURATION - elapsed);
    timerStart = Date.now();
    timer = setTimeout(() => { elapsed = 0; goNext(); }, remaining);
  };

  // ── Two-level navigation ─────────────────────────────────────────────────
  const goNext = () => {
    clearTimeout(timer); elapsed = 0;
    const group = allGroups[groupIdx];
    if (storyIdx < group.stories.length - 1) {
      storyIdx++;
      render(null);
    } else if (groupIdx < allGroups.length - 1) {
      groupIdx++; storyIdx = 0;
      render("left"); // next user slides in from right
    } else {
      overlay.remove(); // end of all stories
    }
  };

  const goPrev = () => {
    clearTimeout(timer); elapsed = 0;
    if (storyIdx > 0) {
      storyIdx--;
      render(null);
    } else if (groupIdx > 0) {
      groupIdx--; storyIdx = 0;
      render("right"); // previous user slides in from left
    }
  };

  // ── Touch: swipe between users + hold-to-pause ───────────────────────────
  let _tx = 0, _ty = 0, _isSwipe = false, _wasHold = false, _holdTimer = null;

  overlay.addEventListener("touchstart", (e) => {
    _tx = e.touches[0].clientX;
    _ty = e.touches[0].clientY;
    _isSwipe = false; _wasHold = false;
    _holdTimer = setTimeout(() => { _wasHold = true; pauseStory(); }, 200);
  }, { passive: true });

  overlay.addEventListener("touchmove", (e) => {
    if (Math.abs(e.touches[0].clientX - _tx) > 12) {
      _isSwipe = true; clearTimeout(_holdTimer);
    }
  }, { passive: true });

  overlay.addEventListener("touchend", (e) => {
    clearTimeout(_holdTimer);
    if (_wasHold) { resumeStory(); return; }     // release from hold
    if (_isSwipe) {                               // horizontal swipe → change user
      const dx = e.changedTouches[0].clientX - _tx;
      const dy = e.changedTouches[0].clientY - _ty;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
        dx < 0 ? goNext() : goPrev();
      }
    }
    // plain tap handled by click on tap-zones below
  });

  // Desktop hold-to-pause
  let _mHold = null;
  overlay.addEventListener("mousedown", () => { _mHold = setTimeout(pauseStory, 200); });
  overlay.addEventListener("mouseup",   () => { clearTimeout(_mHold); resumeStory(); });

  // ── Main render ──────────────────────────────────────────────────────────
  const render = async (slideDir) => {
    clearTimeout(timer);
    isPaused = false; elapsed = 0; timerStart = null;

    const group = allGroups[groupIdx];
    if (!group) { overlay.remove(); return; }
    const s = group.stories[storyIdx];
    if (!s) { overlay.remove(); return; }
    const isOwn = group.uid === state.uid;
    const viewers = s.viewers || [];

    const user = await fetchUser(group.uid).catch(() => null);

    const segs = group.stories.map((_, i) =>
      `<div class="story-seg ${i < storyIdx ? "done" : i === storyIdx ? "active" : ""}">` +
      `<div class="story-seg-fill" style="${i === storyIdx ? `animation:story-prog ${DURATION / 1000}s linear forwards;` : ""}"></div></div>`
    ).join("");

    const menuBtnHtml = isOwn
      ? `<button class="icon-btn story-menu-btn" style="color:#fff;margin-left:4px;"><i class="ri-more-line"></i></button>`
      : "";

    const viewerBarHtml = isOwn && viewers.length > 0
      ? `<div class="story-viewer-bar" id="storyViewerBar">
           <div class="story-viewer-bar-avatars"></div>
           <span class="story-viewer-bar-count"><i class="ri-eye-line"></i> ${viewers.length}</span>
         </div>`
      : "";

    overlay.innerHTML = `
      <div class="story-viewer${slideDir ? ` story-slide-${slideDir}` : ""}">
        <div class="story-segs">${segs}</div>
        <div class="story-viewer-head">
          <img class="story-av" src="${avatarFor(user)}" style="width:36px;height:36px;border-radius:50%;border:2px solid white;" />
          <div class="story-viewer-uname">${user?.name || "User"}</div>
          <div style="margin-left:auto;font-size:12px;color:rgba(255,255,255,.7);">${fmtTime(s.createdAt)}</div>
          ${menuBtnHtml}
          <button class="icon-btn story-viewer-close" style="color:#fff;margin-left:8px;"><i class="ri-close-line"></i></button>
        </div>
        <div class="story-viewer-media">
          ${s.mediaType === "video" && s.mediaUrl
            ? `<video src="${s.mediaUrl}" autoplay playsinline style="width:100%;height:100%;object-fit:cover;"></video>`
            : s.mediaUrl
            ? `<img src="${s.mediaUrl}" style="width:100%;height:100%;object-fit:cover;" />`
            : `<div class="story-text-card">${s.caption || ""}</div>`}
        </div>
        ${s.caption && s.mediaUrl ? `<div class="story-viewer-caption">${s.caption}</div>` : ""}
        ${viewerBarHtml}
        <div class="story-tap-zones">
          <div class="story-tap-prev"></div>
          <div class="story-tap-next"></div>
        </div>
      </div>`;

    overlay.querySelector(".story-viewer-close").onclick = (e) => {
      e.stopPropagation(); clearTimeout(timer); overlay.remove();
    };

    // Click-based tap nav (desktop + mobile tap — swipe handled by touchend)
    overlay.querySelector(".story-tap-prev").addEventListener("click", (e) => {
      if (_isSwipe || _wasHold) return; // swipe/hold already handled
      e.stopPropagation(); goPrev();
    });
    overlay.querySelector(".story-tap-next").addEventListener("click", (e) => {
      if (_isSwipe || _wasHold) return;
      e.stopPropagation(); goNext();
    });

    // ── 3-dot menu ────────────────────────────────────────────────────────
    if (isOwn) {
      const mb = overlay.querySelector(".story-menu-btn");
      if (mb) {
        mb.onclick = (e) => {
          e.stopPropagation(); pauseStory();
          const ex = overlay.querySelector(".story-ctx-menu");
          if (ex) { ex.remove(); resumeStory(); return; }
          const menu = document.createElement("div");
          menu.className = "story-ctx-menu";
          menu.innerHTML = `
            <button class="story-ctx-item"><i class="ri-add-circle-line"></i> Add to story</button>
            <button class="story-ctx-item story-ctx-danger"><i class="ri-delete-bin-line"></i> Delete this story</button>`;
          menu.querySelector(".story-ctx-item").onclick = (e) => {
            e.stopPropagation(); clearTimeout(timer); overlay.remove(); openStoryUploader();
          };
          menu.querySelector(".story-ctx-danger").onclick = async (e) => {
            e.stopPropagation();
            try {
              await deleteDoc(doc(db, "stories", s.id));
              group.stories.splice(storyIdx, 1);
              if (!group.stories.length) {
                allGroups.splice(groupIdx, 1);
                if (!allGroups.length) { clearTimeout(timer); overlay.remove(); return; }
                if (groupIdx >= allGroups.length) groupIdx = allGroups.length - 1;
                storyIdx = 0;
              } else {
                if (storyIdx >= group.stories.length) storyIdx = group.stories.length - 1;
              }
              render(null);
            } catch { toast("Delete failed"); resumeStory(); }
          };
          mb.insertAdjacentElement("afterend", menu);
        };
      }

      // ── Viewer avatars ─────────────────────────────────────────────────
      const vBar = overlay.querySelector("#storyViewerBar");
      if (vBar && viewers.length > 0) {
        const avatarWrap = vBar.querySelector(".story-viewer-bar-avatars");
        Promise.all(viewers.slice(0, 3).map(vUid => fetchUser(vUid).catch(() => null))).then(us => {
          avatarWrap.innerHTML = "";
          us.filter(Boolean).forEach(u => {
            avatarWrap.appendChild(Object.assign(document.createElement("img"), {
              className: "story-viewer-av", src: avatarFor(u), title: u.name || "User",
            }));
          });
          const rest = viewers.length - 3;
          if (rest > 0) avatarWrap.appendChild(Object.assign(document.createElement("span"), {
            className: "story-viewer-more", textContent: `+${rest}`,
          }));
        });
        vBar.style.cursor = "pointer";
        vBar.onclick = (e) => { e.stopPropagation(); pauseStory(); _showAllViewers(viewers, overlay, resumeStory); };
      }
    }

    // ── Video: audio ON, autoplay with mute fallback ─────────────────────
    if (s.mediaType === "video") {
      const vid = overlay.querySelector("video");
      if (vid) {
        vid.play().catch(() => { vid.muted = true; vid.play().catch(() => {}); });
        vid.onended = () => goNext();
      }
    } else {
      timerStart = Date.now();
      timer = setTimeout(() => { elapsed = 0; goNext(); }, DURATION);
    }

    // Mark viewed
    if (!viewers.includes(state.uid)) {
      updateDoc(doc(db, "stories", s.id), { viewers: arrayUnion(state.uid) }).catch(() => {});
    }
  };

  render(null);
};

// Full viewer list sheet
const _showAllViewers = async (viewerUids, overlay, onClose) => {
  const existing = overlay.querySelector(".story-viewers-sheet");
  if (existing) { existing.remove(); onClose(); return; }
  const sheet = document.createElement("div");
  sheet.className = "story-viewers-sheet";
  sheet.innerHTML = `
    <div class="story-viewers-head">
      <span><i class="ri-eye-line"></i> Viewed by ${viewerUids.length}</span>
      <button class="icon-btn" style="color:#fff;"><i class="ri-close-line"></i></button>
    </div>
    <div class="story-viewers-list"><div style="color:rgba(255,255,255,.6);padding:20px;text-align:center;">Loading…</div></div>`;
  sheet.querySelector("button").onclick = (e) => { e.stopPropagation(); sheet.remove(); onClose(); };
  overlay.querySelector(".story-viewer").appendChild(sheet);
  const list = sheet.querySelector(".story-viewers-list");
  const users = await Promise.all(viewerUids.map(vUid => fetchUser(vUid).catch(() => null)));
  list.innerHTML = "";
  users.filter(Boolean).forEach(u => {
    const row = document.createElement("div");
    row.className = "story-viewer-row";
    row.innerHTML = `<img class="avatar sm" src="${avatarFor(u)}" /><span>${u.name || "User"}</span>`;
    row.onclick = (e) => { e.stopPropagation(); overlay.remove(); location.hash = `#profile/${u.uid}`; };
    list.appendChild(row);
  });
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
    comment: "ri-chat-4-fill", commentLike: "ri-heart-fill", groupMessage: "ri-group-2-fill", call: "ri-phone-fill",
  };
  const colMap = {
    orbit: "var(--grad-2)", follow: "var(--primary)", message: "var(--good)",
    comment: "var(--grad-3)", commentLike: "var(--danger)", groupMessage: "var(--good)", call: "#3fdca0",
  };
  const descMap = {
    orbit: "orbited your post", follow: "followed you", message: "sent you a message",
    comment: "commented on your post", commentLike: "liked your comment", groupMessage: "sent a message in the group", call: "called you",
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
        else if (n.type === "groupMessage" && n.groupId) location.hash = "#chats/" + n.groupId;
        else if (n.type === "follow" && n.fromUid) location.hash = "#profile/" + n.fromUid;
        else if ((n.type === "comment" || n.type === "commentLike") && n.postId) location.hash = "#post/" + n.postId;
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
// 2b. GROUP INFO — full member list, rename, invite link, leave/delete
// =========================================================================
export const openGroupInfo = async (chatId, group) => {
  const overlay = document.createElement("div");
  overlay.className = "chat-info-overlay";
  const sheet = document.createElement("div");
  sheet.className = "chat-info-sheet";
  overlay.appendChild(sheet);

  const close = () => { sheet.classList.remove("open"); setTimeout(() => overlay.remove(), 280); };
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

  const isOwner = group.ownerUid === state.uid;

  const hdr = document.createElement("div");
  hdr.className = "cis-header";
  hdr.innerHTML = `
    <button class="icon-btn cis-close"><i class="ri-close-line"></i></button>
    <div class="cis-avatar-wrap">
      <img class="cis-avatar" src="${group.photoURL || `https://api.dicebear.com/7.x/shapes/svg?seed=${chatId}`}" alt="" />
    </div>
    <div class="cis-name">${group.name || "Group"}</div>
    <div class="cis-sub">${(group.members || []).length} members</div>
    ${group.description ? `<div class="cis-bio">${group.description}</div>` : ""}`;
  hdr.querySelector(".cis-close").onclick = close;
  sheet.appendChild(hdr);

  if (isOwner) {
    const editRow = document.createElement("div");
    editRow.className = "cis-call-row";
    const renameBtn = document.createElement("button");
    renameBtn.className = "cis-call-btn";
    renameBtn.innerHTML = `<span class="cis-call-icon"><i class="ri-edit-line"></i></span><span>Rename</span>`;
    renameBtn.onclick = async () => {
      const name = prompt("Group name", group.name || "")?.trim();
      if (!name) return;
      await updateDoc(doc(db, "groups", chatId), { name }).catch(() => {});
      group.name = name;
      hdr.querySelector(".cis-name").textContent = name;
      toast("Group renamed");
    };
    editRow.appendChild(renameBtn);
    const inviteBtn = document.createElement("button");
    inviteBtn.className = "cis-call-btn";
    inviteBtn.innerHTML = `<span class="cis-call-icon"><i class="ri-links-line"></i></span><span>Invite</span>`;
    inviteBtn.onclick = async () => {
      await navigator.clipboard.writeText(`${location.origin}${location.pathname}#chats/${chatId}`);
      toast("Invite link copied");
    };
    editRow.appendChild(inviteBtn);
    sheet.appendChild(editRow);
  }

  const membersSection = document.createElement("div");
  membersSection.className = "cis-section";
  membersSection.innerHTML = `<div class="cis-section-title"><i class="ri-group-line"></i> Members (${(group.members || []).length})</div>`;
  const membersList = document.createElement("div");
  membersList.className = "cis-members-list";
  membersSection.appendChild(membersList);
  sheet.appendChild(membersSection);

  const users = await Promise.all((group.members || []).map((uid) => fetchUser(uid)));
  users.filter(Boolean).forEach((u) => {
    const isThatOwner = u.uid === group.ownerUid;
    const row = document.createElement("div");
    row.className = "cis-member-row";
    row.innerHTML = `
      <img class="avatar sm" src="${avatarFor(u)}" alt="" />
      <div class="cis-member-info">
        <div class="cis-member-name">${u.name || "User"}${isThatOwner ? ' <span class="cis-owner-badge">Admin</span>' : ""}</div>
        <div class="cis-member-sub">@${u.username || "user"}${u.online ? " · Online" : ""}</div>
      </div>
      ${isOwner && !isThatOwner ? '<button class="icon-btn cis-remove-member" title="Remove from group"><i class="ri-close-circle-line"></i></button>' : ""}`;
    row.addEventListener("click", (e) => {
      if (e.target.closest(".cis-remove-member")) return;
      close(); location.hash = `#profile/${u.uid}`;
    });
    const removeBtn = row.querySelector(".cis-remove-member");
    if (removeBtn) {
      removeBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!confirm(`Remove ${u.name || "this member"} from the group?`)) return;
        await updateDoc(doc(db, "groups", chatId), { members: arrayRemove(u.uid) }).catch(() => {});
        group.members = (group.members || []).filter((x) => x !== u.uid);
        row.remove();
        toast("Member removed");
      });
    }
    membersList.appendChild(row);
  });

  const actSection = document.createElement("div");
  actSection.className = "cis-section cis-actions";
  const muted = (state.me.mutedChats || []).includes(chatId);
  const actions = [{
    icon: muted ? "ri-notification-off-line" : "ri-notification-3-line",
    label: muted ? "Unmute notifications" : "Mute notifications",
    onclick: async () => {
      await updateDoc(doc(db, "users", state.uid), { mutedChats: muted ? arrayRemove(chatId) : arrayUnion(chatId) });
      toast(muted ? "Unmuted" : "Muted"); close();
    },
  }];
  if (isOwner) {
    actions.push({
      icon: "ri-delete-bin-line", label: "Delete group", danger: true,
      onclick: async () => {
        if (!confirm("Delete group for everyone?")) return;
        await deleteDoc(doc(db, "groups", chatId));
        location.hash = "#chats";
      },
    });
  } else {
    actions.push({
      icon: "ri-logout-box-line", label: "Leave group", danger: true,
      onclick: async () => {
        if (!confirm("Leave this group?")) return;
        await updateDoc(doc(db, "groups", chatId), { members: arrayRemove(state.uid) });
        location.hash = "#chats";
      },
    });
  }
  actions.forEach((a) => {
    const row = document.createElement("button");
    row.className = "cis-action-row" + (a.danger ? " danger" : "");
    row.innerHTML = `<i class="${a.icon}"></i><span>${a.label}</span>`;
    row.onclick = a.onclick;
    actSection.appendChild(row);
  });
  sheet.appendChild(actSection);

  document.body.appendChild(overlay);
  requestAnimationFrame(() => sheet.classList.add("open"));
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

// Speaking detection — glows the tile border when audio is detected
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

const _updateParticipantCount = (overlay) => {
  const grid = overlay.querySelector(".call-remote-grid");
  const count = (grid ? grid.querySelectorAll(".call-remote-peer").length : 0) + 1;
  const badge = overlay.querySelector(".call-participant-count");
  if (badge) badge.textContent = `${count} participant${count !== 1 ? "s" : ""}`;
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

  // Name + mic label pinned to bottom of tile
  const label = document.createElement("div");
  label.className = "call-tile-label";
  label.innerHTML = `<i class="ri-mic-line call-tile-mic"></i><span class="call-tile-name">…</span>`;
  fetchUser(peerId).then(u => {
    label.querySelector(".call-tile-name").textContent = (u?.name || "User").split(" ")[0];
  });
  peerEl.appendChild(label);

  _watchSpeaking(stream, peerEl);
  grid.appendChild(peerEl);
  _updateParticipantCount(overlay);
};

const _buildCallOverlay = ({ callId, localStream, isGroup, type, chatId, role }) => {
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
        ${isGroup ? `<div class="call-status-sub">Waiting for others to join</div>` : ""}
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
    if (el2) el2.textContent = `${String(Math.floor(s / 60)).padStart(2,"0")}:${String(s % 60).padStart(2,"0")}`;
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
    _endCall(callId, overlay, localStream);
  };

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
