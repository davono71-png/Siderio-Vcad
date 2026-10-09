"use client";

import { useEffect, useRef, useState } from "react";
import { editMillimetres } from "@/lib/measure/entry";

const ROWS: Array<Array<{ key: string; label: string; className?: string; aria: string }>> = [
  [
    { key: "1", label: "1", aria: "1" },
    { key: "2", label: "2", aria: "2" },
    { key: "3", label: "3", aria: "3" },
    { key: "back", label: "⌫", aria: "Cancella cifra" },
  ],
  [
    { key: "4", label: "4", aria: "4" },
    { key: "5", label: "5", aria: "5" },
    { key: "6", label: "6", aria: "6" },
    { key: "clear", label: "C", aria: "Azzera" },
  ],
  [
    { key: "7", label: "7", aria: "7" },
    { key: "8", label: "8", aria: "8" },
    { key: "9", label: "9", aria: "9" },
    { key: ",", label: ",", aria: "Virgola decimale" },
  ],
  [
    { key: "0", label: "0", aria: "0", className: "zero" },
    { key: "ok", label: "OK", aria: "Conferma millimetri", className: "ok" },
  ],
];

export function MmKeypad({
  value,
  onChange,
  onOk,
}: {
  value: string;
  onChange: (value: string) => void;
  onOk: () => void;
}) {
  const shownRef = useRef(value);
  const [shown, setShown] = useState(value);

  useEffect(() => {
    if (value !== shownRef.current) {
      shownRef.current = value;
      setShown(value);
    }
  }, [value]);

  function press(key: string) {
    if (key === "ok") {
      onOk();
      return;
    }
    const next = editMillimetres(shownRef.current, key === "," ? "comma" : key);
    shownRef.current = next;
    setShown(next);
    onChange(next);
  }

  return (
    <div className="pad-dock" data-pad="mm" role="group" aria-label="Tastierino millimetri">
      <p className="pad-readout" aria-live="polite">
        <span>{shown || "—"}</span>
        <span className="pad-unit">mm</span>
      </p>
      <div className="mm-keys">
        {ROWS.flat().map((item) => (
          <button
            key={item.key}
            type="button"
            className={`mm-key ${item.className ?? ""}`}
            aria-label={item.aria}
            onClick={() => press(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
