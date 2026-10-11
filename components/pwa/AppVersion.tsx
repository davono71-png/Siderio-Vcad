"use client";

import { useState } from "react";
import { versionLabel } from "@/lib/build-info";
import { resetAppCache, updateAppNow } from "./update";

export function AppVersion({ dock = false }: { dock?: boolean }) {
  const [busy, setBusy] = useState<"update" | "reset" | null>(null);
  const [note, setNote] = useState<string | null>(null);

  return (
    <footer className={dock ? "app-version app-version-dock" : "app-version"}>
      <p>Versione {versionLabel()}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-secondary"
          disabled={busy != null}
          onClick={() => {
            setBusy("update");
            setNote(null);
            void updateAppNow().catch(() => {
              setBusy(null);
              setNote("Aggiornamento non riuscito.");
            });
          }}
        >
          {busy === "update" ? "Aggiorno…" : "Aggiorna app"}
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={busy != null}
          onClick={() => {
            const ok = window.confirm("Ripristinare la cache dell’app? I rilievi su questo telefono restano. La pagina si ricarica.");
            if (!ok) return;
            setBusy("reset");
            void resetAppCache().catch(() => {
              setBusy(null);
              setNote("Cache non ripristinata.");
            });
          }}
        >
          {busy === "reset" ? "Ripristino…" : "Ripristina cache"}
        </button>
      </div>
      {note ? <p className="mt-2 text-danger">{note}</p> : null}
    </footer>
  );
}
