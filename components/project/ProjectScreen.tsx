"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { downloadBlob, exportProjectZip } from "@/lib/export/zip";
import { getRepository } from "@/lib/data";
import type { PhotoMeta, Project, ProjectKind } from "@/lib/data/types";
import { formatWhen, kindLabel } from "@/lib/format";
import { scheduleManifest } from "@/lib/upload/runner";
import { deleteRemoteSurvey, syncSurvey } from "@/lib/sync/client";
import { fetchRemotePhoto } from "@/lib/upload/remote";
import { UploadStatus } from "../upload/UploadStatus";
import { PageHeader } from "../ui/PageHeader";
import { Sheet } from "../ui/Sheet";

type Thumb = { photo: PhotoMeta; url: string };

export function ProjectScreen({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [missing, setMissing] = useState(false);
  const [thumbs, setThumbs] = useState<Thumb[]>([]);
  const [points, setPoints] = useState(0);
  const [measures, setMeasures] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [tick, setTick] = useState(0);
  const projectRef = useRef<Project | null>(null);

  useEffect(() => {
    const onFocus = () => {
      if (document.visibilityState === "hidden") return;
      setTick((value) => value + 1);
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);

  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];
    void (async () => {
      const repo = getRepository();
      await syncSurvey(projectId);
      if (cancelled) return;
      const stored = await repo.getProject(projectId);
      if (cancelled) return;
      if (!stored) {
        setMissing(true);
        return;
      }
      const [photos, photoThumbs, storedPoints, storedMeasures] = await Promise.all([
        repo.listPhotos(projectId),
        repo.listThumbs(projectId),
        repo.listPoints(projectId),
        repo.listMeasurements(projectId),
      ]);
      if (cancelled) return;
      const thumbById = new Map(photoThumbs.map((thumb) => [thumb.id, thumb.blob]));
      const next: Thumb[] = [];
      for (const photo of photos.filter((item) => item.accepted)) {
        const blob = thumbById.get(photo.id);
        let url: string | null = null;
        if (blob) url = URL.createObjectURL(blob);
        else if (photo.r2Key) {
          const remote = await fetchRemotePhoto(photo.r2Key);
          if (remote) url = URL.createObjectURL(remote);
        }
        if (!url) continue;
        urls.push(url);
        next.push({ photo, url });
      }
      setMissing(false);
      setProject(stored);
      setThumbs(next);
      setPoints(storedPoints.length);
      setMeasures(storedMeasures.length);
    })();
    return () => {
      cancelled = true;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [projectId, tick]);

  async function save(patch: { name?: string; kind?: ProjectKind; notes?: string }) {
    const current = projectRef.current;
    if (!current) return;
    const next = await getRepository().updateProject(projectId, {
      name: current.name,
      kind: current.kind,
      notes: current.notes,
      ...patch,
    });
    setProject(next);
    projectRef.current = next;
    scheduleManifest(projectId);
  }

  async function onExport() {
    setExporting(true);
    setMessage(null);
    try {
      const archive = await exportProjectZip(getRepository(), projectId);
      downloadBlob(archive.blob, archive.filename);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Esportazione non riuscita.");
    } finally {
      setExporting(false);
    }
  }

  async function onDelete() {
    await deleteRemoteSurvey(projectId);
    await getRepository().deleteProject(projectId);
    router.push("/");
  }

  if (missing) {
    return (
      <div className="page">
        <p>Rilievo non trovato.</p>
        <Link href="/" className="btn-primary mt-4 inline-flex">
          Torna ai rilievi
        </Link>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="page">
        <p className="text-sm text-steel">Caricamento…</p>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader title="Rilievo" backHref="/" />
      <input
        className="input font-serif text-2xl"
        aria-label="Nome del rilievo"
        value={project.name}
        onChange={(event) => setProject({ ...project, name: event.target.value })}
        onBlur={() => void save({ name: project.name })}
      />
      <div className="mt-3 flex gap-2">
        {(["stanza", "facciata"] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            className={`chip ${project.kind === kind ? "chip-on" : ""}`}
            onClick={() => void save({ kind })}
          >
            {kindLabel(kind)}
          </button>
        ))}
      </div>
      <p className="mt-3 text-sm text-steel">
        {thumbs.length === 1 ? "1 foto" : `${thumbs.length} foto`} · {points} punti · {measures} quote · aggiornato{" "}
        {formatWhen(project.updatedAt)}
      </p>

      <UploadStatus projectId={projectId} />

      <div className="mt-5 grid gap-2">
        <Link href={`/rilievo/${projectId}/acquisizione`} className="btn-primary bg-accent text-center text-ink">
          Acquisisci foto
        </Link>
        <Link href={`/rilievo/${projectId}/quote`} className="btn-secondary text-center">
          Quote tra punti
        </Link>
        <button type="button" className="btn-secondary" disabled={exporting || thumbs.length === 0} onClick={() => void onExport()}>
          {exporting ? "Preparazione ZIP…" : "Esporta ZIP"}
        </button>
      </div>

      <section className="notebook-card mt-5 p-4">
        <h2 className="font-serif text-xl">Risultati</h2>
        <p className="mt-1 text-sm leading-relaxed text-steel">
          Modello fotografico, pareti per Solid Edge e stato del motore.
        </p>
        <div className="mt-3 grid gap-2">
          <Link href={`/rilievo/${projectId}/risultati`} className="btn-primary bg-accent text-center text-ink">
            Apri i risultati
          </Link>
          <Link href={`/rilievo/${projectId}/lavoro`} className="btn-secondary text-center">
            Stato del lavoro
          </Link>
        </div>
      </section>

      {thumbs.length > 0 ? (
        <ul className="photo-grid mt-5">
          {thumbs.map(({ photo, url }) => (
            <li key={photo.id}>
              <Link href={`/rilievo/${projectId}/quote/${photo.id}`} className="photo-tile">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={`Foto ${photo.sequence}`} />
                <span>{String(photo.sequence).padStart(3, "0")}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      <label className="mt-5 block text-sm font-semibold">
        Note
        <textarea
          className="input mt-1 min-h-24"
          value={project.notes}
          onChange={(event) => setProject({ ...project, notes: event.target.value })}
          onBlur={() => void save({ notes: project.notes })}
        />
      </label>

      {message ? <p className="mt-3 text-sm text-danger">{message}</p> : null}

      <button type="button" className="btn-danger mt-6 w-full" onClick={() => setConfirmDelete(true)}>
        Elimina rilievo
      </button>

      {confirmDelete ? (
        <Sheet title="Eliminare il rilievo?" onClose={() => setConfirmDelete(false)}>
          <p className="text-sm text-steel">Foto, punti e quote verranno cancellati da questo dispositivo e dall’archivio.</p>
          <button type="button" className="btn-danger mt-4 w-full" onClick={() => void onDelete()}>
            Elimina
          </button>
        </Sheet>
      ) : null}
    </div>
  );
}
