"use client";

import {
  IconCamera,
  IconEraser,
  IconMore,
  IconPen,
  IconRuler,
  IconSelect,
} from "../brand/Icons";
import type { DrawTool } from "@/lib/models/types";

/**
 * La barra degli strumenti, in basso dove arriva il pollice.
 *
 * Si dissolve al primo tratto e torna appena si stacca: il foglio resta
 * intero mentre si disegna, e i comandi sono tutti a vista quando ci si
 * ferma. Prima erano dietro tre linguette laterali, ed e' il motivo per cui
 * "Seleziona" era di fatto introvabile.
 *
 * La dissolvenza non passa da React: mentre la mano lavora l'editor non si
 * ridisegna apposta (il foglio e' una canvas imperativa), quindi il segnale
 * arriva da `data-live` sullo shell, scritto direttamente dal motore.
 */
export function ToolBar({
  tool,
  onPen,
  onEraser,
  onMeasure,
  onSelect,
  onCamera,
  onMore,
  onStyle,
}: {
  tool: DrawTool;
  onPen: () => void;
  onEraser: () => void;
  onMeasure: () => void;
  onSelect: () => void;
  onCamera: () => void;
  onMore: () => void;
  /** Toccare la penna gia' attiva apre colori e spessori. */
  onStyle: () => void;
}) {
  const penna = tool !== "eraser" && tool !== "select" && tool !== "measure";

  return (
    <div className="toolbar-c">
      <ToolBtn
        attivo={penna}
        label="Penna"
        onClick={penna ? onStyle : onPen}
      >
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
      <ToolBtn attivo={false} label="Altro" onClick={onMore}>
        <IconMore className="h-5 w-5" />
      </ToolBtn>
    </div>
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
      className={`toolbar-c-btn ${attivo ? "is-on" : ""}`}
      aria-pressed={attivo}
      onClick={onClick}
    >
      {children}
      <span>{label}</span>
    </button>
  );
}
