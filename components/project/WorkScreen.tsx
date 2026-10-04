"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getRepository } from "@/lib/data";
import type { ProjectJob } from "@/lib/data/types";
import { PageHeader } from "../ui/PageHeader";

const LABELS: Record<ProjectJob["status"], string> = {
  non_inviato: "Non inviato",
  in_coda: "In coda",
  in_elaborazione: "In elaborazione",
  completato: "Completato",
  errore: "Errore",
  non_disponibile: "Non disponibile",
};

export function WorkScreen({ projectId }: { projectId: string }) {
  const [job, setJob] = useState<ProjectJob | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getRepository()
      .getProject(projectId)
      .then((project) => {
        if (cancelled) return;
        if (!project) setMissing(true);
        else setJob(project.job);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return (
    <div className="page">
      <PageHeader title="Stato del lavoro" backHref={`/rilievo/${projectId}`} />
      {missing ? <p>Rilievo non trovato.</p> : null}
      {!job && !missing ? <p className="text-sm text-steel">Caricamento…</p> : null}
      {job ? (
        <section className="notebook-card p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-steel">Worker GPU</p>
          <h2 className="mt-1 font-serif text-3xl">{LABELS[job.status]}</h2>
          <p className="mt-3 text-sm leading-relaxed">{job.message}</p>
          {job.progress != null ? (
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-paper-dark" aria-hidden>
              <div className="h-full bg-accent" style={{ width: `${Math.round(job.progress * 100)}%` }} />
            </div>
          ) : (
            <div className="mt-4 h-2 rounded-full bg-paper-dark" aria-hidden />
          )}
          <p className="mt-4 text-sm text-steel">
            Il passo successivo è caricare le foto su Supabase e accodare il job su RunPod. Qui compariranno coda,
            avanzamento e messaggi di errore.
          </p>
          <Link href={`/rilievo/${projectId}/modello`} className="btn-secondary mt-4 inline-flex">
            Anteprima 3D
          </Link>
        </section>
      ) : null}
    </div>
  );
}
