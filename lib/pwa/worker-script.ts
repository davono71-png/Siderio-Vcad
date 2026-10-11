/** Service worker source. The cache name is the build id, so a deploy drops the previous HTML. */
export function serviceWorkerScript(buildId: string) {
  const cache = `siderio-vcad-${buildId.replace(/[^a-z0-9]/gi, "").slice(0, 12) || "local"}`;
  return `const CACHE = ${JSON.stringify(cache)};
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
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  if (url.pathname === "/sw.js" || url.pathname === "/manifest.webmanifest") return;
  if (req.mode === "navigate" || req.destination === "document") {
    event.waitUntil(self.registration.update().catch(() => undefined));
  }
  event.respondWith(handle(req, url));
});

async function handle(req, url) {
  if (req.mode === "navigate" || req.destination === "document") return networkDocument(req);
  if (isStatic(url)) return staticAsset(req);
  try {
    return await fetch(req);
  } catch {
    return Response.error();
  }
}

async function networkDocument(req) {
  const key = cacheKey(req);
  try {
    return await storeDocument(req, key, await fetch(req, { cache: "no-store" }));
  } catch {
    try {
      return await storeDocument(req, key, await fetch(req));
    } catch {
      const cached = (await caches.match(key)) || (await caches.match(cacheKeyUrl(new URL("/", self.location.origin))));
      return cached || offlineDocument();
    }
  }
}

async function storeDocument(req, key, fresh) {
  const type = fresh.headers.get("content-type") || "";
  if (fresh.ok && type.includes("text/html")) {
    try {
      const cache = await caches.open(CACHE);
      await cache.put(key, fresh.clone());
    } catch {
      /* Quota or a navigate request must not hide the network page. */
    }
  }
  return fresh;
}

async function staticAsset(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const fresh = await fetch(req);
    if (fresh.ok) {
      try {
        await cache.put(req, fresh.clone());
      } catch {
        /* A full disk must not hide the file. */
      }
    }
    return fresh;
  } catch {
    return (await cache.match(req)) ?? Response.error();
  }
}

function cacheKey(req) {
  return cacheKeyUrl(new URL(req.url));
}

function cacheKeyUrl(url) {
  return new Request(url.origin + url.pathname + url.search);
}

function isStatic(url) {
  return url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/") || url.pathname.startsWith("/brand/");
}

function offlineDocument() {
  const html = "<!doctype html><html lang=\\"it\\"><meta charset=\\"utf-8\\"><meta name=\\"viewport\\" content=\\"width=device-width,initial-scale=1\\"><title>Siderio</title><body style=\\"font-family:sans-serif;padding:24px\\"><h1>Siderio</h1><p>Serve la rete per aprire l’app. Riapri quando la connessione c’è.</p></body></html>";
  return new Response(html, {
    status: 503,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
`;
}
