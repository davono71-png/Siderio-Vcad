"use client";

import { useEffect, useState } from "react";

export type DeviceLayout =
  | "cover"
  | "inner-fold"
  | "tablet-portrait"
  | "tablet-landscape"
  | "desktop";

function compute(): DeviceLayout {
  if (typeof window === "undefined") return "desktop";
  const w = window.innerWidth;
  const h = window.innerHeight;
  const aspect = w / Math.max(h, 1);
  const segments =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(horizontal-viewport-segments: 2)").matches;

  if (segments) return "inner-fold";

  // Galaxy Z Fold8 Ultra cover ~409×955 CSS px, 21:9.
  if (w <= 480 && aspect < 0.55) return "cover";

  // Fold8 Ultra inner ~855×949 CSS px, ~10:9.
  if (w >= 680 && w <= 1100 && aspect >= 0.82 && aspect <= 1.2) return "inner-fold";

  if (w >= 700 && aspect < 1) return "tablet-portrait";
  if (w >= 700 && aspect >= 1) return "tablet-landscape";
  if (w < 700) return "cover";
  return "desktop";
}

export function useDeviceLayout(): DeviceLayout {
  const [layout, setLayout] = useState<DeviceLayout>("desktop");
  useEffect(() => {
    const apply = () => setLayout(compute());
    apply();
    window.addEventListener("resize", apply);
    window.addEventListener("orientationchange", apply);
    return () => {
      window.removeEventListener("resize", apply);
      window.removeEventListener("orientationchange", apply);
    };
  }, []);
  return layout;
}
