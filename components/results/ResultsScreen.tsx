"use client";

import { useCallback, useEffect, useState } from "react";
import { getRepository } from "@/lib/data";
import type { ProjectKind } from "@/lib/data/types";
import { formatMm, kindLabel } from "@/lib/format";
import type { ResultName } from "@/lib/results/files";
import type { ResultsPayload } from "@/lib/results/types";
import { resultFacts, type SceneDoc } from "@/lib/results/scene";
import { PageHeader } from "../ui/PageHeader";
import { PhotoViewer } from "./PhotoViewer";
import { StepViewer } from "./StepViewer";

const DOWNLOADS: { name: ResultName; label: string; primary?: boolean }[] = [
  { name: "walls.step", label: "STEP pareti per Solid Edge", primary: true },
  { name: "extra.step", label: "STEP altre superfici" },
  { name: "room_textured.glb", label: "Modello GLB" },
  { name: "room_textured_obj.zip", label: "OBJ con texture" },
  { name: "room_dense.ply", label: "Nuvola PLY" },
];

const GALLERY: { name: ResultName; label: string }[] = [
  { name: "preview_iso.png", label: "Assonometria" },
  { name: "preview_top.png", label: "Dall'alto" },
  { name: "preview_plan.png", label: "Pianta" },
];

type View = "foto" | "step";

function stageTitle(payload: ResultsPayload, jobStatus: string | null) {
  if (jobStatus === "IN_QUEUE") return { title: "In coda", detail: "Il rilievo è in attesa del motore." };
  if (jobStatus === "IN_PROGRESS") return { title: "In calcolo", detail: payload.status?.message ?? "Il motore sta elaborando le foto." };
  if (jobStatus === "FAILED" || jobStatus === "CANCELLED" || jobStatus === "TIMED_OUT") {
    return { title: "Errore", detail: "Il motore ha interrotto il lavoro." };
  }
  const status = payload.status;
  if (status?.ok === false || status?.error) {
    return { title: "Errore", detail: status.error || status.message || "Elaborazione non riuscita." };
  }
  if (status?.ok === true || status?.stage === "completato") {
    return { title: "Completato", detail: status.message };
  }
  if (status) return { title: "In calcolo", detail: status.message || status.stage || "Elaborazione in corso." };
  if (jobStatus === "COMPLETED") return { title: "Completato", detail: null };
  return null;
}

export function ResultsScreen({ projectId }: { projectId: string }) {
  const [payload, setPayload] = useState<ResultsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [backHref, setBackHref] = useState("/");
  const [view, setView] = useState<View>("foto");
  const [mode, setMode] = useState<ProjectKind>("facciata");
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/rilievi/${projectId}/risultati`, { cache: "no-store" });
    const body = (await response.json()) as ResultsPayload & { ok: boolean; code?: string };
    if (!response.ok || !body.ok) {
      if (body.code === "missing_env" || body.code === "bad_account") {
        throw new Error("L'archivio non è configurato su questo server.");
      }
      throw new Error("Non riesco a leggere i risultati.");
    }
    setPayload(body);
    if (body.kind) setMode(body.kind);
    return body;
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    void getRepository()
      .getProject(projectId)
      .then((project) => {
        if (cancelled || !project) return;
        setBackHref(`/rilievo/${projectId}`);
        setMode(project.kind);
      })
      .catch(() => undefined);
    const stored = window.sessionStorage.getItem(`siderio-job-${projectId}`);
    if (stored) setJobId(stored);
    void refresh().catch((reason) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : "Non riesco a leggere i risultati.");
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, refresh]);

  useEffect(() => {
    if (!jobId) return;
    let stop = false;
    const tick = async () => {
      const response = await fetch(`/api/rilievi/${projectId}/motore?jobId=${encodeURIComponent(jobId)}`, { cache: "no-store" });
      const body = (await response.json()) as { ok?: boolean; status?: string };
      if (stop || !body.ok || !body.status) return;
      setJobStatus(body.status);
      if (body.status === "COMPLETED" || body.status === "FAILED" || body.status === "CANCELLED" || body.status === "TIMED_OUT") {
        window.sessionStorage.removeItem(`siderio-job-${projectId}`);
        await refresh().catch(() => undefined);
        setJobId(null);
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), 4000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [jobId, projectId, refresh]);

  async function send() {
    setSending(true);
    setSendError(null);
    try {
      const response = await fetch(`/api/rilievi/${projectId}/motore`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const body = (await response.json()) as { ok?: boolean; jobId?: string; status?: string; code?: string };
      if (!response.ok || !body.ok || !body.jobId) {
        setSendError(body.code === "missing_env" ? "Mancano le chiavi del motore sul server." : "Invio non riuscito.");
        return;
      }
      window.sessionStorage.setItem(`siderio-job-${projectId}`, body.jobId);
      setJobId(body.jobId);
      setJobStatus(body.status ?? "IN_QUEUE");
    } catch {
      setSendError("Invio non riuscito.");
    } finally {
      setSending(false);
    }
  }

  const facts = resultFacts(payload?.scene ?? null);
  const stage = payload ? stageTitle(payload, jobStatus) : null;
  const present = new Set(payload?.files.map((file) => file.name) ?? []);
  const glb = payload?.files.find((file) => file.name === "room_textured.glb")?.viewUrl ?? null;
  const poster = payload?.files.find((file) => file.name === "preview_iso.png")?.viewUrl ?? null;
  const showJob = Boolean(jobId && jobStatus && jobStatus !== "COMPLETED");

  return (
    <div className="page">
      <PageHeader title={payload?.name || "Risultati"} backHref={backHref} />

      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {!payload && !error ? <p className="text-sm text-steel">Caricamento…</p> : null}

      {payload?.empty && !showJob ? <p className="font-serif text-2xl">Nessun risultato ancora</p> : null}

      {payload && (stage || !payload.empty) ? (
        <section className="notebook-card mt-3 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-steel">Motore</p>
          <h2 className="mt-1 font-serif text-3xl">{stage?.title ?? "In attesa"}</h2>
          {stage?.detail ? <p className="mt-2 text-sm leading-relaxed">{stage.detail}</p> : null}
          {payload.status?.progress != null && stage?.title === "In calcolo" ? (
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-paper-dark" aria-hidden>
              <div className="h-full bg-accent" style={{ width: `${Math.max(0, Math.min(100, payload.status.progress))}%` }} />
            </div>
          ) : null}
          <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
            <div>
              <dt className="text-steel">Modalità</dt>
              <dd className="font-semibold">{facts.mode ? kindLabel(facts.mode) : payload.kind ? kindLabel(payload.kind) : "—"}</dd>
            </div>
            <div>
              <dt className="text-steel">Foto</dt>
              <dd className="font-semibold">
                {payload.photos.registered != null && payload.photos.total != null
                  ? `${payload.photos.registered} di ${payload.photos.total}`
                  : payload.photos.total != null
                    ? String(payload.photos.total)
                    : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-steel">Lunghezza</dt>
              <dd className="font-semibold">{facts.lengthMm != null ? formatMm(facts.lengthMm) : "—"}</dd>
            </div>
            <div>
              <dt className="text-steel">Altezza</dt>
              <dd className="font-semibold">{facts.heightMm != null ? formatMm(facts.heightMm) : "—"}</dd>
            </div>
            {facts.widthMm != null ? (
              <div>
                <dt className="text-steel">Larghezza</dt>
                <dd className="font-semibold">{formatMm(facts.widthMm)}</dd>
              </div>
            ) : null}
            {facts.doors.map((door, index) => (
              <div key={`${door.widthMm}-${door.heightMm}-${index}`} className="col-span-2">
                <dt className="text-steel">{facts.doors.length > 1 ? `Porta ${index + 1}` : "Porta"}</dt>
                <dd className="font-semibold">
                  {formatMm(door.widthMm).replace(" mm", "")} × {formatMm(door.heightMm)}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      {payload?.warnings.map((warning) => (
        <p key={warning} className="notice-warn mt-3" role="status">
          {warning}
        </p>
      ))}

      {payload && !payload.empty ? (
        <>
          <div className="mt-4 flex gap-2">
            <button type="button" className={`chip ${view === "foto" ? "chip-on" : ""}`} onClick={() => setView("foto")}>
              Modello fotografico
            </button>
            <button type="button" className={`chip ${view === "step" ? "chip-on" : ""}`} onClick={() => setView("step")}>
              Pareti STEP
            </button>
          </div>

          <div className="mt-3">
            {view === "foto" ? (
              glb ? (
                <PhotoViewer src={glb} poster={poster} />
              ) : (
                <div className="viewer-stage">
                  <p className="viewer-error">Il modello fotografico non c’è ancora.</p>
                </div>
              )
            ) : payload.scene ? (
              <StepViewer scene={payload.scene as SceneDoc} />
            ) : (
              <div className="viewer-stage">
                <p className="viewer-error">Manca la geometria delle pareti.</p>
              </div>
            )}
          </div>

          <div className="mt-4 grid gap-2">
            {DOWNLOADS.filter((item) => present.has(item.name)).map((item) => (
              <a
                key={item.name}
                className={item.primary ? "btn-primary bg-accent text-ink" : "btn-secondary"}
                href={`/api/rilievi/${projectId}/scarica?file=${encodeURIComponent(item.name)}`}
              >
                {item.label}
              </a>
            ))}
          </div>

          {GALLERY.some((item) => present.has(item.name)) ? (
            <ul className="photo-grid mt-4">
              {GALLERY.filter((item) => present.has(item.name)).map((item) => {
                const url = payload.files.find((file) => file.name === item.name)?.viewUrl;
                if (!url) return null;
                return (
                  <li key={item.name}>
                    <a className="photo-tile" href={url} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt={item.label} />
                      <span>{item.label}</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </>
      ) : null}

      {payload ? (
        <section className="mt-5">
          <div className="flex gap-2">
            {(["stanza", "facciata"] as const).map((kind) => (
              <button key={kind} type="button" className={`chip ${mode === kind ? "chip-on" : ""}`} onClick={() => setMode(kind)}>
                {kindLabel(kind)}
              </button>
            ))}
          </div>
          <button type="button" className="btn-primary mt-3 w-full" disabled={!payload.engineReady || sending} onClick={() => void send()}>
            {sending ? "Invio…" : "Invia al motore"}
          </button>
          {!payload.engineReady ? (
            <p className="mt-2 text-sm text-steel">Il pulsante resta spento: sul server mancano RUNPOD_API_KEY o RUNPOD_ENDPOINT_ID.</p>
          ) : null}
          {sendError ? <p className="mt-2 text-sm text-danger">{sendError}</p> : null}
        </section>
      ) : null}
    </div>
  );
}
