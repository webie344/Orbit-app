// =========================================================================
// Get better — sw.js  (Service Worker)
// Offline support + fast repeat loads + push notifications + update banner.
// Place this file at the ROOT of your site (same level as index.html).
// =========================================================================

// ⚠️  Bump this string every time you deploy — it triggers the
//     "New version available" update banner in the app.
const CACHE_NAME = "getbetter-v16";
const IMG_CACHE  = "getbetter-img";   // photos only (kept across versions, capped)

// App shell — saved on install so the app opens with no data.
// Missing files are skipped (one 404 will not break the install).
const SHELL_FILES = [
  "/", "/index.html", "/manifest.json",
  "/style.css", "/chat.css", "/features.css",
  "/app.js", "/chat.js", "/additional.js", "/notifications.js", "/features.js", "/b.js", "/sounds.js",
  "/icon.svg", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png",
];

// Live data / login / uploads / AI: never cached here (Firestore keeps its own offline copy).
const NEVER_CACHE =
  /(firestore\.googleapis\.com|identitytoolkit|securetoken|firebaseinstallations|firebaseio|api\.groq\.com|api\.cloudinary\.com|google-analytics|googletagmanager|\/api\/)/;

// ── Message: skip waiting on demand + page can hand us files to save ─────
self.addEventListener("message", (event) => {
  const d = event.data || {};
  if (d.type === "SKIP_WAITING") self.skipWaiting();
  if (d.type === "cache-urls") {
    event.waitUntil((async () => {
      const cache = await caches.open(CACHE_NAME);
      await Promise.allSettled((d.urls || [])
        .filter((u) => !NEVER_CACHE.test(u))
        .map(async (u) => {
          if (await cache.match(u)) return;
          const r = await fetch(u);
          if (r.ok) await cache.put(u, r);
        }));
    })());
  }
});

// ── Push: receive and display notification ───────────────────────────────
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch {}
  const options = {
    body: data.body || "",
    icon: data.icon || "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: data.url || "/" },
    vibrate: [100, 50, 100],
    requireInteraction: false,
  };
  if (data.image) options.image = data.image;
  event.waitUntil(self.registration.showNotification(data.title || "Get better", options));
});

// ── Notification click ───────────────────────────────────────────────────
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) { client.focus(); client.navigate(url); return; }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

// ── Install: save the shell (no skipWaiting — the update banner asks first)
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.allSettled(SHELL_FILES.map((u) => cache.add(new Request(u, { cache: "reload" }))));
    // Also save every script / stylesheet / font the HTML links to (Firebase SDK, icons, fonts…)
    try {
      const html = await (await fetch("/", { cache: "reload" })).text();
      const urls = [...html.matchAll(/(?:src|href)=["']([^"'#]+)["']/g)].map((m) => m[1])
        .filter((u) => /\.(js|css|woff2?)(\?|$)/i.test(u) || /fonts\.googleapis|remixicon/i.test(u));
      await Promise.allSettled(urls.map((u) => cache.add(new Request(new URL(u, self.location.origin).href))));
    } catch {}
  })());
});

// ── Activate: remove old caches, then claim all clients ──────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME && k !== IMG_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function trim(name, max) {
  const c = await caches.open(name), keys = await c.keys();
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}

// ── Fetch ────────────────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const req = event.request, url = new URL(req.url);

  if (url.searchParams.has("_")) return;                       // connectivity pings go straight out
  if (req.method !== "GET" || !/^https?:$/.test(url.protocol)) return;
  if (NEVER_CACHE.test(req.url) || req.headers.has("range")) return;
  if (req.destination === "audio" || req.destination === "video") return;   // too big to store

  // Photos (avatars, covers): saved copy first, capped at 150
  if (req.destination === "image") {
    event.respondWith((async () => {
      const hit = await caches.match(req); if (hit) return hit;
      try {
        const r = await fetch(req);
        if (r.ok || r.type === "opaque") { (await caches.open(IMG_CACHE)).put(req, r.clone()); trim(IMG_CACHE, 150); }
        return r;
      } catch { return Response.error(); }
    })());
    return;
  }

  const sameOrigin = url.origin === self.location.origin;

  // Your own files (pages, JS, CSS): network first so updates always arrive, saved copy when offline
  if (sameOrigin) {
    event.respondWith((async () => {
      try {
        const r = await fetch(req);
        if (r.ok) { const c = await caches.open(CACHE_NAME); c.put(req.mode === "navigate" ? "/" : req, r.clone()); }
        return r;
      } catch {
        return (await caches.match(req)) ||
          (req.mode === "navigate" ? ((await caches.match("/")) || (await caches.match("/index.html"))) : null) ||
          Response.error();
      }
    })());
    return;
  }

  // Libraries & fonts from CDNs (Firebase SDK, icon font, highlight.js…): saved copy first, refresh quietly
  event.respondWith((async () => {
    const c = await caches.open(CACHE_NAME), hit = await c.match(req);
    const net = fetch(req).then((r) => { if (r.ok || r.type === "opaque") c.put(req, r.clone()); return r; }).catch(() => null);
    return hit || (await net) || Response.error();
  })());
});
