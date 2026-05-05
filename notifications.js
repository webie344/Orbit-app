// =========================================================================
// Orbit — notifications.js  (v4 — new VAPID key)
// Handles push subscription, enable banner, in-app toasts, and outbound
// push calls to /api/send-notification.
// =========================================================================

import { db, state } from "./app.js";
import {
  doc, getDoc, setDoc, addDoc, collection, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

// Generated VAPID public key — must match VAPID_PUBLIC_KEY env var on the server
const VAPID_PUBLIC_KEY = "BKhFP8VMKoxGNG0Z8fw6S_v9MXGevGDO49XWfc8VGnWp04nkTKqUArCn798R8bJuGOgtzfK3Q601UXctdbQ9j58";

// Bump this any time you change the VAPID key — forces every client to re-subscribe
const SUBSCRIPTION_VERSION = "v4";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64  = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

// ── Subscribe and save to Firestore ──────────────────────────────────────
async function subscribe() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    showToastMsg("Push not supported on this browser");
    return false;
  }
  try {
    const reg = await navigator.serviceWorker.ready;

    // Always unsubscribe old subscription first so a fresh one is created
    // with the current VAPID key (stale subscriptions cause 410 errors)
    const existing = await reg.pushManager.getSubscription();
    if (existing) await existing.unsubscribe();

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });

    const subData = JSON.parse(JSON.stringify(sub));
    await setDoc(doc(db, "users", state.uid), {
      pushSubscription: subData,
      pushSubVersion: SUBSCRIPTION_VERSION,
    }, { merge: true });

    localStorage.setItem("orbit:sub-version", SUBSCRIPTION_VERSION);
    console.log("Orbit: subscription saved", subData.endpoint);
    return true;
  } catch (err) {
    console.error("Orbit: push subscribe failed", err);
    showToastMsg("Could not save notification settings: " + (err.message || err));
    return false;
  }
}

// ── Show / hide the enable-notifications banner ───────────────────────────
function showNotifBanner(msg) {
  const banner = document.getElementById("notifEnableBanner");
  if (!banner) return;
  if (msg) {
    const span = banner.querySelector(".notif-enable-text span");
    if (span) span.textContent = msg;
  }
  banner.classList.remove("hidden");
}
function hideNotifBanner() {
  const banner = document.getElementById("notifEnableBanner");
  if (banner) banner.classList.add("hidden");
}

// ── Handle the "Enable" button tap ───────────────────────────────────────
async function handleEnableClick() {
  const btn = document.getElementById("notifEnableBtn");
  if (btn) { btn.textContent = "Enabling…"; btn.disabled = true; }

  const permission = await Notification.requestPermission();

  if (permission === "granted") {
    const ok = await subscribe();
    hideNotifBanner();
    localStorage.removeItem("orbit:notif-dismissed");
    if (ok) showToastMsg("Notifications enabled!");
  } else {
    hideNotifBanner();
    if (btn) { btn.textContent = "Enable"; btn.disabled = false; }
  }
}

function showToastMsg(msg) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.remove("hidden");
  setTimeout(() => t.classList.add("hidden"), 3000);
}

// ── In-app notification (shown while app is open) ────────────────────────
export function showInAppNotif(title, body, url) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.innerHTML = `<strong>${title}</strong><br><small>${body}</small>`;
  t.classList.remove("hidden");
  if (url) t.style.cursor = "pointer";
  const go = url ? () => { window.location.hash = url; } : null;
  if (go) t.onclick = go;
  clearTimeout(showInAppNotif._t);
  showInAppNotif._t = setTimeout(() => {
    t.classList.add("hidden");
    t.style.cursor = "";
    t.onclick = null;
  }, 4000);
}

// ── Check whether to show the first-time enable banner ───────────────────
function checkAndShowBanner() {
  if (!("Notification" in window)) return;
  if (Notification.permission === "granted") return;
  if (Notification.permission === "denied") return;
  if (!state.uid) return;
  setTimeout(() => showNotifBanner(), 3000);
}

// ── Check if the existing subscription is stale and needs refreshing ──────
async function checkForStaleSubscription() {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  if (!state.uid) return;

  try {
    const snap = await getDoc(doc(db, "users", state.uid));
    const data          = snap.data() || {};
    const saved         = data.pushSubscription;
    const savedVersion  = data.pushSubVersion;
    const localVersion  = localStorage.getItem("orbit:sub-version");

    // Everything is current — nothing to do
    if (saved && savedVersion === SUBSCRIPTION_VERSION && localVersion === SUBSCRIPTION_VERSION) return;

    // No subscription saved at all — try silent re-subscribe (covers 410 cleanup case)
    if (!saved) {
      console.log("Orbit: no saved subscription, re-subscribing silently");
      const ok = await subscribe();
      if (!ok) {
        // Silent re-subscribe failed — ask user to tap Refresh
        setTimeout(() => {
          showNotifBanner("Tap to reconnect push notifications");
          const btn = document.getElementById("notifEnableBtn");
          if (btn) btn.textContent = "Reconnect";
        }, 3000);
      }
      return;
    }

    // Subscription exists but VAPID key version changed — need fresh subscription
    if (savedVersion !== SUBSCRIPTION_VERSION) {
      console.log("Orbit: VAPID key changed, re-subscribing silently");
      const ok = await subscribe();
      if (!ok) {
        setTimeout(() => {
          showNotifBanner("Tap Refresh to keep getting notifications");
          const btn = document.getElementById("notifEnableBtn");
          if (btn) btn.textContent = "Refresh";
        }, 3000);
      }
      return;
    }

    // Local version out of sync (e.g. different device/tab) — sync it silently
    localStorage.setItem("orbit:sub-version", SUBSCRIPTION_VERSION);
  } catch (err) {
    console.warn("Orbit: stale subscription check failed", err);
  }
}

// ── Wire up buttons ───────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  const enableBtn  = document.getElementById("notifEnableBtn");
  const dismissBtn = document.getElementById("notifEnableDismiss");
  const bellBtn    = document.getElementById("notifBtn");

  enableBtn  && enableBtn.addEventListener("click",  handleEnableClick);
  dismissBtn && dismissBtn.addEventListener("click", () => {
    hideNotifBanner();
    localStorage.setItem("orbit:notif-dismissed", "1");
  });

  if (bellBtn && ("Notification" in window) && Notification.permission !== "granted") {
    bellBtn.addEventListener("click", () => {
      if (Notification.permission === "default") showNotifBanner();
    });
  }
});

// ── Run once logged in ────────────────────────────────────────────────────
document.addEventListener("orbit:auth-ready", () => {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") {
    if (!localStorage.getItem("orbit:notif-dismissed")) checkAndShowBanner();
  } else {
    checkForStaleSubscription();
  }
});

// ── Write a Firestore notification record ─────────────────────────────────
// Exported so app.js can call it directly without the import() dynamic trick.
export async function saveNotifRecord(toUid, type, extra = {}) {
  if (!toUid || toUid === state.uid) return;
  try {
    await addDoc(collection(db, "notifications", toUid, "items"), {
      type,
      fromUid: state.uid,
      fromName: state.me?.name || "Someone",
      fromAvatar: state.me?.photoURL || "",
      read: false,
      createdAt: serverTimestamp(),
      ...extra,
    });
  } catch (err) {
    console.warn("Orbit: saveNotifRecord failed", err);
  }
}

// ── Send a push notification to another user ─────────────────────────────
export async function notifyUser(toUid, title, body, url = "/") {
  if (!toUid || toUid === state.uid) return;
  try {
    const snap = await getDoc(doc(db, "users", toUid));
    if (!snap.exists()) return;

    const subscription = snap.data().pushSubscription;
    if (!subscription) return;

    const res = await fetch("/api/send-notification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription, title, body, url }),
    });

    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      if (res.status === 410) {
        await setDoc(doc(db, "users", toUid), { pushSubscription: null }, { merge: true });
      }
      console.warn("Orbit: send-notification failed", res.status, json);
    }
  } catch (err) {
    console.warn("Orbit: notifyUser failed", err);
  }
}

// ── Send a test push to yourself ─────────────────────────────────────────
export async function sendTestNotification() {
  if (!state.uid) { showToastMsg("Not logged in"); return; }
  try {
    const snap = await getDoc(doc(db, "users", state.uid));
    if (!snap.exists()) { showToastMsg("User doc not found"); return; }

    const subscription = snap.data().pushSubscription;
    if (!subscription) {
      showToastMsg("No push subscription saved — tap Enable first");
      return;
    }

    showToastMsg("Sending test notification…");

    const res = await fetch("/api/send-notification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subscription,
        title: "Orbit test",
        body: "If you see this, push notifications are working!",
        url: "/",
      }),
    });

    const json = await res.json().catch(() => ({}));

    if (res.ok) {
      showToastMsg("Test sent! You should see a notification shortly.");
    } else {
      showToastMsg("Send failed: " + (json.error || res.status));
    }
  } catch (err) {
    showToastMsg("Error: " + (err.message || err));
  }
}

window._orbitTestNotif = sendTestNotification;
