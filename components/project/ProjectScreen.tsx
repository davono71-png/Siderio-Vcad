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
import { AppVersion } from "../pwa/AppVersion";
import { usePullToRefresh } from "../pwa/PullToRefresh";
import { checkForAppUpdate } from "../pwa/update";
import { UploadStatus } from "../upload/UploadStatus";
import { PageHeader } from "../ui/PageHeader";
import { Sheet } from "../ui/Sheet";

type Thumb = { photo: PhotoMeta; url: string };

function syncNoteFor(result: Awaited<ReturnType<typeof syncSurvey>>) {
  if (result === "ok" || result === "missing") return null;
  if (result === "offline") return "Senza rete. Mostro i dati di questo telefono.";
  if (result === "unauthorized") return "Sessione scaduta. I dati su questo telefono restano visibili.";
  if (result === "forbidden") return "Accesso riservato. I dati su questo telefono restano visibili.";
  if (result === "unconfigured") return "Archivio remoto non configurato. Mostro i dati di questo telefono.";
  return "Archivio remoto non aggiornato. Mostro i dati di questo telefono.";
}

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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const refreshing = usePullToRefresh(() => {
    void checkForAppUpdate();
    setTick((value) => value + 1);
  });
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
    const repo = getRepository();

    async function show(stored: Project) {
      const [photos, photoThumbs, storedPoints, storedMeasures] = await Promise.all([
        repo.listPhotos(projectId),
        repo.listThumbs(projectId),
        repo.listPoints(projectId),
        repo.listMeasurements(projectId),
      ]);
      if (cancelled) return;
      const thumbById = new Map(photoThumbs.map((thumb) => [thumb.id, thumb.blob]));
      const next: Thumb[] = [];
      const remote: PhotoMeta[] = [];
      for (const photo of photos.filter((item) => item.accepted)) {
        const blob = thumbById.get(photo.id);
        if (blob) {
          const url = URL.createObjectURL(blob);
          urls.push(url);
          next.push({ photo, url });
        } else if (photo.r2Key) {
          remote.push(photo);
        }
      }
      setLoadError(null);
      setMissing(false);
      setProject(stored);
      setThumbs(next);
      setPoints(storedPoints.length);
      setMeasures(storedMeasures.length);
      void fillRemote(remote);
    }

    async function fillRemote(remote: PhotoMeta[]) {
      for (const photo of remote) {
        if (cancelled || !photo.r2Key) continue;
        const blob = await fetchRemotePhoto(photo.r2Key);
        if (cancelled || !blob) continue;
        const url = URL.createObjectURL(blob);
        urls.push(url);
        setThumbs((current) => (current.some((item) => item.photo.id === photo.id) ? current : [...current, { photo, url }]));
      }
    }

    void (async () => {
      let stored: Project | null = null;
      try {
        stored = await repo.getProject(projectId);
      } catch (reason) {
        if (!cancelled) setLoadError(reason instanceof Error ? reason.message : "Archivio locale non disponibile.");
        return;
      }
      if (cancelled) return;
      if (stored) await show(stored);
      if (cancelled) return;
      setSyncNote(stored ? "Aggiorno l’archivio…" : null);
      const result = await syncSurvey(projectId);
      if (cancelled) return;
      const again = await repo.getProject(projectId).catch(() => stored);
      if (cancelled) return;
      if (again) {
        await show(again);
        if (!cancelled) setSyncNote(syncNoteFor(result));
        return;
      }
      if (!cancelled) {
        setSyncNote(null);
        if (result === "unauthorized") setLoadError("Accedi di nuovo per aprire questo rilievo.");
        else if (result === "forbidden") setLoadError("Accesso riservato all'amministratore.");
        else if (result === "missing") setMissing(true);
        else setLoadError("Non riesco a leggere questo rilievo dall’archivio.");
      }
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

  if (loadError && !project) {
    return (
      <div className="page">
        <p className="text-sm text-danger">{loadError}</p>
        <button type="button" className="btn-secondary mt-4" onClick={() => setTick((value) => value + 1)}>
          Riprova
        </button>
        <Link href="/" className="btn-primary mt-2 inline-flex">
          Torna ai rilievi
        </Link>
      </div>
    );
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
      {refreshing ? <p className="mt-2 text-sm text-steel">Aggiorno…</p> : null}
      {syncNote ? <p className="mt-2 text-sm text-steel">{syncNote}</p> : null}
      {loadError ? <p className="mt-2 text-sm text-danger">{loadError}</p> : null}

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

      <AppVersion />

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
