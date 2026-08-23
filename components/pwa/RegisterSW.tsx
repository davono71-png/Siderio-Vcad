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
    const run = async () => {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.update()));
      await navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" });
    };
    run().catch(() => {
      /* offline install is best-effort */
    });
  }, []);
  return null;
}
