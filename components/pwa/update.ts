"use client";

const UPDATE_EVERY_MS = 30 * 60 * 1000;

export { UPDATE_EVERY_MS };

export async function checkForAppUpdate() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  const registration = await navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" });
  await registration.update();
  if (registration.waiting) registration.waiting.postMessage({ type: "SKIP_WAITING" });
  return registration;
}

export async function updateAppNow() {
  const registration = await checkForAppUpdate();
  const installing = registration?.installing ?? null;
  if (installing) {
    await new Promise<void>((resolve) => {
      installing.addEventListener("statechange", () => {
        if (installing.state === "installed" || installing.state === "activated" || installing.state === "redundant") resolve();
      });
      window.setTimeout(resolve, 1500);
    });
  }
  registration?.waiting?.postMessage({ type: "SKIP_WAITING" });
  window.setTimeout(() => window.location.reload(), 300);
}

/** Drops the service worker and Cache Storage. IndexedDB surveys stay. */
export async function resetAppCache() {
  if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
  }
  if (typeof caches !== "undefined") {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  }
  window.location.reload();
}
