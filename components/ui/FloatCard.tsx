"use client";

import { useEffect, useRef, useState } from "react";

type Pos = { x: number; y: number };

export function FloatCard({
  id,
  title,
  defaultPos,
  width = 240,
  anchor = "left",
  children,
}: {
  id: string;
  title: string;
  defaultPos: Pos;
  width?: number;
  anchor?: "left" | "right";
  children: React.ReactNode;
}) {
  const [pos, setPos] = useState(defaultPos);
  const [z, setZ] = useState(24);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const posRef = useRef(pos);
  posRef.current = pos;

  useEffect(() => {
    try {
      const raw = localStorage.getItem(`vcad-card-${id}`);
      if (raw) {
        const saved = JSON.parse(raw) as Pos;
        if (Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
          setPos(clamp(saved, width));
          return;
        }
      }
    } catch {
      /* ignore */
    }
    if (anchor === "right") {
      setPos(clamp({ x: window.innerWidth - width - 16, y: defaultPos.y }, width));
    }
  }, [id, anchor, defaultPos.y, width]);

  function moveTo(next: Pos) {
    const clamped = clamp(next, width);
    posRef.current = clamped;
    setPos(clamped);
  }

  function persist() {
    try {
      localStorage.setItem(`vcad-card-${id}`, JSON.stringify(posRef.current));
    } catch {
      /* ignore */
    }
  }

  return (
    <aside
      className="float-card"
      style={{ left: pos.x, top: pos.y, width, zIndex: z }}
      onPointerDown={() => setZ(36)}
    >
      <header
        className="float-card-head"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { dx: e.clientX - posRef.current.x, dy: e.clientY - posRef.current.y };
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          moveTo({ x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy });
        }}
        onPointerUp={() => {
          drag.current = null;
          persist();
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <span>{title}</span>
        <span className="float-card-grip" aria-hidden />
      </header>
      <div className="float-card-body">{children}</div>
    </aside>
  );
}

function clamp(pos: Pos, width: number): Pos {
  const maxX = Math.max(8, (typeof window === "undefined" ? 1200 : window.innerWidth) - width - 8);
  const maxY = Math.max(8, (typeof window === "undefined" ? 800 : window.innerHeight) - 48);
  return {
    x: Math.min(maxX, Math.max(8, pos.x)),
    y: Math.min(maxY, Math.max(8, pos.y)),
  };
}
