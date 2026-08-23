"use client";

import type { PenPrefs } from "@/lib/models/types";
import {
  ERASER_SIZES,
  HIGHLIGHTER_WIDTHS,
  INK_COLORS,
  PEN_STYLES,
  TECHNICAL_WIDTHS,
  normalizePenKind,
} from "@/lib/models/defaults";
import { IconEraser, IconFountain, IconHighlighter, IconPen, IconPencil } from "../brand/Icons";

export function StyleDock({
  prefs,
  onPrefs,
}: {
  prefs: PenPrefs;
  onPrefs: (next: Partial<PenPrefs>) => void;
}) {
  const kind = normalizePenKind(prefs.penKind);
  const widths = kind === "highlighter" ? HIGHLIGHTER_WIDTHS : TECHNICAL_WIDTHS;
  const currentWidth = kind === "highlighter" ? prefs.highlighterWidth : prefs.width;

  return (
    <div className="style-stack" aria-label="Stile penna e gomma">
      <p className="card-kicker">Stile</p>
      <div className="style-row">
        {PEN_STYLES.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`style-btn ${kind === s.id ? "is-on" : ""}`}
            onClick={() => onPrefs({ tool: s.id, penKind: s.id })}
          >
            {s.id === "ballpoint" ? (
              <IconPen className="h-4 w-4" />
            ) : s.id === "fountain" ? (
              <IconFountain className="h-4 w-4" />
            ) : s.id === "pencil" ? (
              <IconPencil className="h-4 w-4" />
            ) : (
              <IconHighlighter className="h-4 w-4" />
            )}
            {s.label}
          </button>
        ))}
      </div>
      <div className="style-row">
        {widths.map((w) => (
          <button
            key={w}
            type="button"
            className={`chip ${currentWidth === w ? "chip-on" : ""}`}
            onClick={() =>
              kind === "highlighter"
                ? onPrefs({ highlighterWidth: w, tool: "highlighter", penKind: "highlighter" })
                : onPrefs({ width: w })
            }
          >
            {w}px
          </button>
        ))}
      </div>
      <div className="style-row">
        {INK_COLORS.map((c) => (
          <button
            key={c.id}
            type="button"
            title={c.label}
            onClick={() => onPrefs({ color: c.value })}
            className={`h-7 w-7 rounded-full border ${
              prefs.color === c.value ? "ring-2 ring-[var(--accent)] ring-offset-1" : "border-black/10"
            }`}
            style={{ background: c.value }}
          />
        ))}
      </div>
      <div className="style-row">
        <button
          type="button"
          className={`style-btn ${prefs.tool === "eraser" && prefs.eraserMode === "stroke" ? "is-on" : ""}`}
          onClick={() => onPrefs({ tool: "eraser", eraserMode: "stroke" })}
          title="Cancella il tratto intero"
        >
          <IconEraser className="h-4 w-4" />
          Tratto
        </button>
        <button
          type="button"
          className={`style-btn ${prefs.tool === "eraser" && prefs.eraserMode === "free" ? "is-on" : ""}`}
          onClick={() => onPrefs({ tool: "eraser", eraserMode: "free" })}
          title="Cancella solo l'area sotto il cursore"
        >
          <IconEraser className="h-4 w-4" />
          Area
        </button>
      </div>
      {prefs.tool === "eraser" && prefs.eraserMode === "free" ? (
        <div className="style-row">
          {ERASER_SIZES.map((s) => (
            <button
              key={s}
              type="button"
              className={`chip ${prefs.eraserSize === s ? "chip-on" : ""}`}
              onClick={() => onPrefs({ eraserSize: s })}
            >
              {s}px
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
