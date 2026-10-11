"use client";

import { useEffect, useRef, useState } from "react";

export function isStandaloneDisplay() {
  if (typeof window === "undefined") return false;
  const ios = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return ios || window.matchMedia("(display-mode: standalone)").matches || window.matchMedia("(display-mode: fullscreen)").matches;
}

/** Pull down from the top of a list. Installed PWA only; editors do not mount this. */
export function usePullToRefresh(onRefresh: () => void) {
  const [refreshing, setRefreshing] = useState(false);
  const refreshRef = useRef(onRefresh);
  useEffect(() => {
    refreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    if (!isStandaloneDisplay()) return;
    let startY = 0;
    let tracking = false;
    let armed = false;

    const onStart = (event: TouchEvent) => {
      if (window.scrollY > 2) return;
      const target = event.target;
      if (target instanceof Element && target.closest("input, textarea, select, button, a, canvas")) return;
      startY = event.touches[0]?.clientY ?? 0;
      tracking = true;
      armed = false;
    };
    const onMove = (event: TouchEvent) => {
      if (!tracking || window.scrollY > 2) return;
      const y = event.touches[0]?.clientY ?? startY;
      if (y - startY > 72) armed = true;
    };
    const onEnd = () => {
      if (tracking && armed) {
        setRefreshing(true);
        refreshRef.current();
        window.setTimeout(() => setRefreshing(false), 900);
      }
      tracking = false;
      armed = false;
    };

    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: true });
    document.addEventListener("touchend", onEnd);
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
    };
  }, []);

  return refreshing;
}
