const CACHE = "siderio-vcad-v3";
const PRECACHE = [
  "/",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/brand/siderio-icon.svg",
  "/samples/piano-terra.dxf",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const navigate = req.mode === "navigate";
  event.respondWith(
    (async () => {
      if (navigate || url.pathname === "/sw.js") {
        try {
          const fresh = await fetch(req, { cache: "no-store" });
          if (fresh.ok && navigate) {
            const cache = await caches.open(CACHE);
            cache.put("/", fresh.clone());
          }
          return fresh;
        } catch {
          const cached = await caches.match("/");
          return cached ?? Response.error();
        }
      }
      const cache = await caches.open(CACHE);
      try {
        const fresh = await fetch(req);
        if (fresh.ok) cache.put(req, fresh.clone());
        return fresh;
      } catch {
        return (await cache.match(req)) ?? Response.error();
      }
    })(),
  );
});
