"use client";

import {
  IconCad,
  IconFit,
  IconImage,
  IconMore,
  IconRedo,
  IconUndo,
  IconZoomIn,
} from "../brand/Icons";
import { EdgeTab } from "./EdgeTab";

/**
 * Il cassetto del secondo piano: quello che serve ogni tanto.
 *
 * Camera, Quote e Seleziona sono usciti da qui — stanno nella barra in
 * basso, a vista. Qui resta ciò che non si cerca mentre si disegna.
 */
export function ExtrasDock({
  open,
  onToggle,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onImage,
  onCad,
  onFit,
  onZoom100,
  onMore,
}: {
  open: boolean;
  onToggle: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onImage: () => void;
  onCad: () => void;
  onFit: () => void;
  onZoom100: () => void;
  onMore: () => void;
}) {
  return (
    <div className={`edge-dock edge-dock-right ${open ? "is-open" : ""}`}>
      <EdgeTab open={open} side="right" label="Altro" onClick={onToggle} />
      <div className="edge-panel">
        <button type="button" className="extra-btn" onClick={onImage}>
          <IconImage className="h-4 w-4" />
          File
        </button>
        <button type="button" className="extra-btn" onClick={onCad}>
          <IconCad className="h-4 w-4" />
          DWG
        </button>
        <button type="button" className="extra-btn" disabled={!canUndo} onClick={onUndo}>
          <IconUndo className="h-4 w-4" />
          Annulla
        </button>
        <button type="button" className="extra-btn" disabled={!canRedo} onClick={onRedo}>
          <IconRedo className="h-4 w-4" />
          Ripeti
        </button>
        <button type="button" className="extra-btn" onClick={onFit}>
          <IconFit className="h-4 w-4" />
          Adatta
        </button>
        <button type="button" className="extra-btn" onClick={onZoom100}>
          <IconZoomIn className="h-4 w-4" />
          100%
        </button>
        <button type="button" className="extra-btn" onClick={onMore}>
          <IconMore className="h-4 w-4" />
          Taccuino
        </button>
      </div>
    </div>
  );
}
