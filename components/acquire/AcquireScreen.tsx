"use client";

/* eslint-disable react-hooks/refs -- status fields are useState; methods only run from events */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { FrameAnalyzer } from "@/lib/capture/analyzer";
import { MotionTracker } from "@/lib/capture/motion";
import {
  AUTO_INTERVALS,
  hintFor,
  pushLaplacian,
  selectFrame,
  type CoverageSample,
} from "@/lib/capture/select";
import { getRepository } from "@/lib/data";
import { enqueueAcceptedPhoto } from "@/lib/upload/runner";
import { UploadStatus } from "../upload/UploadStatus";
import { orientedSize, readJpegInfoFromBlob } from "@/lib/jpeg";
import { Guidance } from "./Guidance";
import { ScanPreview, type FilmFrame } from "./ScanPreview";
import { useCamera } from "./useCamera";

const SKIP_TIPS = "siderio-skip-guidance";
const KEEP_REJECTED = "siderio-keep-rejected";

type Shot = FilmFrame & { direction: CoverageSample | null };

export function AcquireScreen({ projectId }: { projectId: string }) {
  const camera = useCamera();
  const motionRef = useRef<MotionTracker | null>(null);
  const analyzerRef = useRef<FrameAnalyzer | null>(null);
  const historyRef = useRef<number[]>([]);
  const busyRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const hintLockRef = useRef(0);
  const autoRef = useRef({ running: false, paused: false, interval: 2000 });
  const keepRef = useRef(false);
  const shotsRef = useRef<CoverageSample[]>([]);

  const [name, setName] = useState("Rilievo");
  const [missing, setMissing] = useState(false);
  const [tips, setTips] = useState(true);
  const [skipTips, setSkipTips] = useState(false);
  const [shots, setShots] = useState<Shot[]>([]);
  const [rejected, setRejected] = useState(0);
  const [hint, setHint] = useState("Inquadra la stanza e scatta");
  const [autoOn, setAutoOn] = useState(false);
  const [autoRun, setAutoRun] = useState<"off" | "running" | "paused">("off");
  const [intervalMs, setIntervalMs] = useState(2000);
  const [keepRejected, setKeepRejected] = useState(false);
  const [settings, setSettings] = useState(false);
  const [flash, setFlash] = useState(false);
  const [liveHeading, setLiveHeading] = useState<number | null>(null);
  const [sensors, setSensors] = useState(false);
  const urlsRef = useRef<string[]>([]);

  useEffect(() => {
    keepRef.current = keepRejected;
  }, [keepRejected]);

  useEffect(() => {
    autoRef.current.interval = intervalMs;
  }, [intervalMs]);

  useEffect(() => {
    shotsRef.current = shots
      .map((shot) => shot.direction)
      .filter((direction): direction is CoverageSample => direction != null);
  }, [shots]);

  useEffect(() => {
    const skip = window.localStorage.getItem(SKIP_TIPS) === "1";
    const keep = window.localStorage.getItem(KEEP_REJECTED) === "1";
    setTips(!skip);
    setSkipTips(skip);
    setKeepRejected(keep);
    keepRef.current = keep;

    const motion = new MotionTracker();
    const analyzer = new FrameAnalyzer();
    motionRef.current = motion;
    analyzerRef.current = analyzer;

    let cancelled = false;
    void (async () => {
      try {
        const repo = getRepository();
        const project = await repo.getProject(projectId);
        if (cancelled) return;
        if (!project) {
          setMissing(true);
          return;
        }
        setName(project.name);
        const [photos, thumbs] = await Promise.all([
          repo.listPhotos(projectId),
          repo.listThumbs(projectId),
        ]);
        if (cancelled) return;
        const thumbById = new Map(thumbs.map((thumb) => [thumb.id, thumb.blob]));
        const accepted: Shot[] = [];
        let rejectedCount = 0;
        for (const photo of photos) {
          if (!photo.accepted) {
            rejectedCount += 1;
            continue;
          }
          const blob = thumbById.get(photo.id);
          if (!blob) continue;
          const url = URL.createObjectURL(blob);
          if (cancelled) {
            URL.revokeObjectURL(url);
            continue;
          }
          urlsRef.current.push(url);
          accepted.push({
            id: photo.id,
            url,
            direction: photo.direction
              ? { headingDeg: photo.direction.headingDeg, elevationDeg: photo.direction.elevationDeg }
              : null,
          });
        }
        setShots(accepted);
        setRejected(rejectedCount);
        if (accepted.length > 0) setHint("Continua il giro, con sovrapposizione");
      } catch (error) {
        if (!cancelled) setHint(error instanceof Error ? error.message : "Archivio locale non disponibile");
      }
    })();

    const auto = autoRef.current;
    const timers = timerRef;
    const urls = urlsRef;
    return () => {
      cancelled = true;
      auto.running = false;
      if (timers.current != null) window.clearTimeout(timers.current);
      motion.stop();
      analyzer.dispose();
      for (const url of urls.current) URL.revokeObjectURL(url);
      urls.current = [];
    };
  }, [projectId]);

  const showHint = useCallback((text: string, lockMs = 1400) => {
    hintLockRef.current = performance.now() + lockMs;
    setHint(text);
  }, []);

  const previewHint = useCallback(async () => {
    const analyzer = analyzerRef.current;
    if (!analyzer) return;
    const preview = await camera.sample();
    if (!preview || busyRef.current) return;
    const analysis = await analyzer.analyze(preview.image);
    const snap = motionRef.current?.snapshot();
    historyRef.current = pushLaplacian(historyRef.current, analysis.laplacian);
    const decision = selectFrame(
      {
        laplacian: analysis.laplacian,
        difference: analysis.difference,
        cornersPerK: analysis.cornersPerK,
        gradient: analysis.gradient,
      },
      {
        recentLaplacians: historyRef.current.slice(0, -1),
        yawDeltaDeg: null,
        stepDetected: true,
        hasPrevious: false,
        gyroDegPerSec: snap?.gyroDegPerSec ?? null,
        recentAccel: snap?.recentAccel ?? null,
      },
    );
    if (decision.reason === "mosso" && performance.now() >= hintLockRef.current) {
      setHint("Tieni fermo il telefono");
    }
  }, [camera]);

  useEffect(() => {
    if (!camera.ready) return;
    const id = window.setInterval(() => {
      const motion = motionRef.current;
      const snap = motion?.snapshot();
      if (!snap) return;
      setLiveHeading(snap.direction?.headingDeg ?? null);
      setSensors(snap.sensors);
      if (busyRef.current || autoRef.current.running) return;
      if (performance.now() < hintLockRef.current) return;
      void previewHint();
    }, 700);
    return () => window.clearInterval(id);
  }, [camera.ready, previewHint]);

  const captureOnce = useCallback(async () => {
    if (busyRef.current || !camera.ready) return;
    const analyzer = analyzerRef.current;
    const motion = motionRef.current;
    if (!analyzer || !motion) return;

    busyRef.current = true;
    setFlash(true);
    window.setTimeout(() => setFlash(false), 90);

    try {
      const preview = await camera.sample();
      if (!preview) {
        showHint("Attendi che l’anteprima sia pronta");
        return;
      }
      const analysis = await analyzer.analyze(preview.image);
      const snap = motion.snapshot();
      const recent = historyRef.current;
      const decision = selectFrame(
        {
          laplacian: analysis.laplacian,
          difference: analysis.difference,
          cornersPerK: analysis.cornersPerK,
          gradient: analysis.gradient,
        },
        {
          recentLaplacians: recent,
          yawDeltaDeg: snap.yawDeltaDeg,
          stepDetected: snap.stepDetected,
          hasPrevious: analyzer.lastAccepted != null,
          gyroDegPerSec: snap.gyroDegPerSec,
          recentAccel: snap.recentAccel,
        },
      );
      historyRef.current = pushLaplacian(recent, analysis.laplacian);
      const text = hintFor({
        decision,
        shots: shotsRef.current,
        sensors: snap.sensors,
      });

      if (!decision.accept && !keepRef.current) {
        setRejected((count) => count + 1);
        showHint(text);
        navigator.vibrate?.([18, 40, 18]);
        return;
      }

      const blob = await camera.shoot();
      const info = await readJpegInfoFromBlob(blob);
      const width = info.width || preview.sourceWidth;
      const height = info.height || preview.sourceHeight;
      const oriented = orientedSize(width, height, info.orientation || 1);
      const meta = await getRepository().addPhoto({
        projectId,
        blob,
        thumb: preview.thumb,
        accepted: decision.accept,
        rejectReason: decision.reason,
        warnings: decision.warnings,
        width,
        height,
        exifOrientation: info.orientation || 1,
        orientedWidth: oriented.width || width,
        orientedHeight: oriented.height || height,
        pose: snap.pose,
        direction: snap.direction,
        motion: {
          stepDetected: snap.stepDetected,
          yawDeltaDeg: snap.yawDeltaDeg,
          accelMagnitude: snap.accelMagnitude,
          gyroDegPerSec: snap.gyroDegPerSec,
        },
        quality: {
          laplacianVariance: analysis.laplacian,
          difference: analysis.difference,
          threshold: decision.threshold,
          cornersPerK: analysis.cornersPerK,
          gradient: analysis.gradient,
        },
      });

      if (decision.accept) {
        void enqueueAcceptedPhoto(meta);
        analyzer.remember(analysis);
        motion.markAccepted(snap.direction);
        const url = URL.createObjectURL(preview.thumb);
        urlsRef.current.push(url);
        setShots((current) => [
          ...current,
          {
            id: meta.id,
            url,
            direction: snap.direction
              ? { headingDeg: snap.direction.headingDeg, elevationDeg: snap.direction.elevationDeg }
              : null,
          },
        ]);
        navigator.vibrate?.(12);
      } else {
        setRejected((count) => count + 1);
      }
      showHint(text);
    } catch (error) {
      showHint(error instanceof Error ? error.message : "Scatto non riuscito");
    } finally {
      busyRef.current = false;
    }
  }, [camera, projectId, showHint]);

  const stopAuto = useCallback(() => {
    autoRef.current.running = false;
    autoRef.current.paused = false;
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    setAutoRun("off");
  }, []);

  const loop = useCallback(async () => {
    if (!autoRef.current.running || autoRef.current.paused) return;
    const started = performance.now();
    await captureOnce();
    if (!autoRef.current.running || autoRef.current.paused) return;
    const wait = Math.max(80, autoRef.current.interval - (performance.now() - started));
    timerRef.current = window.setTimeout(() => void loop(), wait);
  }, [captureOnce]);

  const startAuto = useCallback(() => {
    autoRef.current.running = true;
    autoRef.current.paused = false;
    setAutoOn(true);
    setAutoRun("running");
    void loop();
  }, [loop]);

  const pauseAuto = useCallback(() => {
    autoRef.current.paused = true;
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    setAutoRun("paused");
  }, []);

  const resumeAuto = useCallback(() => {
    if (!autoRef.current.running) {
      startAuto();
      return;
    }
    autoRef.current.paused = false;
    setAutoRun("running");
    void loop();
  }, [loop, startAuto]);

  function begin() {
    if (skipTips) window.localStorage.setItem(SKIP_TIPS, "1");
    else window.localStorage.removeItem(SKIP_TIPS);
    const motion = motionRef.current ?? new MotionTracker();
    motionRef.current = motion;
    const sensorsPromise = motion.requestPermission();
    const cameraPromise = camera.start();
    motion.start();
    setTips(false);
    void sensorsPromise;
    void cameraPromise;
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.code !== "Space" || event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) {
        return;
      }
      if (!camera.ready || tips) return;
      event.preventDefault();
      if (autoOn && autoRun === "running") pauseAuto();
      else if (autoOn && autoRun === "paused") resumeAuto();
      else void captureOnce();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [autoOn, autoRun, camera.ready, captureOnce, pauseAuto, resumeAuto, tips]);

  if (missing) {
    return (
      <div className="page">
        <p>Rilievo non trovato.</p>
        <Link href="/" className="btn-primary mt-4 inline-flex items-center">
          Torna ai rilievi
        </Link>
      </div>
    );
  }

  const accepted = shots.length;

  return (
    <div className="acquire">
      <video ref={camera.attachVideo} className="acquire-video" playsInline muted autoPlay />
      <div className={`acquire-flash ${flash ? "on" : ""}`} />

      {tips ? <Guidance onStart={begin} skipNext={skipTips} onSkipNext={setSkipTips} /> : null}

      {!tips && !camera.ready ? (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-ink/90 px-6 text-center text-white">
          <p className="max-w-sm text-base leading-relaxed">
            {camera.opening ? "Apertura della fotocamera posteriore…" : camera.error}
          </p>
          {!camera.opening ? (
            <button type="button" className="btn-primary bg-accent text-ink" onClick={begin}>
              {camera.error ? "Riprova" : "Avvia fotocamera"}
            </button>
          ) : null}
          <Link href={`/rilievo/${projectId}`} className="text-sm text-white/80 underline">
            Torna al rilievo
          </Link>
        </div>
      ) : null}

      {!tips && camera.ready ? (
        <>
          <header className="acquire-top">
            <Link href={`/rilievo/${projectId}`} className="icon-btn" aria-label="Chiudi acquisizione">
              ←
            </Link>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{name}</p>
              <p className="text-xs text-white/70">
                {accepted} ok · {rejected} scarti
                {camera.resolution ? ` · ${camera.resolution}` : ""}
                {camera.stillsVia === "frame" ? " · fotogramma" : ""}
              </p>
              <UploadStatus projectId={projectId} compact />
            </div>
            {camera.torchSupported ? (
              <button
                type="button"
                className={`icon-btn ${camera.torchOn ? "bg-accent text-ink" : ""}`}
                aria-pressed={camera.torchOn}
                onClick={() => void camera.toggleTorch()}
              >
                Luce
              </button>
            ) : null}
            <button type="button" className="icon-btn" aria-label="Impostazioni di scatto" onClick={() => setSettings(true)}>
              ···
            </button>
          </header>

          <p className="acquire-hint" aria-live="polite">
            {hint}
          </p>
          {!sensors ? (
            <p className="acquire-sensor">Senza bussola la mappa non si riempie. Le foto si salvano lo stesso.</p>
          ) : null}

          <ScanPreview shots={shotsRefDirections(shots)} liveHeading={liveHeading} frames={shots} />

          <footer className="acquire-controls">
            <button
              type="button"
              className={`mode-chip ${!autoOn ? "on" : ""}`}
              onClick={() => {
                stopAuto();
                setAutoOn(false);
              }}
            >
              Manuale
            </button>
            <button
              type="button"
              className={`shutter ${autoRun === "running" ? "auto" : ""}`}
              aria-label={autoOn ? (autoRun === "running" ? "Pausa scatto automatico" : "Avvia scatto automatico") : "Scatta"}
              onClick={() => {
                if (!autoOn) void captureOnce();
                else if (autoRun === "running") pauseAuto();
                else startAuto();
              }}
            />
            <button
              type="button"
              className={`mode-chip ${autoOn ? "on" : ""}`}
              onClick={() => {
                setAutoOn(true);
                if (autoRun === "off") startAuto();
              }}
            >
              Auto {intervalMs === 1000 ? "1 s" : "2 s"}
            </button>
          </footer>

          {autoOn && autoRun !== "off" ? (
            <button type="button" className="auto-stop" onClick={stopAuto}>
              Stop auto
            </button>
          ) : null}
        </>
      ) : null}

      {settings ? (
        <div className="absolute inset-0 z-40 flex items-end bg-black/50" onClick={() => setSettings(false)}>
          <div
            className="w-full rounded-t-3xl bg-paper p-4 text-ink"
            style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="font-serif text-xl">Scatto</h2>
            <p className="mt-3 text-sm font-semibold">Intervallo automatico</p>
            <div className="mt-2 flex gap-2">
              {AUTO_INTERVALS.map((item) => (
                <button
                  key={item.ms}
                  type="button"
                  className={`chip ${intervalMs === item.ms ? "chip-on" : ""}`}
                  onClick={() => setIntervalMs(item.ms)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <label className="mt-4 flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 accent-accent"
                checked={keepRejected}
                onChange={(event) => {
                  const value = event.target.checked;
                  setKeepRejected(value);
                  keepRef.current = value;
                  window.localStorage.setItem(KEEP_REJECTED, value ? "1" : "0");
                }}
              />
              <span>
                Conserva le foto scartate (debug). Restano fuori dalla pellicola e finiscono nella cartella{" "}
                <em>scartate</em> dello ZIP.
              </span>
            </label>
            <button
              type="button"
              className="btn-secondary mt-4 w-full"
              onClick={() => {
                setSettings(false);
                setTips(true);
              }}
            >
              Rileggi i consigli
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function shotsRefDirections(shots: Shot[]): CoverageSample[] {
  return shots
    .map((shot) => shot.direction)
    .filter((direction): direction is CoverageSample => direction != null);
}
