/* =============================================================
   Drop — Notification module
   -------------------------------------------------------------
   Browser push notifications via Firebase Cloud Messaging (FCM).
   Free, unlimited, works on Android Chrome + desktop browsers.
   On iPhone, the user must "Add to Home Screen" first (Apple rule).

   USES:
     - The same Firebase project that app.js already uses
     - A VAPID key (generate in Firebase Console > Project Settings
       > Cloud Messaging > Web Push certificates > "Generate key pair")
     - A service worker file at /firebase-messaging-sw.js (required
       by the browser; sits next to index.html)

   PUBLIC API:
     Notifications.isSupported()        -> boolean
     Notifications.getStatus()          -> "granted" | "denied" | "default" | "unsupported"
     Notifications.enable(uid)          -> requests permission, saves token
     Notifications.disable(uid)         -> removes this device's token
     Notifications.initIfEnabled(uid)   -> silently re-arm on app load
     Notifications.onForeground(fn)     -> callback for in-app messages

   IMPORTANT — to actually SEND a push, you need a small backend
   (Firebase Cloud Functions, Vercel, or any server) that uses the
   Firebase Admin SDK to deliver to saved tokens. This file only
   handles the receiving side.
   ============================================================= */

import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
    getMessaging,
    getToken,
    onMessage,
    isSupported as isMessagingSupported,
    deleteToken
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging.js";
import {
    getFirestore,
    doc,
    setDoc,
    deleteDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let _firebaseConfig = null;
let _vapidKey = null;
let _messaging = null;
let _foregroundHandler = null;
let _currentToken = null;

/* ---------- Internal helpers ---------- */

function ensureApp() {
    if (getApps().length) return getApp();
    if (!_firebaseConfig) throw new Error("Notifications: configure() not called");
    return initializeApp(_firebaseConfig);
}

async function ensureMessaging() {
    if (_messaging) return _messaging;
    const supported = await isMessagingSupported().catch(() => false);
    if (!supported) return null;
    _messaging = getMessaging(ensureApp());
    // Foreground messages: browser won't show a popup while the tab is open,
    // so we surface them via the supplied callback (default = a small toast).
    onMessage(_messaging, (payload) => {
        try {
            if (typeof _foregroundHandler === "function") {
                _foregroundHandler(payload);
                return;
            }
            // Fallback: simple browser notification if we have permission
            const n = payload?.notification || {};
            if (Notification.permission === "granted" && n.title) {
                new Notification(n.title, { body: n.body || "", icon: n.icon || "/icon-192.png" });
            }
        } catch (err) {
            console.warn("Notifications foreground handler:", err);
        }
    });
    return _messaging;
}

async function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return null;
    // Firebase looks for this exact path by default. Keep the file at site root.
    try {
        return await navigator.serviceWorker.register("/firebase-messaging-sw.js");
    } catch (err) {
        console.warn("Notifications SW register failed:", err);
        return null;
    }
}

async function saveTokenToFirestore(uid, token) {
    if (!uid || !token) return;
    const db = getFirestore(ensureApp());
    // Tokens stored per-device under the user. Doc id = the token itself,
    // so re-saving the same device is idempotent.
    await setDoc(doc(db, "users", uid, "fcmTokens", token), {
        token,
        platform: navigator.userAgent || "web",
        createdAt: serverTimestamp(),
        lastSeen: serverTimestamp()
    }, { merge: true });
}

async function removeTokenFromFirestore(uid, token) {
    if (!uid || !token) return;
    const db = getFirestore(ensureApp());
    try { await deleteDoc(doc(db, "users", uid, "fcmTokens", token)); } catch {}
}

/* ---------- Public API ---------- */

export const Notifications = {
    /**
     * One-time configuration. Call once at app startup.
     * @param {object} cfg
     * @param {object} cfg.firebaseConfig - same object app.js uses
     * @param {string} cfg.vapidKey - Web Push certificate public key
     */
    configure({ firebaseConfig, vapidKey }) {
        _firebaseConfig = firebaseConfig;
        _vapidKey = vapidKey;
    },

    /**
     * Register a function that runs when a push arrives while the
     * tab is in the foreground. Receives the FCM payload.
     */
    onForeground(fn) { _foregroundHandler = fn; },

    /** True if this browser supports web push at all. */
    async isSupported() {
        if (!("Notification" in window)) return false;
        if (!("serviceWorker" in navigator)) return false;
        return await isMessagingSupported().catch(() => false);
    },

    /** Current permission state. */
    getStatus() {
        if (!("Notification" in window)) return "unsupported";
        return Notification.permission; // "granted" | "denied" | "default"
    },

    /**
     * Ask permission (if needed), get an FCM token, and save it for `uid`.
     * Returns the token string or null on failure / denial.
     */
    async enable(uid) {
        if (!_vapidKey) {
            console.warn("Notifications: missing VAPID key");
            return null;
        }
        const supported = await this.isSupported();
        if (!supported) return null;

        // Request permission. If user previously denied, this is a no-op
        // and they must re-enable in browser site settings.
        let perm = Notification.permission;
        if (perm === "default") perm = await Notification.requestPermission();
        if (perm !== "granted") return null;

        const reg = await registerServiceWorker();
        const messaging = await ensureMessaging();
        if (!messaging) return null;

        try {
            const token = await getToken(messaging, {
                vapidKey: _vapidKey,
                serviceWorkerRegistration: reg || undefined
            });
            if (!token) return null;
            _currentToken = token;
            await saveTokenToFirestore(uid, token);
            return token;
        } catch (err) {
            console.warn("Notifications enable failed:", err);
            return null;
        }
    },

    /**
     * Remove this device's token from Firestore so the server stops
     * sending pushes to it. Also revokes the local FCM token.
     */
    async disable(uid) {
        try {
            const messaging = await ensureMessaging();
            if (messaging && _currentToken) {
                try { await deleteToken(messaging); } catch {}
            }
            if (_currentToken) await removeTokenFromFirestore(uid, _currentToken);
            _currentToken = null;
        } catch (err) {
            console.warn("Notifications disable failed:", err);
        }
    },

    /**
     * On app load, if the user previously enabled push and the browser
     * still has permission, silently refresh the token (it can rotate)
     * and update Firestore. Never prompts.
     */
    async initIfEnabled(uid) {
        if (!_vapidKey || !uid) return;
        const supported = await this.isSupported();
        if (!supported) return;
        if (Notification.permission !== "granted") return;
        const reg = await registerServiceWorker();
        const messaging = await ensureMessaging();
        if (!messaging) return;
        try {
            const token = await getToken(messaging, {
                vapidKey: _vapidKey,
                serviceWorkerRegistration: reg || undefined
            });
            if (token) {
                _currentToken = token;
                await saveTokenToFirestore(uid, token);
            }
        } catch (err) {
            console.warn("Notifications refresh failed:", err);
        }
    }
};

export default Notifications;


