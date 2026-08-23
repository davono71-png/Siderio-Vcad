"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog } from "../ui/Dialog";
import { captureFromVideo } from "@/lib/media/image";

export function CameraSheet({
  open,
  onClose,
  onCapture,
}: {
  open: boolean;
  onClose: () => void;
  onCapture: (blob: Blob, asBackground: boolean) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [asBackground, setAsBackground] = useState(false);
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setLive(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setLive(true);
        }
      } catch {
        setError("Fotocamera non disponibile. Usa la galleria.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  async function shoot() {
    if (!videoRef.current) return;
    const blob = await captureFromVideo(videoRef.current);
    onCapture(blob, asBackground);
  }

  function fromFile(file: File) {
    onCapture(file, asBackground);
  }

  if (!open) return null;

  return (
    <Dialog open={open} title="Fotografia" onClose={onClose}>
      {error ? <p className="mb-2 text-sm text-danger">{error}</p> : null}
      <video
        ref={videoRef}
        playsInline
        muted
        className="mb-3 max-h-64 w-full rounded-2xl bg-ink object-cover"
      />
      <label className="mb-3 flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={asBackground}
          onChange={(e) => setAsBackground(e.target.checked)}
        />
        Imposta come sfondo della pagina
      </label>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="btn-primary" disabled={!live} onClick={() => void shoot()}>
          Scatta
        </button>
        <button type="button" className="btn-secondary" onClick={() => fileRef.current?.click()}>
          Galleria
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) fromFile(f);
          e.target.value = "";
        }}
      />
    </Dialog>
  );
}
