"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { getRepository } from "@/lib/data";
import type { ProjectKind } from "@/lib/data/types";
import { PageHeader } from "../ui/PageHeader";
import { Toast } from "../ui/Toast";

export function NewProjectScreen() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ProjectKind>("stanza");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError("Dai un nome al rilievo.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Local only: never wait on R2, presign, or /api/storage/health.
      const project = await getRepository().createProject({ name, kind, notes });
      const href = `/rilievo/${project.id}`;
      router.push(href);
      window.setTimeout(() => {
        if (!window.location.pathname.endsWith("/nuovo")) return;
        // Router navigation can stall on a stale service worker. A full load still leaves the page.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign(href);
      }, 1500);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Creazione non riuscita.");
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <PageHeader title="Nuovo rilievo" backHref="/" />
      <form className="mt-2 grid gap-4" onSubmit={(event) => void onSubmit(event)}>
        <label className="text-sm font-semibold">
          Nome
          <input
            className="input mt-1"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Soggiorno, facciata nord…"
            autoFocus
          />
        </label>
        <fieldset>
          <legend className="text-sm font-semibold">Tipo</legend>
          <div className="mt-2 flex gap-2">
            <button type="button" className={`chip ${kind === "stanza" ? "chip-on" : ""}`} onClick={() => setKind("stanza")}>
              Stanza
            </button>
            <button
              type="button"
              className={`chip ${kind === "facciata" ? "chip-on" : ""}`}
              onClick={() => setKind("facciata")}
            >
              Facciata
            </button>
          </div>
        </fieldset>
        <label className="text-sm font-semibold">
          Note
          <textarea
            className="input mt-1 min-h-24"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Piano, commessa, cosa misurare…"
          />
        </label>
        <button type="submit" className="btn-primary bg-accent text-ink" disabled={busy}>
          {busy ? "Creazione…" : "Crea rilievo"}
        </button>
      </form>
      {error ? <Toast message={error} onDismiss={() => setError(null)} /> : null}
    </div>
  );
}
