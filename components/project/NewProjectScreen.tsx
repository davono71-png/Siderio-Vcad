"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { getRepository } from "@/lib/data";
import type { ProjectKind } from "@/lib/data/types";
import { PageHeader } from "../ui/PageHeader";

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
      const project = await getRepository().createProject({ name, kind, notes });
      router.push(`/rilievo/${project.id}`);
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
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <button type="submit" className="btn-primary bg-accent text-ink" disabled={busy}>
          Crea rilievo
        </button>
      </form>
    </div>
  );
}
