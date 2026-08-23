"use client";

import type { ReactNode } from "react";

export function StatusStrip({
  icona,
  testo,
  stato,
  tono = "ok",
}: {
  icona?: ReactNode;
  testo: string;
  stato: string;
  tono?: "ok" | "attesa" | "offline";
}) {
  const pallino =
    tono === "ok" ? "#8fd19e" : tono === "attesa" ? "#e4a063" : "#c9b8bf";
  return (
    <div className="status-strip">
      {icona ? <span className="status-strip-icon">{icona}</span> : null}
      <span className="status-strip-what">{testo}</span>
      <span className="grow" />
      <span
        className="status-strip-dot"
        style={{ background: pallino }}
        aria-hidden
      />
      <span className="status-strip-state">{stato}</span>
    </div>
  );
}
