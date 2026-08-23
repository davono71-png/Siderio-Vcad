"use client";

import { useEffect, useRef } from "react";
import type { DrawingEngine } from "@/lib/drawing/engine";

export function DrawingSurface({
  engine,
  className = "",
}: {
  engine: DrawingEngine | null;
  className?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const inkRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const raf = useRef<number>(0);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || !engine) return;

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      for (const canvas of [baseRef.current, inkRef.current, overlayRef.current]) {
        if (!canvas) continue;
        canvas.width = Math.max(1, Math.round(rect.width * dpr));
        canvas.height = Math.max(1, Math.round(rect.height * dpr));
        canvas.style.width = `${rect.width}px`;
        canvas.style.height = `${rect.height}px`;
      }
      engine.dpr = dpr;
      const needsFit = engine.viewW < 8 || engine.viewH < 8;
      engine.viewW = rect.width;
      engine.viewH = rect.height;
      if (needsFit) engine.fitToView(rect.width, rect.height);
      else engine.dirtyFull = true;
      paintAll();
    };

    const paintBase = () => {
      const ctx = baseRef.current?.getContext("2d");
      if (ctx) engine.renderBase(ctx);
    };
    const paintInk = () => {
      const ctx = inkRef.current?.getContext("2d");
      if (ctx) engine.renderInk(ctx);
    };
    const paintOverlay = () => {
      const ctx = overlayRef.current?.getContext("2d");
      if (ctx) engine.renderOverlay(ctx);
    };
    const paintAll = () => {
      paintBase();
      paintInk();
      paintOverlay();
      engine.dirtyFull = false;
      engine.dirtyInk = false;
    };

    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = wrap.getBoundingClientRect();
      engine.zoomAt(
        e.clientX - rect.left,
        e.clientY - rect.top,
        e.deltaY > 0 ? 0.92 : 1.08,
      );
    };
    wrap.addEventListener("wheel", wheel, { passive: false });

    const unsub = engine.onChange(() => {
      if (engine.isLive) {
        if (engine.dirtyFull) {
          paintBase();
          paintInk();
          engine.dirtyFull = false;
        }
        cancelAnimationFrame(raf.current);
        raf.current = requestAnimationFrame(paintOverlay);
        return;
      }
      paintAll();
    });

    const host = wrap;
    const down = (e: PointerEvent) => {
      e.preventDefault();
      engine.pointerDown(e, host);
    };
    const move = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.buttons) e.preventDefault();
      engine.pointerMove(e);
    };
    const up = (e: PointerEvent) => engine.pointerUp(e);
    const cancel = (e: PointerEvent) => engine.pointerCancel(e);
    const blockMenu = (ev: Event) => ev.preventDefault();
    const opts: AddEventListenerOptions = { passive: false };
    host.addEventListener("pointerdown", down, opts);
    host.addEventListener("pointermove", move, opts);
    host.addEventListener("pointerup", up);
    host.addEventListener("pointercancel", cancel);
    host.addEventListener("lostpointercapture", cancel);
    host.addEventListener("contextmenu", blockMenu);

    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    window.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("resize", resize);
    resize();
    const retries = [80, 250, 600].map((ms) => window.setTimeout(resize, ms));

    return () => {
      unsub();
      ro.disconnect();
      retries.forEach((id) => window.clearTimeout(id));
      window.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("resize", resize);
      wrap.removeEventListener("wheel", wheel);
      host.removeEventListener("pointerdown", down);
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerup", up);
      host.removeEventListener("pointercancel", cancel);
      host.removeEventListener("lostpointercapture", cancel);
      host.removeEventListener("contextmenu", blockMenu);
      cancelAnimationFrame(raf.current);
    };
  }, [engine]);

  return (
    <div
      ref={wrapRef}
      className={`draw-wrap ${className}`}
    >
      <canvas ref={baseRef} className="pointer-events-none absolute inset-0" />
      <canvas ref={inkRef} className="pointer-events-none absolute inset-0" />
      <canvas ref={overlayRef} className="pointer-events-none absolute inset-0" />
    </div>
  );
}
