"use client";

import { useEffect, useState } from "react";
import type { CadElement } from "@/lib/models/types";
import {
  describeScale,
  formatFactor,
  parseScaleFactor,
  suggestUnitKind,
  UNIT_PRESETS,
} from "@/lib/cad/units";

export function CadDock({
  cad,
  printMode,
  scaleMode,
  onToggleLayer,
  onToggleHatches,
  onPrintWindow,
  onCalibrate,
  onUnitKind,
  onScaleFactor,
  onResetScale,
  onImportCad,
}: {
  cad: CadElement | undefined;
  printMode: boolean;
  scaleMode: boolean;
  onToggleLayer: (name: string) => void;
  onToggleHatches: () => void;
  onPrintWindow: () => void;
  onCalibrate: () => void;
  onUnitKind: (kind: "mm" | "cm" | "m") => void;
  onScaleFactor: (factor: number) => void;
  onResetScale: () => void;
  onImportCad: () => void;
}) {
  const [factorText, setFactorText] = useState("1");

  useEffect(() => {
    if (!cad) return;
    setFactorText(formatFactor(cad.scaleFactor && cad.scaleFactor > 0 ? cad.scaleFactor : 1));
  }, [cad, cad?.scaleFactor]);

  function commitFactor() {
    const n = parseScaleFactor(factorText);
    if (n) onScaleFactor(n);
    else if (cad) setFactorText(formatFactor(cad.scaleFactor && cad.scaleFactor > 0 ? cad.scaleFactor : 1));
  }

  const suggested = cad ? suggestUnitKind(cad.bounds) : "mm";
  const kind = cad?.quoteUnit ?? (cad?.unitsFromFile ? undefined : cad?.unitKind);

  if (!cad) {
    return (
      <div>
        <p className="card-hint mb-2">Nessun DXF sul foglio.</p>
        <button type="button" className="extra-btn w-full" onClick={onImportCad}>
          Apri DXF / DWG
        </button>
      </div>
    );
  }

  return (
    <div>
      <p className="card-kicker">Unità delle quote</p>
      {cad.unitsFromFile ? (
        <p className="card-hint mb-1.5">
          {describeScale(cad)}. mm/cm/m cambia solo la cifra.
        </p>
      ) : (
        <p className="card-hint mb-1.5">
          Il file non dichiara le unità. Imposta mm/cm/m, un fattore (es. 1:100) o calibra.
          Suggerito: {suggested}.
        </p>
      )}
      {!cad.unitsFromFile ? <p className="mb-1.5 text-[11px] font-medium">{describeScale(cad)}</p> : null}
      <div className="cad-unit-row">
        {UNIT_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`cad-unit ${kind === p.id ? "is-on" : ""}`}
            onClick={() => onUnitKind(p.id as "mm" | "cm" | "m")}
          >
            {p.label}
          </button>
        ))}
      </div>
      <label className="mt-1.5 block text-[10px] font-semibold uppercase tracking-wide text-black/40">
        Fattore
        <input
          className="input mt-0.5 !py-1 !text-sm"
          value={factorText}
          inputMode="decimal"
          placeholder="1 oppure 1:100"
          onChange={(e) => setFactorText(e.target.value)}
          onBlur={commitFactor}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitFactor();
            }
          }}
        />
      </label>
      <button type="button" className={`extra-btn mt-1.5 w-full ${scaleMode ? "is-on" : ""}`} onClick={onCalibrate}>
        {scaleMode ? "Indica due estremi…" : "Calibra da due punti"}
      </button>
      <button type="button" className="extra-btn mt-1 w-full" onClick={onResetScale}>
        Ripristina dal file
      </button>
      <button
        type="button"
        className={`extra-btn mt-2 w-full ${cad.hideHatches ? "is-on" : ""}`}
        onClick={onToggleHatches}
      >
        {cad.hideHatches ? "Campiture spente" : "Spegni campiture"}
      </button>
      <button type="button" className={`extra-btn mt-1.5 w-full ${printMode ? "is-on" : ""}`} onClick={onPrintWindow}>
        {printMode ? "Traccia il riquadro…" : "Stampa riquadro"}
      </button>
      <button type="button" className="extra-btn mt-1 w-full" onClick={onImportCad}>
        Sostituisci DXF
      </button>
      <p className="card-kicker mt-3">Layer</p>
      <div className="cad-layer-list">
        {(cad.layers ?? []).map((l) => (
          <button
            key={l.name}
            type="button"
            className={`cad-layer ${l.visible ? "" : "is-off"}`}
            onClick={() => onToggleLayer(l.name)}
          >
            <span className="cad-layer-swatch" style={{ background: l.color }} />
            <span className="truncate">{l.name}</span>
            <span className="cad-layer-eye">{l.visible ? "on" : "off"}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
