"use client";

import { useRef } from "react";
import type { SurveyPage } from "@/lib/models/types";
import { IconPlus } from "../brand/Icons";

export function PageDock({
  pages,
  currentId,
  onSelect,
  onAdd,
  onEditBackground,
}: {
  pages: SurveyPage[];
  currentId: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onEditBackground: (id: string) => void;
}) {
  const sorted = [...pages].sort((a, b) => a.order - b.order);
  const long = useRef<{ id: string; x: number; y: number } | null>(null);
  const timer = useRef<number>(0);
  const fired = useRef(false);

  function startPress(id: string, e: React.PointerEvent) {
    fired.current = false;
    long.current = { id, x: e.clientX, y: e.clientY };
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      fired.current = true;
      onEditBackground(id);
    }, 520);
  }

  function movePress(e: React.PointerEvent) {
    if (!long.current) return;
    if (Math.hypot(e.clientX - long.current.x, e.clientY - long.current.y) > 10) {
      window.clearTimeout(timer.current);
      long.current = null;
    }
  }

  function endPress(id: string) {
    window.clearTimeout(timer.current);
    if (!fired.current) onSelect(id);
    long.current = null;
  }

  return (
    <div className="page-card-list">
      <button type="button" className="page-thumb page-add" onClick={onAdd} title="Aggiungi pagina">
        <IconPlus className="h-4 w-4" />
      </button>
      {sorted.map((page, i) => {
        const active = page.id === currentId;
        return (
          <button
            key={page.id}
            type="button"
            className={`page-thumb ${active ? "is-active" : ""}`}
            onPointerDown={(e) => startPress(page.id, e)}
            onPointerMove={movePress}
            onPointerUp={() => endPress(page.id)}
            onPointerCancel={() => {
              window.clearTimeout(timer.current);
              long.current = null;
            }}
          >
            <span className="page-preview">
              {page.paper === "grid" ? "▦" : page.paper === "lined" ? "☰" : "☐"}
            </span>
            <span className="page-num">{i + 1}</span>
          </button>
        );
      })}
    </div>
  );
}
