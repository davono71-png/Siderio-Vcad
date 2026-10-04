"use client";

import { useEffect, useState } from "react";
import type { UploadSummary } from "@/lib/data/types";
import {
  freeUploadedPhotos,
  readUploadSummary,
  retryProjectUploads,
  subscribeUploads,
  uploadErrorText,
  uploadStatusText,
} from "@/lib/upload/runner";

const EMPTY: UploadSummary = {
  accepted: 0,
  uploaded: 0,
  pending: 0,
  failed: 0,
  reclaimable: 0,
  lastError: null,
};

export function UploadStatus({ projectId, compact = false }: { projectId: string; compact?: boolean }) {
  const [summary, setSummary] = useState<UploadSummary>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void readUploadSummary(projectId).then((next) => {
        if (!cancelled) setSummary(next);
      });
    };
    load();
    const unsubscribe = subscribeUploads(load);
    const timer = window.setInterval(load, 3000);
    return () => {
      cancelled = true;
      unsubscribe();
      window.clearInterval(timer);
    };
  }, [projectId]);

  const label = uploadStatusText(summary);
  if (!label) return null;

  if (compact) {
    return <span className="upload-inline">{label}</span>;
  }

  const detail = uploadErrorText(summary.lastError);

  return (
    <section className="notebook-card mt-4 p-4">
      <h2 className="font-serif text-xl">Archivio foto</h2>
      <p className="mt-1 text-sm">{label}</p>
      {detail ? <p className="mt-1 text-sm text-steel">{detail}</p> : null}
      <p className="mt-2 text-sm leading-relaxed text-steel">
        Ogni foto accettata parte verso Cloudflare R2. La copia sul telefono resta finché il caricamento non è confermato.
      </p>
      <div className="mt-3 grid gap-2">
        {summary.failed > 0 || summary.lastError ? (
          <button type="button" className="btn-secondary" onClick={() => void retryProjectUploads(projectId)}>
            Riprova caricamento
          </button>
        ) : null}
        {summary.reclaimable > 0 ? (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              const ok = window.confirm(
                "Liberare dal telefono le foto già caricate? Lo ZIP le rilegge dall’archivio se servono.",
              );
              if (ok) void freeUploadedPhotos(projectId);
            }}
          >
            Libera spazio locale
          </button>
        ) : null}
      </div>
    </section>
  );
}
