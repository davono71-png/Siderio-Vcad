"use client";

import { useEffect } from "react";
import { UPDATE_EVERY_MS, checkForAppUpdate } from "./update";

const RELOAD_KEY = "siderio-sw-reload";

export function RegisterSW() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") {
      navigator.serviceWorker.getRegistrations().then((regs) => {
        void Promise.all(regs.map((registration) => registration.unregister()));
      });
      return;
    }

    let reloading = false;
    const onController = () => {
      try {
        if (window.sessionStorage.getItem(RELOAD_KEY) === "1") return;
        window.sessionStorage.setItem(RELOAD_KEY, "1");
      } catch {
        /* private mode still reloads once in this document */
        if (reloading) return;
      }
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onController);

    const onVisible = () => {
      if (document.visibilityState === "visible") void checkForAppUpdate();
    };
    document.addEventListener("visibilitychange", onVisible);
    const interval = window.setInterval(() => void checkForAppUpdate(), UPDATE_EVERY_MS);
    void checkForAppUpdate();
    const clearGuard = window.setTimeout(() => {
      try {
        window.sessionStorage.removeItem(RELOAD_KEY);
        window.sessionStorage.removeItem("siderio-chunk-reload");
      } catch {
        /* private mode */
      }
    }, 8000);

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onController);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(interval);
      window.clearTimeout(clearGuard);
    };
  }, []);
  return null;
}
