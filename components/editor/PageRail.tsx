"use client";

import type { SurveyPage } from "@/lib/models/types";
import { IconPlus } from "../brand/Icons";

export function PageRail({
  pages,
  currentId,
  compact,
  onSelect,
  onAdd,
  onRename,
  onDuplicate,
  onDelete,
  onMove,
}: {
  pages: SurveyPage[];
  currentId: string;
  compact?: boolean;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRename: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
}) {
  const sorted = [...pages].sort((a, b) => a.order - b.order);
  return (
    <aside
      className={
        compact
          ? "flex gap-2 overflow-x-auto px-2 py-2"
          : "flex h-full w-[7.5rem] shrink-0 flex-col gap-2 overflow-y-auto border-r border-ink/10 bg-paper-dark/50 p-2"
      }
    >
      {sorted.map((page, i) => {
        const active = page.id === currentId;
        return (
          <div
            key={page.id}
            className={`shrink-0 rounded-xl p-1.5 ${active ? "bg-white ring-2 ring-accent" : "bg-white/60"}`}
          >
            <button
              type="button"
              onClick={() => onSelect(page.id)}
              className={compact ? "w-24 text-left" : "w-full text-left"}
            >
              <div className="flex aspect-[3/4] items-center justify-center rounded-md bg-[#FFFBF5] text-[10px] text-ink/45 ring-1 ring-ink/10">
                {page.paper === "grid"
                  ? "Quadretti"
                  : page.paper === "lined"
                    ? "Righe"
                    : "Bianca"}
              </div>
              <div className="mt-1 truncate text-[11px] font-medium text-ink">
                {page.title ?? `Pagina ${i + 1}`}
              </div>
            </button>
            {active && !compact ? (
              <div className="mt-1 grid grid-cols-2 gap-1 text-[10px]">
                <button type="button" className="btn-mini" onClick={() => onRename(page.id)}>
                  Nome
                </button>
                <button type="button" className="btn-mini" onClick={() => onDuplicate(page.id)}>
                  Copia
                </button>
                <button type="button" className="btn-mini" onClick={() => onMove(page.id, -1)}>
                  Su
                </button>
                <button type="button" className="btn-mini" onClick={() => onMove(page.id, 1)}>
                  Giù
                </button>
                <button
                  type="button"
                  className="btn-mini col-span-2 text-danger"
                  onClick={() => onDelete(page.id)}
                >
                  Elimina
                </button>
              </div>
            ) : null}
          </div>
        );
      })}
      <button
        type="button"
        onClick={onAdd}
        className="flex h-16 shrink-0 items-center justify-center gap-1 rounded-xl border border-dashed border-ink/25 bg-white/40 text-sm font-medium text-ink"
      >
        <IconPlus className="h-5 w-5" />
        Pagina
      </button>
    </aside>
  );
}
