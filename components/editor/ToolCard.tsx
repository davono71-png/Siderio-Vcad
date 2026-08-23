"use client";

import type { DrawTool, PenPrefs } from "@/lib/models/types";
import { normalizePenKind } from "@/lib/models/defaults";
import {
  IconCamera,
  IconEraser,
  IconPen,
  IconRuler,
  IconSelect,
} from "../brand/Icons";
import { StyleDock } from "./StyleDock";

export function ToolCard({
  tool,
  prefs,
  onPen,
  onEraser,
  onMeasure,
  onSelect,
  onCamera,
  onPrefs,
}: {
  tool: DrawTool;
  prefs: PenPrefs;
  onPen: () => void;
  onEraser: () => void;
  onMeasure: () => void;
  onSelect: () => void;
  onCamera: () => void;
  onPrefs: (next: Partial<PenPrefs>) => void;
}) {
  const penna = tool !== "eraser" && tool !== "select" && tool !== "measure";

  return (
    <>
      <div className="tool-grid">
        <ToolBtn attivo={penna} label="Penna" onClick={onPen}>
          <IconPen className="h-5 w-5" />
        </ToolBtn>
        <ToolBtn attivo={tool === "eraser"} label="Gomma" onClick={onEraser}>
          <IconEraser className="h-5 w-5" />
        </ToolBtn>
        <ToolBtn attivo={tool === "measure"} label="Quote" onClick={onMeasure}>
          <IconRuler className="h-5 w-5" />
        </ToolBtn>
        <ToolBtn attivo={tool === "select"} label="Seleziona" onClick={onSelect}>
          <IconSelect className="h-5 w-5" />
        </ToolBtn>
        <ToolBtn attivo={false} label="Foto" onClick={onCamera}>
          <IconCamera className="h-5 w-5" />
        </ToolBtn>
      </div>
      <StyleDock prefs={prefs} onPrefs={onPrefs} />
      {penna ? (
        <p className="card-hint">
          Inchiostro: {normalizePenKind(prefs.penKind)} · {prefs.width}px
        </p>
      ) : null}
      {tool === "measure" ? (
        <p className="card-hint">
          Due click sugli estremi, il terzo sopra o sotto. Tasto destro: salta lo scostamento e vai alla prossima. Verde se entrambi agganciano il DXF.
        </p>
      ) : null}
    </>
  );
}

function ToolBtn({
  attivo,
  label,
  onClick,
  children,
}: {
  attivo: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`tool-tile ${attivo ? "is-on" : ""}`}
      aria-pressed={attivo}
      onClick={onClick}
    >
      {children}
      <span>{label}</span>
    </button>
  );
}
