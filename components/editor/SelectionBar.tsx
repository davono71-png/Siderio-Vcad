"use client";

import { useState } from "react";
import { MeasurePad } from "./MeasurePad";
import { isTrueMeasure } from "@/lib/cad/quote";
import type { DrawingEngine } from "@/lib/drawing/engine";

export function SelectionBar({ engine }: { engine: DrawingEngine }) {
  const [correggo, setCorreggo] = useState(false);
  const el = engine.selectedElement();

  if (!el) return null;

  const vera = el.type === "measure" && isTrueMeasure(el);

  if (correggo && el.type === "measure") {
    return (
      <MeasurePad
        freeText={!vera}
        onConfirm={(value) => {
          engine.editSelectedMeasure(value);
          setCorreggo(false);
        }}
        onCancel={() => setCorreggo(false)}
      />
    );
  }

  return (
    <div className="selection-bar" role="toolbar" aria-label="Elemento selezionato">
      <span className="selection-bar-what">
        {el.type === "image"
          ? "Foto"
          : vera
            ? `Quota ${el.label}${el.note ? ` (${el.note})` : ""}`
            : el.label || "Quota inserita"}
      </span>

      {el.type === "measure" ? (
        <>
          <button
            type="button"
            className="selection-bar-btn"
            onClick={() => setCorreggo(true)}
          >
            {vera ? "Riscrivi" : "Modifica testo"}
          </button>
        </>
      ) : (
        <span className="selection-bar-hint">Trascina per spostare, angolo per ridimensionare</span>
      )}

      <button
        type="button"
        className="selection-bar-btn is-danger"
        onClick={() => engine.deleteSelected()}
      >
        Elimina
      </button>

      <button
        type="button"
        className="selection-bar-btn"
        aria-label="Chiudi selezione"
        onClick={() => engine.clearSelection()}
      >
        Fine
      </button>
    </div>
  );
}
