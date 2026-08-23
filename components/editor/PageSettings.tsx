"use client";

import { PAGE_FORMATS, PAGE_PAPERS } from "@/lib/models/defaults";
import type { PageFormatId, PagePaper, SurveyPage } from "@/lib/models/types";
import { Dialog, Field } from "../ui/Dialog";

export function PageSettings({
  open,
  page,
  onClose,
  onChange,
  onDuplicate,
  onDelete,
}: {
  open: boolean;
  page: SurveyPage | null;
  onClose: () => void;
  onChange: (patch: {
    title?: string;
    format?: PageFormatId;
    paper?: PagePaper;
  }) => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
}) {
  if (!page) return null;
  return (
    <Dialog open={open} title="Pagina" onClose={onClose}>
      <Field label="Titolo pagina">
        <input
          className="input"
          value={page.title ?? ""}
          onChange={(e) => onChange({ title: e.target.value })}
        />
      </Field>
      <Field label="Formato">
        <div className="flex flex-wrap gap-2">
          {(Object.keys(PAGE_FORMATS) as PageFormatId[]).map((id) => (
            <button
              key={id}
              type="button"
              className={`chip ${page.format === id ? "chip-on" : ""}`}
              onClick={() => onChange({ format: id })}
            >
              {PAGE_FORMATS[id].label}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Sfondo appunti">
        <div className="flex flex-wrap gap-2">
          {PAGE_PAPERS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`chip ${page.paper === p.id ? "chip-on" : ""}`}
              onClick={() => onChange({ paper: p.id })}
            >
              {p.label}
            </button>
          ))}
        </div>
      </Field>
      <p className="text-xs text-ink/50">
        Quadretti, righe o pagina bianca. Il disegno a penna resta su un livello
        separato da fotografie e DWG. Tieni premuta una pagina per aprire questo
        editor.
      </p>
      <button type="button" className="btn-primary mt-4 w-full" onClick={onClose}>
        Chiudi
      </button>
      {onDuplicate ? (
        <button type="button" className="btn-secondary mt-2 w-full" onClick={onDuplicate}>
          Duplica pagina
        </button>
      ) : null}
      {onDelete ? (
        <button type="button" className="btn-danger mt-2 w-full" onClick={onDelete}>
          Elimina pagina
        </button>
      ) : null}
    </Dialog>
  );
}
