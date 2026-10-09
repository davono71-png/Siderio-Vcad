"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Logo } from "@/components/brand/Logo";
import { getRepository } from "@/lib/data";
import type { ProjectKind } from "@/lib/data/types";
import { formatWhen, kindLabel } from "@/lib/format";
import { fetchRemoteSurveys, syncSurvey, type RemoteCard } from "@/lib/sync/client";
import { Toast } from "../ui/Toast";

type Card = {
  id: string;
  name: string;
  kind: ProjectKind;
  updatedAt: string;
  photos: number;
};

function mergeCards(local: Card[], remote: RemoteCard[]) {
  const byId = new Map<string, Card>();
  for (const item of remote) {
    byId.set(item.id, {
      id: item.id,
      name: item.name,
      kind: item.kind,
      updatedAt: item.updatedAt,
      photos: item.photos,
    });
  }
  for (const item of local) {
    const previous = byId.get(item.id);
    if (!previous) {
      byId.set(item.id, item);
      continue;
    }
    const newer = item.updatedAt >= previous.updatedAt ? item : previous;
    byId.set(item.id, { ...newer, photos: Math.max(item.photos, previous.photos) });
  }
  return [...byId.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function HomeScreen() {
  const [projects, setProjects] = useState<Card[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const repo = getRepository();
        const list = await repo.listProjects();
        const local = await Promise.all(
          list.map(async (project) => {
            const photos = await repo.listPhotos(project.id);
            return {
              id: project.id,
              name: project.name,
              kind: project.kind,
              updatedAt: project.updatedAt,
              photos: photos.filter((photo) => photo.accepted).length,
            };
          }),
        );
        const remote = await fetchRemoteSurveys();
        if (cancelled) return;
        if (!remote.ok && remote.code !== "unauthorized" && remote.code !== "forbidden" && remote.code !== "unconfigured") {
          setError("Archivio remoto non disponibile. Mostro i rilievi di questo dispositivo.");
        } else {
          setError(null);
        }
        setProjects(mergeCards(local, remote.ok ? remote.surveys : []));
        for (const project of local) {
          if (cancelled) return;
          await syncSurvey(project.id);
        }
        if (cancelled) return;
        const again = await repo.listProjects();
        const refreshed = await Promise.all(
          again.map(async (project) => {
            const photos = await repo.listPhotos(project.id);
            return {
              id: project.id,
              name: project.name,
              kind: project.kind,
              updatedAt: project.updatedAt,
              photos: photos.filter((photo) => photo.accepted).length,
            };
          }),
        );
        const remoteAgain = await fetchRemoteSurveys();
        if (cancelled) return;
        setProjects(mergeCards(refreshed, remoteAgain.ok ? remoteAgain.surveys : remote.ok ? remote.surveys : []));
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Archivio locale non disponibile.");
      }
    }
    void load();
    const onFocus = () => {
      if (document.visibilityState === "hidden") return;
      void load();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);

  return (
    <div className="page">
      <header className="flex items-center justify-between py-3">
        <Logo />
      </header>
      <h1 className="font-serif text-4xl tracking-tight">Rilievi</h1>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-steel">
        Fotografa una stanza o una facciata. L’archivio tiene punti e quote, così lo stesso rilievo si apre anche dal computer.
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

      <ul className="survey-list mt-6 flex flex-col gap-3">
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

      <div className="home-dock">
        <Link href="/nuovo" className="btn-primary flex w-full items-center justify-center bg-accent text-ink">
          Nuovo rilievo
        </Link>
      </div>
    </div>
  );
}
