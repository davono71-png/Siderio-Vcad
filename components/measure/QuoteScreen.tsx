"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { getRepository } from "@/lib/data";
import type { Measurement, NotablePoint, PhotoMeta, ProjectKind, ScaleChecklist } from "@/lib/data/types";
import { emptyChecklist } from "@/lib/data/types";
import { createId } from "@/lib/data/id";
import { kindLabel } from "@/lib/format";
import { closeViews, duplicateMeasurement } from "@/lib/measure/checks";
import { scheduleManifest } from "@/lib/upload/runner";
import { syncSurvey } from "@/lib/sync/client";
import { fetchRemotePhoto } from "@/lib/upload/remote";
import { useCoarsePointer, useWideScreen } from "@/lib/ui/media";
import { PageHeader } from "../ui/PageHeader";
import { Annotator } from "./Annotator";
import { LetterStrip } from "./LetterStrip";
import { MmKeypad } from "./MmKeypad";

type Thumb = { photo: PhotoMeta; url: string };

export function QuoteScreen({ projectId }: { projectId: string }) {
  const [missing, setMissing] = useState(false);
  const [photos, setPhotos] = useState<Thumb[]>([]);
  const [points, setPoints] = useState<NotablePoint[]>([]);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [pointA, setPointA] = useState("");
  const [pointB, setPointB] = useState("");
  const [distance, setDistance] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checklist, setChecklist] = useState<ScaleChecklist>(emptyChecklist());
  const [kind, setKind] = useState<ProjectKind>("stanza");
  const [name, setName] = useState("");
  const [mmOpen, setMmOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [activePhoto, setActivePhoto] = useState<string | null>(null);
  const [syncToken, setSyncToken] = useState(0);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [engineNote, setEngineNote] = useState<string | null>(null);
  const wide = useWideScreen();
  const coarse = useCoarsePointer();

  useEffect(() => {
    const onFocus = () => {
      if (document.visibilityState === "hidden") return;
      setSyncToken((value) => value + 1);
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];
    async function paint() {
      const repo = getRepository();
      const project = await repo.getProject(projectId);
      if (cancelled || !project) return false;
      const [storedPhotos, thumbs, storedPoints, storedMeasurements] = await Promise.all([
        repo.listPhotos(projectId),
        repo.listThumbs(projectId),
        repo.listPoints(projectId),
        repo.listMeasurements(projectId),
      ]);
      if (cancelled) return false;
      const thumbById = new Map(thumbs.map((thumb) => [thumb.id, thumb.blob]));
      const next: Thumb[] = [];
      for (const photo of storedPhotos.filter((item) => item.accepted)) {
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
      setPhotos(next);
      setPoints(storedPoints);
      setMeasurements(storedMeasurements);
      setChecklist(project.scaleChecklist ?? emptyChecklist());
      setKind(project.kind);
      setName(project.name);
      setPointA((current) =>
        storedPoints.some((point) => point.id === current) ? current : (storedPoints[0]?.id ?? ""),
      );
      setPointB((current) => {
        const ids = storedPoints.map((point) => point.id);
        if (current && ids.includes(current) && (current !== ids[0] || ids.length < 2)) return current;
        return ids.find((item) => item !== ids[0]) ?? ids[0] ?? "";
      });
      setActivePhoto((current) => current ?? next[0]?.photo.id ?? null);
      return true;
    }
    void (async () => {
      const repo = getRepository();
      const hadLocal = await repo.getProject(projectId);
      if (!hadLocal) await syncSurvey(projectId);
      if (cancelled) return;
      const painted = await paint();
      if (cancelled) return;
      if (!painted) {
        await syncSurvey(projectId);
        if (cancelled) return;
        const again = await paint();
        if (!again && !cancelled) setMissing(true);
        return;
      }
      await syncSurvey(projectId);
      if (cancelled) return;
      await paint();
    })();
    return () => {
      cancelled = true;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [projectId, syncToken]);

  const labels = useMemo(() => new Map(points.map((point) => [point.id, point.label])), [points]);
  const renaming = points.find((point) => point.id === renamingId) ?? null;
  const photoById = useMemo(() => new Map(photos.map((item) => [item.photo.id, item.photo])), [photos]);
  const weakPoints = points.filter((point) => closeViews(point, photoById).length > 0);
  const missingDirections = (
    [
      ["lunghezza", "lunghezza"],
      ["larghezza", "larghezza"],
      ["altezza", "altezza"],
    ] as const
  ).filter(([key]) => !checklist[key]);

  async function toggleCheck(key: keyof ScaleChecklist) {
    const next = { ...checklist, [key]: !checklist[key] };
    setChecklist(next);
    await getRepository().updateProject(projectId, { scaleChecklist: next });
    scheduleManifest(projectId);
    void syncSurvey(projectId);
  }

  async function addMeasurement(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const millimeters = Number(distance.replace(",", "."));
    if (!pointA || !pointB || pointA === pointB) {
      setError("Scegli due punti diversi.");
      return;
    }
    if (!Number.isFinite(millimeters) || millimeters <= 0) {
      setError("Inserisci la distanza in millimetri, per esempio 930.");
      return;
    }
    if (duplicateMeasurement(measurements, pointA, pointB)) {
      setError("Questa coppia di punti è già quotata. Elimina la quota precedente se vuoi cambiarla.");
      return;
    }
    const measurement: Measurement = {
      id: createId(),
      projectId,
      pointA,
      pointB,
      distanceMm: millimeters,
      note: note.trim(),
      createdAt: new Date().toISOString(),
    };
    await getRepository().upsertMeasurement(measurement);
    setMeasurements((current) => [...current, measurement]);
    setDistance("");
    setNote("");
    setMmOpen(false);
    scheduleManifest(projectId);
    void syncSurvey(projectId);
  }

  async function removeMeasurement(id: string) {
    await getRepository().deleteMeasurement(id);
    setMeasurements((current) => current.filter((item) => item.id !== id));
    scheduleManifest(projectId);
    void syncSurvey(projectId);
  }

  async function renamePoint(point: NotablePoint, nextLabel: string) {
    const label = nextLabel.trim();
    if (!label || label === point.label) return;
    const next = { ...point, label };
    setPoints((current) => current.map((item) => (item.id === point.id ? next : item)));
    await getRepository().upsertPoint(next);
    scheduleManifest(projectId);
    void syncSurvey(projectId);
  }

  async function removePoint(point: NotablePoint) {
    const used = measurements.some((item) => item.pointA === point.id || item.pointB === point.id);
    const message = used
      ? `Eliminare il punto ${point.label}? Verranno eliminate anche le quote che lo usano.`
      : `Eliminare il punto ${point.label}?`;
    if (!window.confirm(message)) return;
    await getRepository().deletePoint(point.id);
    setPoints((current) => current.filter((item) => item.id !== point.id));
    setMeasurements((current) =>
      current.filter((item) => item.pointA !== point.id && item.pointB !== point.id),
    );
    scheduleManifest(projectId);
    void syncSurvey(projectId);
  }

  async function changeKind(next: ProjectKind) {
    setKind(next);
    await getRepository().updateProject(projectId, { kind: next });
    scheduleManifest(projectId);
    void syncSurvey(projectId);
  }

  async function saveNow() {
    setSaveNote(null);
    const result = await syncSurvey(projectId);
    setSaveNote(result === "ok" ? "Salvato sull’archivio." : "Salvataggio non riuscito. Riprovo da solo.");
  }

  async function sendEngine() {
    setEngineNote(null);
    try {
      const response = await fetch(`/api/rilievi/${projectId}/motore`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: kind }),
      });
      const body = (await response.json().catch(() => null)) as { ok?: boolean; code?: string } | null;
      if (body?.code === "missing_env") {
        setEngineNote("Mancano le chiavi del motore sul server.");
        return;
      }
      if (!response.ok || !body?.ok) {
        setEngineNote("Invio non riuscito.");
        return;
      }
      setEngineNote("Inviato al motore.");
    } catch {
      setEngineNote("Invio non riuscito.");
    }
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

  if (wide) {
    const active = photos.find((item) => item.photo.id === activePhoto) ?? photos[0] ?? null;
    return (
      <div className="desk">
        <aside className="desk-strip" aria-label="Foto del rilievo">
          <Link href={`/rilievo/${projectId}`} className="desk-back">
            ←
          </Link>
          {photos.map(({ photo, url }) => (
            <button
              key={photo.id}
              type="button"
              className={`desk-thumb ${active?.photo.id === photo.id ? "on" : ""}`}
              onClick={() => setActivePhoto(photo.id)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={`Foto ${photo.sequence}`} />
              <span>{String(photo.sequence).padStart(3, "0")}</span>
            </button>
          ))}
        </aside>
        <div className="desk-stage">
          {active ? (
            <Annotator
              embedded
              projectId={projectId}
              photoId={active.photo.id}
              syncToken={syncToken}
              onSaved={() => setSyncToken((value) => value + 1)}
            />
          ) : (
            <p className="desk-empty">Nessuna foto in questo rilievo.</p>
          )}
        </div>
        <aside className="desk-side">
          <p className="font-serif text-2xl leading-tight">{name || "Rilievo"}</p>
          <div className="mt-3 flex gap-2">
            {(["stanza", "facciata"] as const).map((item) => (
              <button
                key={item}
                type="button"
                className={`chip ${kind === item ? "chip-on" : ""}`}
                onClick={() => void changeKind(item)}
              >
                {kindLabel(item)}
              </button>
            ))}
          </div>
          <div className="mt-3 grid gap-2">
            <button type="button" className="btn-primary bg-accent text-ink" onClick={() => void saveNow()}>
              Salva
            </button>
            <button type="button" className="btn-secondary" onClick={() => void sendEngine()}>
              Invia al motore
            </button>
            <Link href={`/rilievo/${projectId}/risultati`} className="btn-secondary text-center">
              Risultati e STEP
            </Link>
          </div>
          {saveNote ? <p className="mt-2 text-sm text-steel">{saveNote}</p> : null}
          {engineNote ? <p className="mt-2 text-sm text-steel">{engineNote}</p> : null}
          <p className="mt-4 text-sm leading-relaxed text-steel">
            Clicca per un punto, trascina per spostarlo. Rotella per lo zoom, tasto centrale o spazio per spostare la foto.
          </p>
          <section className="mt-6">
            <h2 className="font-serif text-2xl">Punti</h2>
            {points.length === 0 ? (
              <p className="mt-2 text-sm text-steel">Clicca sulla foto per il primo punto.</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-2">
                {points.map((point) => (
                  <li key={point.id} className="notebook-card flex items-center gap-2 p-3">
                    <input
                      className="input point-name-input"
                      aria-label={`Nome del punto ${point.label}`}
                      defaultValue={point.label}
                      key={`${point.id}:${point.label}`}
                      onBlur={(event) => void renamePoint(point, event.target.value)}
                    />
                    <p className="flex-1 text-sm text-steel">{new Set(point.observations.map((item) => item.photoId)).size} foto</p>
                    <button type="button" className="text-sm font-semibold text-danger" onClick={() => void removePoint(point)}>
                      Elimina
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="mt-6">
            <h2 className="font-serif text-2xl">Distanze note</h2>
            <form className="notebook-card mt-3 grid gap-3 p-4" onSubmit={(event) => void addMeasurement(event)}>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-sm font-semibold">
                  Punto A
                  <select className="input mt-1" aria-label="Punto A" value={pointA} onChange={(event) => setPointA(event.target.value)}>
                    <option value="">—</option>
                    {points.map((point) => (
                      <option key={point.id} value={point.id}>
                        {point.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm font-semibold">
                  Punto B
                  <select className="input mt-1" aria-label="Punto B" value={pointB} onChange={(event) => setPointB(event.target.value)}>
                    <option value="">—</option>
                    {points.map((point) => (
                      <option key={point.id} value={point.id}>
                        {point.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="text-sm font-semibold">
                Distanza (mm)
                <input
                  className="input mt-1"
                  aria-label="Distanza in millimetri"
                  inputMode="decimal"
                  value={distance}
                  onChange={(event) => setDistance(event.target.value)}
                  placeholder="930"
                />
              </label>
              <label className="text-sm font-semibold">
                Nota
                <input className="input mt-1" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Cornice, altezza soffitto…" />
              </label>
              {error ? <p className="text-sm text-danger">{error}</p> : null}
              <button type="submit" className="btn-primary bg-accent text-ink" disabled={points.length < 2}>
                Aggiungi quota
              </button>
            </form>
            <ul className="mt-3 flex flex-col gap-2">
              {measurements.map((measurement) => (
                <li key={measurement.id} className="notebook-card flex items-center gap-3 p-3 text-sm">
                  <p className="flex-1">
                    <span className="font-semibold">
                      {labels.get(measurement.pointA) ?? "?"} → {labels.get(measurement.pointB) ?? "?"}
                    </span>
                    <span className="mt-0.5 block text-steel">
                      {formatMm(measurement.distanceMm)}
                      {measurement.note ? ` · ${measurement.note}` : ""}
                    </span>
                  </p>
                  <button type="button" className="font-semibold text-danger" onClick={() => void removeMeasurement(measurement.id)}>
                    Elimina
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    );
  }

  return (
    <div className={coarse && (mmOpen || renaming) ? "page pad-clear" : "page"}>
      <PageHeader title="Quote" backHref={`/rilievo/${projectId}`} />
      <p className="text-sm leading-relaxed text-steel">
        Segna lo stesso punto su almeno due foto, poi scrivi una distanza nota in millimetri: una cornice da 930 mm,
        un’altezza da 2690 mm. Serve almeno una quota per lunghezza, larghezza e altezza.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {(
          [
            ["lunghezza", "Lunghezza"],
            ["larghezza", "Larghezza"],
            ["altezza", "Altezza"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`chip ${checklist[key] ? "chip-on" : ""}`}
            aria-pressed={checklist[key]}
            onClick={() => void toggleCheck(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {measurements.length > 0 && missingDirections.length > 0 ? (
        <p className="mt-2 text-sm text-steel">Manca: {missingDirections.map(([, label]) => label.toLowerCase()).join(", ")}.</p>
      ) : null}
      {weakPoints.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-1">
          {weakPoints.map((point) => (
            <li key={point.id} className="text-sm text-danger">
              {point.label}: due foto a meno di 15° — triangolazione debole. Scatta da un altro punto della stanza.
            </li>
          ))}
        </ul>
      ) : null}

      {photos.length === 0 ? (
        <div className="notebook-card mt-4 p-4">
          <p>Non ci sono ancora foto accettate.</p>
          <Link href={`/rilievo/${projectId}/acquisizione`} className="btn-primary mt-3 inline-flex bg-accent text-ink">
            Acquisisci foto
          </Link>
        </div>
      ) : (
        <ul className="photo-grid mt-4">
          {photos.map(({ photo, url }) => {
            const names = points
              .filter((point) => point.observations.some((item) => item.photoId === photo.id))
              .map((point) => point.label);
            return (
              <li key={photo.id}>
                <Link href={`/rilievo/${projectId}/quote/${photo.id}`} className="photo-tile">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={`Foto ${photo.sequence}`} />
                  <span>
                    {String(photo.sequence).padStart(3, "0")}
                    {names.length ? ` · ${names.join(" ")}` : ""}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <section className="mt-6">
        <h2 className="font-serif text-2xl">Punti</h2>
        {points.length === 0 ? (
          <p className="mt-2 text-sm text-steel">Apri una foto e tocca per posizionare A, B o un nome tuo.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {points.map((point) => {
              const count = new Set(point.observations.map((item) => item.photoId)).size;
              return (
                <li key={point.id} className="notebook-card flex items-center gap-2 p-3">
                  {coarse ? (
                    <button
                      type="button"
                      className={`point-name ${renamingId === point.id ? "on" : ""}`}
                      aria-label={`Nome del punto ${point.label}`}
                      onClick={() => {
                        blurFocus();
                        setMmOpen(false);
                        setRenamingId(point.id);
                      }}
                    >
                      {point.label}
                    </button>
                  ) : (
                    <input
                      className="input point-name-input"
                      aria-label={`Nome del punto ${point.label}`}
                      defaultValue={point.label}
                      key={`${point.id}:${point.label}`}
                      onBlur={(event) => void renamePoint(point, event.target.value)}
                    />
                  )}
                  <p className={`flex-1 text-sm ${count < 2 ? "text-danger" : "text-steel"}`}>
                    {count === 1 ? "1 foto — segna lo stesso punto su almeno un’altra" : `${count} foto`}
                  </p>
                  <button type="button" className="text-sm font-semibold text-danger" onClick={() => void removePoint(point)}>
                    Elimina
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="mt-6">
        <h2 className="font-serif text-2xl">Distanze note</h2>
        <form className="notebook-card mt-3 grid gap-3 p-4" onSubmit={(event) => void addMeasurement(event)}>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-sm font-semibold">
              Punto A
              <select className="input mt-1" value={pointA} onChange={(event) => setPointA(event.target.value)}>
                <option value="">—</option>
                {points.map((point) => (
                  <option key={point.id} value={point.id}>
                    {point.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-semibold">
              Punto B
              <select className="input mt-1" value={pointB} onChange={(event) => setPointB(event.target.value)}>
                <option value="">—</option>
                {points.map((point) => (
                  <option key={point.id} value={point.id}>
                    {point.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="text-sm font-semibold">
            Distanza (mm)
            {coarse ? (
              <button
                type="button"
                className="input mt-1 text-left"
                aria-label="Distanza in millimetri"
                onClick={() => {
                  blurFocus();
                  setRenamingId(null);
                  setMmOpen(true);
                }}
              >
                {distance ? `${distance} mm` : "Tocca per i millimetri"}
              </button>
            ) : (
              <input
                className="input mt-1"
                aria-label="Distanza in millimetri"
                inputMode="decimal"
                value={distance}
                onChange={(event) => setDistance(event.target.value)}
                placeholder="930"
              />
            )}
          </div>
          <label className="text-sm font-semibold">
            Nota
            <input
              className="input mt-1"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Cornice, altezza soffitto…"
            />
          </label>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <button type="submit" className="btn-primary bg-accent text-ink" disabled={points.length < 2}>
            Aggiungi quota
          </button>
        </form>
        <ul className="mt-3 flex flex-col gap-2">
          {measurements.map((measurement) => (
            <li key={measurement.id} className="notebook-card flex items-center gap-3 p-3 text-sm">
              <p className="flex-1">
                <span className="font-semibold">
                  {labels.get(measurement.pointA) ?? "?"} → {labels.get(measurement.pointB) ?? "?"}
                </span>
                <span className="mt-0.5 block text-steel">
                  {formatMm(measurement.distanceMm)}
                  {measurement.note ? ` · ${measurement.note}` : ""}
                </span>
              </p>
              <button type="button" className="font-semibold text-danger" onClick={() => void removeMeasurement(measurement.id)}>
                Elimina
              </button>
            </li>
          ))}
        </ul>
      </section>
      {coarse && mmOpen ? (
        <MmKeypad value={distance} onChange={setDistance} onOk={() => setMmOpen(false)} />
      ) : null}
      {coarse && renaming ? (
        <div className="pad-dock" role="dialog" aria-label={`Nome del punto ${renaming.label}`}>
          <LetterStrip
            value={renaming.label}
            onChange={(name) => void renamePoint(renaming, name)}
            onDismiss={() => setRenamingId(null)}
          />
        </div>
      ) : null}
    </div>
  );
}

function blurFocus() {
  const active = document.activeElement;
  if (active instanceof HTMLElement) active.blur();
}

function formatMm(value: number) {
  return `${new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 }).format(value)} mm`;
}
