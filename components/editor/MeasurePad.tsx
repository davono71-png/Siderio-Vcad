"use client";

import { useState } from "react";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ",", "0", "ok"] as const;

export function MeasurePad({
  onConfirm,
  onCancel,
  freeText = false,
  caption,
  withLengthUnit = false,
}: {
  onConfirm: (value: string, unit?: "mm" | "cm" | "m") => void;
  onCancel: () => void;
  /** Quota non agganciata: solo il testo dell'utente. */
  freeText?: boolean;
  caption?: string;
  /** Per calibrare la scala: numero + mm/cm/m. */
  withLengthUnit?: boolean;
}) {
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState<"mm" | "cm" | "m">("m");

  function tap(key: (typeof KEYS)[number]) {
    if (key === "ok") {
      const trimmed = value.replace(/,$/, "");
      if (!trimmed) return;
      onConfirm(trimmed, withLengthUnit ? unit : undefined);
      return;
    }
    if (key === ",") {
      if (!value || value.includes(",")) return;
      setValue(value + ",");
      return;
    }
    if (value.replace(",", "").length >= 10) return;
    setValue(value + key);
  }

  function backspace() {
    setValue((v) => v.slice(0, -1));
  }

  if (freeText) {
    return (
      <div className="measure-pad" role="dialog" aria-label="Testo quota">
        <button type="button" className="measure-pad-dismiss" onClick={onCancel} aria-label="Annulla quota" />
        <div className="measure-pad-card">
          <p className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-white/70">
            Quota inserita — solo testo
          </p>
          <input
            className="input !bg-white/90"
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Scrivi la quota"
            onKeyDown={(e) => {
              if (e.key === "Enter" && value.trim()) onConfirm(value.trim());
            }}
          />
          <button
            type="button"
            className="btn-primary mt-2 w-full"
            disabled={!value.trim()}
            onClick={() => onConfirm(value.trim())}
          >
            Inserisci
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="measure-pad" role="dialog" aria-label="Valore quota">
      <button type="button" className="measure-pad-dismiss" onClick={onCancel} aria-label="Annulla quota" />
      <div className="measure-pad-card">
        <p className="mb-1 px-1 text-xs font-medium uppercase tracking-wide text-white/70">
          {caption ?? "Valore sotto, tra parentesi"}
        </p>
        {withLengthUnit ? (
          <div className="cad-unit-row mb-2">
            {(["m", "cm", "mm"] as const).map((u) => (
              <button
                key={u}
                type="button"
                className={`cad-unit ${unit === u ? "is-on" : ""}`}
                onClick={() => setUnit(u)}
              >
                {u}
              </button>
            ))}
          </div>
        ) : null}
        <div className="measure-pad-display">
          <span>{value || "0"}</span>
          <button type="button" className="measure-pad-del" onClick={backspace} aria-label="Cancella">
            ⌫
          </button>
        </div>
        <div className="measure-pad-grid">
          {KEYS.map((key) => (
            <button
              key={key}
              type="button"
              className={`measure-key ${key === "ok" ? "is-enter" : ""}`}
              onClick={() => tap(key)}
            >
              {key === "ok" ? "↵" : key}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
