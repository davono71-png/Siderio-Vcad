const CACHE = "siderio-vcad-v4";
const PRECACHE = [
  "/",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
  "/brand/siderio-icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const navigate = req.mode === "navigate";
  const immutable = url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/") || url.pathname.startsWith("/brand/");

  event.respondWith(
    (async () => {
      if (navigate) {
        try {
          const fresh = await fetch(req, { cache: "no-store" });
          if (fresh.ok) {
            const cache = await caches.open(CACHE);
            await cache.put(req, fresh.clone());
          }
          return fresh;
        } catch {
          return (await caches.match(req)) ?? (await caches.match("/")) ?? Response.error();
        }
      }

      const cache = await caches.open(CACHE);
      if (immutable) {
        const hit = await cache.match(req);
        if (hit) return hit;
      }
      try {
        const fresh = await fetch(req);
        if (fresh.ok) await cache.put(req, fresh.clone());
        return fresh;
      } catch {
        return (await cache.match(req)) ?? Response.error();
      }
    })(),
  );
});
