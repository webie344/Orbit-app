// =========================================================================
// Orbit — sw.js  (Service Worker)
// Caches the app shell for offline use + fast repeat loads.
// Place this file at the ROOT of your site (same level as index.html).
// =========================================================================

const CACHE_NAME = "orbit-v2";

// Files that make up the app shell — always available offline
const SHELL_FILES = [
  "/",
  "/index.html",
  "/style.css",
  "/chat.css",
  "/app.js",
  "/chat.js",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
  "/notifications.js",
];

// ── Push: receive and display notification ────────────────────────────────
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch {}

  const title   = data.title || "Orbit";
  const options = {
    body:    data.body  || "",
    icon:    data.icon  || "/icon-192.png",
    badge:              "/icon-192.png",
    data:    { url: data.url || "/" },
    vibrate: [100, 50, 100],
    requireInteraction: false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ── Notification click: open the app at the right URL ────────────────────
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      // If app is already open, focus it and navigate
      for (const client of list) {
        if ("focus" in client) {
          client.focus();
          client.navigate(url);
          return;
        }
      }
      // Otherwise open a new window
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

// ── Install: cache the shell ─────────────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

// ── Activate: remove old caches ──────────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// ── Fetch: network-first for API/Firebase, cache-first for shell ─────────
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Always go network-first for Firebase, Cloudinary, fonts, and CDN
  const networkOnly =
    url.hostname.includes("firebase") ||
    url.hostname.includes("firestore") ||
    url.hostname.includes("googleapis") ||
    url.hostname.includes("cloudinary") ||
    url.hostname.includes("gstatic") ||
    url.hostname.includes("jsdelivr") ||
    url.hostname.includes("unpkg") ||
    url.hostname.includes("dicebear");

  if (networkOnly) {
    event.respondWith(fetch(request));
    return;
  }

  // Cache-first for everything else (shell files, icons, local CSS/JS)
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request)
        .then((response) => {
          // Only cache valid same-origin responses
          if (
            !response ||
            response.status !== 200 ||
            response.type === "opaque"
          ) {
            return response;
          }
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => {
          // Offline fallback: serve index.html for navigation requests
          if (request.mode === "navigate") {
            return caches.match("/index.html");
          }
        });
    })
  );
});
