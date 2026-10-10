const CACHE = "siderio-vcad-v7";
const PRECACHE = [
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
      .then(() => self.clients.claim())
      .then(async () => {
        const clients = await self.clients.matchAll({ type: "window" });
        for (const client of clients) client.postMessage({ type: "sw-activated" });
      }),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  event.respondWith(handle(req, url));
});

async function handle(req, url) {
  if (req.mode === "navigate" || req.destination === "document") {
    const fresh = await freshDocument(req);
    return fresh ?? offlineDocument();
  }
  if (url.pathname === "/sw.js" || url.pathname === "/manifest.webmanifest") {
    return fetch(req);
  }
  if (isStatic(url)) {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req);
    if (hit) return hit;
    try {
      const fresh = await fetch(req);
      if (fresh.ok) {
        try {
          await cache.put(req, fresh.clone());
        } catch {
          /* A full disk must not hide the response. */
        }
      }
      return fresh;
    } catch {
      return (await cache.match(req)) ?? Response.error();
    }
  }
  try {
    return await fetch(req);
  } catch {
    return Response.error();
  }
}

async function freshDocument(req) {
  try {
    return await fetch(req, { cache: "no-store" });
  } catch {
    try {
      return await fetch(req);
    } catch {
      return null;
    }
  }
}

function isStatic(url) {
  return url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/") || url.pathname.startsWith("/brand/");
}

function offlineDocument() {
  const html = `<!doctype html><html lang="it"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Siderio</title><body style="font-family:sans-serif;padding:24px"><h1>Siderio</h1><p>Serve la rete per aprire l’app. Riapri quando la connessione c’è.</p></body></html>`;
  return new Response(html, {
    status: 503,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
