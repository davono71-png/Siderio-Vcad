"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { getRepository } from "@/lib/data";
import type { NotablePoint, PhotoMeta } from "@/lib/data/types";
import { createId } from "@/lib/data/id";
import { nextPointLabel } from "@/lib/format";
import { orientedToRaw } from "@/lib/jpeg";
import { Sheet } from "../ui/Sheet";

type View = { scale: number; x: number; y: number };
type Draft = { x: number; y: number };

const LOUPE = 2.7;

export function Annotator({ projectId, photoId }: { projectId: string; photoId: string }) {
  const router = useRouter();
  const stageRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<View>({ scale: 1, x: 0, y: 0 });
  const fitRef = useRef(1);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<"none" | "aim" | "pan" | "pinch">("none");
  const pinchRef = useRef({ dist: 1, scale: 1, x: 0, y: 0, cx: 0, cy: 0 });

  const [meta, setMeta] = useState<PhotoMeta | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [points, setPoints] = useState<NotablePoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"punto" | "vista">("punto");
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
  const [loupe, setLoupe] = useState<{ sx: number; sy: number; x: number; y: number } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [label, setLabel] = useState("A");
  const [linkId, setLinkId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    void (async () => {
      try {
        const repo = getRepository();
        const [photo, storedPoints] = await Promise.all([
          repo.getPhoto(photoId),
          repo.listPoints(projectId),
        ]);
        if (cancelled) return;
        if (!photo || photo.meta.projectId !== projectId) {
          setError("Foto non trovata in questo rilievo.");
          return;
        }
        const display = await uprightUrl(photo.blob, photo.meta);
        if (cancelled) {
          URL.revokeObjectURL(display.url);
          return;
        }
        objectUrl = display.url;
        setMeta(photo.meta);
        setUrl(display.url);
        setSize({ width: display.width, height: display.height });
        setPoints(storedPoints);
        setLabel(nextPointLabel(storedPoints.map((point) => point.label)));
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Impossibile aprire la foto.");
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photoId, projectId]);

  useEffect(() => {
    if (!size.width || !size.height) return;
    const fit = () => applyFit(stageRef.current, size.width, size.height, fitRef, commit);
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [size.width, size.height]);

  function commit(next: View) {
    viewRef.current = next;
    setView(next);
  }

  function clientToImage(clientX: number, clientY: number) {
    const stage = stageRef.current;
    if (!stage) return null;
    const rect = stage.getBoundingClientRect();
    const current = viewRef.current;
    return {
      x: (clientX - rect.left - current.x) / current.scale,
      y: (clientY - rect.top - current.y) / current.scale,
    };
  }

  function hitPoint(clientX: number, clientY: number) {
    const stage = stageRef.current;
    if (!stage || !meta) return null;
    const rect = stage.getBoundingClientRect();
    const current = viewRef.current;
    let found: string | null = null;
    for (const point of points) {
      const observation = point.observations.find((item) => item.photoId === photoId);
      if (!observation) continue;
      const sx = rect.left + current.x + observation.x * current.scale;
      const sy = rect.top + current.y + observation.y * current.scale;
      if (Math.hypot(sx - clientX, sy - clientY) < 32) found = point.id;
    }
    return found;
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("[data-marker]")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size >= 2) {
      gesture.current = "pinch";
      const [a, b] = [...pointers.current.values()];
      pinchRef.current = {
        dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
        scale: viewRef.current.scale,
        x: viewRef.current.x,
        y: viewRef.current.y,
        cx: (a.x + b.x) / 2,
        cy: (a.y + b.y) / 2,
      };
      setLoupe(null);
      return;
    }
    if (mode === "vista") {
      gesture.current = "pan";
      return;
    }
    const hit = hitPoint(event.clientX, event.clientY);
    if (hit) {
      gesture.current = "none";
      setSelected(hit);
      pointers.current.delete(event.pointerId);
      return;
    }
    gesture.current = "aim";
    setSelected(null);
    moveLoupe(event.clientX, event.clientY);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      if (gesture.current !== "pinch") {
        gesture.current = "pinch";
        pinchRef.current = {
          dist,
          scale: viewRef.current.scale,
          x: viewRef.current.x,
          y: viewRef.current.y,
          cx: (a.x + b.x) / 2,
          cy: (a.y + b.y) / 2,
        };
        setLoupe(null);
        return;
      }
      const stage = stageRef.current;
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      const origin = pinchRef.current;
      const nextScale = clamp(origin.scale * (dist / origin.dist), fitRef.current * 0.85, fitRef.current * 8);
      const ix = (origin.cx - rect.left - origin.x) / origin.scale;
      const iy = (origin.cy - rect.top - origin.y) / origin.scale;
      const midX = (a.x + b.x) / 2 - rect.left;
      const midY = (a.y + b.y) / 2 - rect.top;
      commit({ scale: nextScale, x: midX - ix * nextScale, y: midY - iy * nextScale });
      return;
    }

    if (gesture.current === "pan") {
      commit({
        ...viewRef.current,
        x: viewRef.current.x + (event.clientX - previous.x),
        y: viewRef.current.y + (event.clientY - previous.y),
      });
      return;
    }

    if (gesture.current === "aim") moveLoupe(event.clientX, event.clientY);
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const aiming = gesture.current === "aim";
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2 && gesture.current === "pinch") gesture.current = "none";
    if (pointers.current.size === 0) {
      if (aiming && mode === "punto") {
        const point = clientToImage(event.clientX, event.clientY);
        if (point && point.x >= 0 && point.y >= 0 && point.x <= size.width && point.y <= size.height) {
          setDraft(point);
          setLinkId(null);
          setLabel(nextPointLabel(points.map((item) => item.label)));
        }
      }
      gesture.current = "none";
      setLoupe(null);
    }
  }

  function moveLoupe(clientX: number, clientY: number) {
    const point = clientToImage(clientX, clientY);
    if (!point) return;
    setLoupe({ sx: clientX, sy: clientY, x: point.x, y: point.y });
  }

  async function saveDraft() {
    if (!draft || !meta || busy) return;
    const linked = linkId ? points.find((point) => point.id === linkId)?.label : label;
    const name = (linked ?? "").trim();
    if (!name) return;
    setBusy(true);
    try {
      const repo = getRepository();
      const raw = orientedToRaw(draft.x, draft.y, meta.width, meta.height, meta.exifOrientation);
      const observation = {
        photoId,
        x: draft.x,
        y: draft.y,
        rawX: raw.x,
        rawY: raw.y,
      };
      const existing =
        points.find((point) => point.id === linkId) ??
        points.find((point) => point.label.toLowerCase() === name.toLowerCase());
      let next: NotablePoint;
      if (existing) {
        next = {
          ...existing,
          label: existing.label,
          observations: [
            ...existing.observations.filter((item) => item.photoId !== photoId),
            observation,
          ],
        };
      } else {
        next = { id: createId(), projectId, label: name, observations: [observation] };
      }
      await repo.upsertPoint(next);
      setPoints((current) => {
        const without = current.filter((point) => point.id !== next.id);
        return [...without, next].sort((a, b) => a.label.localeCompare(b.label, "it"));
      });
      setDraft(null);
      setSelected(next.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Salvataggio non riuscito.");
    } finally {
      setBusy(false);
    }
  }

  async function removeFromPhoto(pointId: string) {
    const point = points.find((item) => item.id === pointId);
    if (!point) return;
    const next = {
      ...point,
      observations: point.observations.filter((item) => item.photoId !== photoId),
    };
    await getRepository().upsertPoint(next);
    setPoints((current) => current.map((item) => (item.id === pointId ? next : item)));
    setSelected(null);
  }

  async function removePhoto() {
    if (!window.confirm("Eliminare questa foto dal rilievo?")) return;
    await getRepository().deletePhoto(photoId);
    router.push(`/rilievo/${projectId}/quote`);
  }

  const marks = points.flatMap((point) => {
    const observation = point.observations.find((item) => item.photoId === photoId);
    return observation ? [{ point, observation }] : [];
  });

  return (
    <div className="annotator">
      <header className="acquire-top">
        <Link href={`/rilievo/${projectId}/quote`} className="icon-btn" aria-label="Torna alle quote">
          ←
        </Link>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">
            {meta ? `Foto ${String(meta.sequence).padStart(3, "0")}` : "Foto"}
          </p>
          <p className="text-xs text-white/70">
            {mode === "punto" ? "Tieni premuto, aggiusta, rilascia" : "Trascina per spostare · due dita per lo zoom"}
          </p>
        </div>
        <button type="button" className="icon-btn" onClick={() => void removePhoto()}>
          Elimina
        </button>
      </header>

      <div
        ref={stageRef}
        className="annotator-stage"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onContextMenu={(event) => event.preventDefault()}
      >
        {url && size.width > 0 ? (
          <div
            className="annotator-world"
            style={{
              transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})`,
            }}
          >
            {/* Full-resolution object URL, already oriented for marking. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt="" width={size.width} height={size.height} draggable={false} />
            {marks.map(({ point, observation }) => (
              <button
                key={point.id}
                type="button"
                data-marker
                className={`marker ${selected === point.id ? "on" : ""}`}
                style={{
                  left: observation.x,
                  top: observation.y,
                  transform: `translate(-50%, -50%) scale(${1 / view.scale})`,
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  setSelected(point.id);
                }}
              >
                {point.label}
              </button>
            ))}
          </div>
        ) : (
          <p className="absolute inset-0 grid place-items-center text-sm text-white/80">
            {error ?? "Apertura foto…"}
          </p>
        )}
      </div>

      {loupe && url ? (
        <div
          className="loupe"
          style={{
            left: Math.max(8, Math.min(window.innerWidth - 128, loupe.sx - 56)),
            top: Math.max(72, loupe.sy - 150),
            backgroundImage: `url(${url})`,
            backgroundSize: `${size.width * LOUPE}px ${size.height * LOUPE}px`,
            backgroundPosition: `${56 - loupe.x * LOUPE}px ${56 - loupe.y * LOUPE}px`,
          }}
        />
      ) : null}

      <footer className="annotator-bar">
        <button type="button" className={`mode-chip ${mode === "punto" ? "on" : ""}`} onClick={() => setMode("punto")}>
          Punto
        </button>
        <button type="button" className={`mode-chip ${mode === "vista" ? "on" : ""}`} onClick={() => setMode("vista")}>
          Vista
        </button>
        <button
          type="button"
          className="mode-chip"
          onClick={() => applyFit(stageRef.current, size.width, size.height, fitRef, commit)}
        >
          Adatta
        </button>
        {selected ? (
          <button type="button" className="mode-chip" onClick={() => void removeFromPhoto(selected)}>
            Togli segno
          </button>
        ) : null}
      </footer>

      {draft ? (
        <Sheet title="Punto notevole" onClose={() => setDraft(null)}>
          <p className="text-sm text-steel">
            Stesso nome su più foto: servirà per triangolare. La quota in millimetri si inserisce nella pagina Quote.
          </p>
          <label className="mt-3 block text-sm font-semibold" htmlFor="point-label">
            Nome
          </label>
          <input
            id="point-label"
            className="input mt-1"
            value={linkId ? (points.find((point) => point.id === linkId)?.label ?? label) : label}
            disabled={Boolean(linkId)}
            onChange={(event) => setLabel(event.target.value)}
            autoComplete="off"
          />
          {points.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className={`chip ${linkId == null ? "chip-on" : ""}`} onClick={() => setLinkId(null)}>
                Nuovo
              </button>
              {points.map((point) => (
                <button
                  key={point.id}
                  type="button"
                  className={`chip ${linkId === point.id ? "chip-on" : ""}`}
                  onClick={() => setLinkId(point.id)}
                >
                  È {point.label}
                </button>
              ))}
            </div>
          ) : null}
          <button type="button" className="btn-primary mt-4 w-full bg-accent text-ink" disabled={busy} onClick={() => void saveDraft()}>
            Salva punto
          </button>
        </Sheet>
      ) : null}
    </div>
  );
}

function commitView(fitRef: RefObject<number>, commit: (view: View) => void, view: View) {
  fitRef.current = view.scale;
  commit(view);
}

function applyFit(
  stage: HTMLDivElement | null,
  width: number,
  height: number,
  fitRef: RefObject<number>,
  commit: (view: View) => void,
) {
  if (!stage || !width || !height) return;
  const scale = Math.min(stage.clientWidth / width, stage.clientHeight / height);
  commitView(fitRef, commit, {
    scale,
    x: (stage.clientWidth - width * scale) / 2,
    y: (stage.clientHeight - height * scale) / 2,
  });
}

async function uprightUrl(blob: Blob, meta: PhotoMeta) {
  const probe = URL.createObjectURL(blob);
  try {
    const image = await loadImage(probe);
    const oriented =
      image.naturalWidth === meta.orientedWidth && image.naturalHeight === meta.orientedHeight;
    if (oriented || meta.exifOrientation === 1) {
      return { url: probe, width: image.naturalWidth, height: image.naturalHeight };
    }
  } catch {
    URL.revokeObjectURL(probe);
    throw new Error("Impossibile leggere la foto.");
  }
  URL.revokeObjectURL(probe);
  const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close?.();
    throw new Error("Canvas non disponibile.");
  }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  const fixed = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => (result ? resolve(result) : reject(new Error("Impossibile preparare la foto."))),
      "image/jpeg",
      0.92,
    );
  });
  return { url: URL.createObjectURL(fixed), width: canvas.width, height: canvas.height };
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Immagine illeggibile"));
    image.src = url;
  });
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
