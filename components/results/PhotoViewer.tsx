"use client";

import { useEffect, useRef, useState } from "react";

type ViewerEl = HTMLElement & {
  cameraOrbit: string;
  cameraTarget: string;
  fieldOfView: string;
  getCameraOrbit: () => { theta: number; phi: number; radius: number };
  jumpCameraToGoal: () => void;
};

export function PhotoViewer({ src, poster }: { src: string; poster?: string | null }) {
  const node = useRef<ViewerEl | null>(null);
  const home = useRef<string | null>(null);
  const [libraryReady, setLibraryReady] = useState(false);
  const [progress, setProgress] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void import("@google/model-viewer")
      .then(() => {
        if (!cancelled) setLibraryReady(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const viewer = node.current;
    if (!viewer || !libraryReady) return;
    const onProgress = (event: Event) => {
      const detail = (event as CustomEvent<{ totalProgress?: number }>).detail;
      const value = detail?.totalProgress;
      if (typeof value === "number" && Number.isFinite(value)) setProgress(Math.max(0, Math.min(1, value)));
    };
    const onLoad = () => {
      setProgress(1);
      window.requestAnimationFrame(() => {
        const orbit = viewer.getCameraOrbit();
        home.current = `${orbit.theta}rad ${orbit.phi}rad ${orbit.radius}m`;
      });
    };
    const onError = () => setFailed(true);
    viewer.addEventListener("progress", onProgress);
    viewer.addEventListener("load", onLoad);
    viewer.addEventListener("error", onError);
    return () => {
      viewer.removeEventListener("progress", onProgress);
      viewer.removeEventListener("load", onLoad);
      viewer.removeEventListener("error", onError);
    };
  }, [libraryReady, src]);

  function reset() {
    const viewer = node.current;
    if (!viewer) return;
    viewer.cameraOrbit = home.current ?? "0deg 75deg auto";
    viewer.cameraTarget = "auto";
    viewer.fieldOfView = "auto";
    viewer.jumpCameraToGoal();
  }

  return (
    <div className="viewer-stage">
      {libraryReady ? (
        <model-viewer
          ref={(element) => {
            node.current = element as ViewerEl | null;
          }}
          src={src}
          poster={poster ?? undefined}
          alt="Modello fotografico del rilievo"
          // The mesh is stored in millimetres. At that size a phone depth buffer clips it away.
          scale="0.001 0.001 0.001"
          camera-orbit="28deg 68deg auto"
          camera-controls
          loading="eager"
          touch-action="none"
          interaction-prompt="none"
          environment-image="neutral"
          shadow-intensity="0.4"
          exposure="1"
          crossorigin="anonymous"
        />
      ) : null}
      {progress < 1 && !failed ? (
        <div
          className="viewer-progress"
          role="progressbar"
          aria-label="Caricamento del modello"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
        >
          <span className={progress > 0 ? undefined : "indeterminate"} style={progress > 0 ? { width: `${Math.round(progress * 100)}%` } : undefined} />
        </div>
      ) : null}
      {failed ? <p className="viewer-error">Il modello fotografico non si è caricato.</p> : null}
      <button type="button" className="viewer-reset" onClick={reset}>
        Ripristina vista
      </button>
    </div>
  );
}
