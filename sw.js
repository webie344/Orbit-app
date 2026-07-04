// =========================================================================
// Orbit — sw.js  (Service Worker)
// Caches the app shell for offline use + fast repeat loads.
// Place this file at the ROOT of your site (same level as index.html).
// =========================================================================

// ⚠️  Bump this string every time you deploy — it's what triggers the
//     "New version available" update banner in the app.
const CACHE_NAME = "orbit-v5";

// Files that make up the app shell — always available offline
const SHELL_FILES = [
  "/",
  "/index.html",
  "/style.css",
  "/chat.css",
  "/app.js",
  "/chat.js",
  "/additional.js",
  "/notifications.js",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
];

// ── Message: allow the page to trigger skipWaiting on demand ─────────────
//
//  This is what makes the "Update now" banner work.
//  index.html calls: worker.postMessage({ type: "SKIP_WAITING" })
//  which lands here and activates the waiting SW immediately.
//
//  ⚠️  Do NOT call self.skipWaiting() inside the install handler —
//      that bypasses the waiting state and the update banner never shows.
//
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

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

  // If the sender attached a media thumbnail (post image, chat photo, etc.)
  // show it as the large preview image inside the notification body.
  // Supported on Android Chrome; ignored gracefully elsewhere.
  if (data.image) {
    options.image = data.image;
  }

  event.waitUntil(self.registration.showNotification(title, options));
});

// ── Notification click: open the app at the right URL ────────────────────
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) {
          client.focus();
          client.navigate(url);
          return;
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

// ── Install: cache the shell ─────────────────────────────────────────────
//
//  No self.skipWaiting() here — the new SW stays in "waiting" state so
//  the update banner in index.html can prompt the user before taking over.
//
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
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
          if (request.mode === "navigate") {
            return caches.match("/index.html");
          }
        });
    })
  );
});
