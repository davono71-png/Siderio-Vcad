"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { downloadBlob, exportProjectZip } from "@/lib/export/zip";
import { getRepository } from "@/lib/data";
import type { PhotoMeta, Project, ProjectKind } from "@/lib/data/types";
import { formatWhen, kindLabel } from "@/lib/format";
import { PageHeader } from "../ui/PageHeader";
import { Sheet } from "../ui/Sheet";

type Thumb = { photo: PhotoMeta; url: string };

const OUTPUTS = ["OBJ", "GLB", "STEP"] as const;

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
  const projectRef = useRef<Project | null>(null);

  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];
    void (async () => {
      const repo = getRepository();
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
        if (!blob) continue;
        const url = URL.createObjectURL(blob);
        urls.push(url);
        next.push({ photo, url });
      }
      setProject(stored);
      setThumbs(next);
      setPoints(storedPoints.length);
      setMeasures(storedMeasures.length);
    })();
    return () => {
      cancelled = true;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [projectId]);

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

  async function onEnqueue() {
    setMessage(null);
    const job = await getRepository().enqueueReconstruction(projectId);
    setProject((current) => (current ? { ...current, job } : current));
    router.push(`/rilievo/${projectId}/lavoro`);
  }

  async function onDelete() {
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
        <h2 className="font-serif text-xl">Elaborazione</h2>
        <p className="mt-1 text-sm leading-relaxed text-steel">
          Il worker GPU (COLMAP, mesh, STEP) non è ancora collegato. Puoi comunque preparare l’invio: lo stato resta
          sul telefono.
        </p>
        <div className="mt-3 grid gap-2">
          <button type="button" className="btn-primary" onClick={() => void onEnqueue()}>
            Invia per l’elaborazione
          </button>
          <Link href={`/rilievo/${projectId}/lavoro`} className="btn-secondary text-center">
            Stato del lavoro
          </Link>
          <Link href={`/rilievo/${projectId}/modello`} className="btn-secondary text-center">
            Anteprima 3D
          </Link>
          <div className="grid grid-cols-3 gap-2">
            {OUTPUTS.map((output) => (
              <button
                key={output}
                type="button"
                className="btn-secondary"
                disabled
                title="Disponibile dopo l’elaborazione sul worker"
              >
                {output}
              </button>
            ))}
          </div>
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
          <p className="text-sm text-steel">Foto, punti e quote verranno cancellati da questo dispositivo.</p>
          <button type="button" className="btn-danger mt-4 w-full" onClick={() => void onDelete()}>
            Elimina
          </button>
        </Sheet>
      ) : null}
    </div>
  );
}
