"use client";

import { useEffect } from "react";

export function RegisterSW() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") {
      navigator.serviceWorker.getRegistrations().then((regs) => {
        void Promise.all(regs.map((r) => r.unregister()));
      });
      return;
    }
    let reloading = false;
    const onController = () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };
    // A new worker calls skipWaiting + clients.claim. Reload once so this tab
    // drops the previous JavaScript (and its IndexedDB connection) instead of
    // mixing cached chunks with the new build.
    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.addEventListener("controllerchange", onController);
    }
    const run = async () => {
      const registration = await navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" });
      await registration.update();
    };
    run().catch(() => {
      /* offline install is best-effort */
    });
    return () => navigator.serviceWorker.removeEventListener("controllerchange", onController);
  }, []);
  return null;
}
