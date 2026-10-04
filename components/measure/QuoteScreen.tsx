"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { getRepository } from "@/lib/data";
import type { Measurement, NotablePoint, PhotoMeta } from "@/lib/data/types";
import { createId } from "@/lib/data/id";
import { PageHeader } from "../ui/PageHeader";

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

  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];
    void (async () => {
      const repo = getRepository();
      const project = await repo.getProject(projectId);
      if (cancelled) return;
      if (!project) {
        setMissing(true);
        return;
      }
      const [storedPhotos, thumbs, storedPoints, storedMeasurements] = await Promise.all([
        repo.listPhotos(projectId),
        repo.listThumbs(projectId),
        repo.listPoints(projectId),
        repo.listMeasurements(projectId),
      ]);
      if (cancelled) return;
      const thumbById = new Map(thumbs.map((thumb) => [thumb.id, thumb.blob]));
      const next: Thumb[] = [];
      for (const photo of storedPhotos.filter((item) => item.accepted)) {
        const blob = thumbById.get(photo.id);
        if (!blob) continue;
        const url = URL.createObjectURL(blob);
        urls.push(url);
        next.push({ photo, url });
      }
      setPhotos(next);
      setPoints(storedPoints);
      setMeasurements(storedMeasurements);
      setPointA(storedPoints[0]?.id ?? "");
      setPointB(storedPoints[1]?.id ?? storedPoints[0]?.id ?? "");
    })();
    return () => {
      cancelled = true;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [projectId]);

  const labels = useMemo(() => new Map(points.map((point) => [point.id, point.label])), [points]);

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
    setNote("");
  }

  async function removeMeasurement(id: string) {
    await getRepository().deleteMeasurement(id);
    setMeasurements((current) => current.filter((item) => item.id !== id));
  }

  async function renamePoint(point: NotablePoint, nextLabel: string) {
    const label = nextLabel.trim();
    if (!label || label === point.label) return;
    const next = { ...point, label };
    await getRepository().upsertPoint(next);
    setPoints((current) => current.map((item) => (item.id === point.id ? next : item)));
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

  return (
    <div className="page">
      <PageHeader title="Quote" backHref={`/rilievo/${projectId}`} />
      <p className="text-sm leading-relaxed text-steel">
        Segna lo stesso punto su almeno due foto, poi scrivi una distanza nota in millimetri: una cornice da 930 mm,
        un’altezza da 2690 mm.
      </p>

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
                  <input
                    className="input max-w-28"
                    aria-label={`Nome del punto ${point.label}`}
                    defaultValue={point.label}
                    onBlur={(event) => void renamePoint(point, event.target.value)}
                  />
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
          <label className="text-sm font-semibold">
            Distanza (mm)
            <input
              className="input mt-1"
              inputMode="decimal"
              value={distance}
              onChange={(event) => setDistance(event.target.value)}
              placeholder="930"
            />
          </label>
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
    </div>
  );
}

function formatMm(value: number) {
  return `${new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 }).format(value)} mm`;
}
