"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Logo } from "@/components/brand/Logo";
import { getRepository } from "@/lib/data";
import type { Project } from "@/lib/data/types";
import { formatWhen, kindLabel } from "@/lib/format";
import { Toast } from "../ui/Toast";

type Card = Project & { photos: number };

export function HomeScreen() {
  const [projects, setProjects] = useState<Card[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const repo = getRepository();
        const list = await repo.listProjects();
        const cards = await Promise.all(
          list.map(async (project) => {
            const photos = await repo.listPhotos(project.id);
            return { ...project, photos: photos.filter((photo) => photo.accepted).length };
          }),
        );
        if (!cancelled) setProjects(cards);
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Archivio locale non disponibile.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="page pb-28">
      <header className="flex items-center justify-between py-3">
        <Logo />
      </header>
      <h1 className="font-serif text-4xl tracking-tight">Rilievi</h1>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-steel">
        Fotografa una stanza o una facciata. Le foto restano sul telefono, pronte per il modello 3D.
      </p>

      {error ? <Toast message={error} /> : null}
      {projects == null && !error ? <p className="mt-8 text-sm text-steel">Caricamento…</p> : null}

      {projects?.length === 0 ? (
        <div className="notebook-card mt-8 p-5">
          <p className="font-semibold">Nessun rilievo</p>
          <p className="mt-1 text-sm text-steel">
            Crea il primo e gira intorno all’ambiente, con le luci accese e un po’ di sovrapposizione tra le foto.
          </p>
        </div>
      ) : null}

      <ul className="mt-6 flex flex-col gap-3">
        {projects?.map((project) => (
          <li key={project.id}>
            <div className="notebook-card p-4">
              <Link href={`/rilievo/${project.id}`} className="block">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="font-serif text-2xl leading-tight">{project.name}</h2>
                  <span className="chip shrink-0">{kindLabel(project.kind)}</span>
                </div>
                <p className="mt-2 text-sm text-steel">
                  {project.photos === 1 ? "1 foto" : `${project.photos} foto`} · {formatWhen(project.updatedAt)}
                </p>
              </Link>
              <Link href={`/rilievo/${project.id}/risultati`} className="btn-secondary mt-3 inline-flex">
                Risultati
              </Link>
            </div>
          </li>
        ))}
      </ul>

      <div className="fixed inset-x-0 bottom-0 z-20 mx-auto w-full max-w-lg px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2">
        <Link href="/nuovo" className="btn-primary flex w-full items-center justify-center bg-accent text-ink">
          Nuovo rilievo
        </Link>
      </div>
    </div>
  );
}
