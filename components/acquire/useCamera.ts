"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { captureStill, grabPreview, openRearCamera, setTorch, type OpenedCamera } from "@/lib/capture/camera";

export function useCamera() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolution, setResolution] = useState("");
  const [stillsVia, setStillsVia] = useState<OpenedCamera["stillsVia"] | null>(null);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    trackRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setReady(false);
    setOpening(false);
    setTorchOn(false);
  }, []);

  const start = useCallback(() => {
    setError(null);
    setOpening(true);
    const pending = openRearCamera();
    return pending.then(
      async (opened) => {
        try {
          streamRef.current = opened.stream;
          trackRef.current = opened.track;
          setTorchSupported(opened.torch);
          setResolution(opened.heightLabel);
          setStillsVia(opened.stillsVia);
          const video = videoRef.current;
          if (!video) {
            opened.stream.getTracks().forEach((track) => track.stop());
            throw new Error("Anteprima non pronta. Riprova.");
          }
          video.srcObject = opened.stream;
          await video.play();
          opened.track.onended = () => {
            setReady(false);
            setError("La fotocamera si è interrotta. Riavviala.");
          };
          setReady(true);
          setOpening(false);
        } catch (reason) {
          opened.stream.getTracks().forEach((track) => track.stop());
          setOpening(false);
          setReady(false);
          setError(reason instanceof Error ? reason.message : "Fotocamera non disponibile.");
        }
      },
      (reason: unknown) => {
        setOpening(false);
        setReady(false);
        setError(reason instanceof Error ? reason.message : "Fotocamera non disponibile.");
      },
    );
  }, []);

  const toggleTorch = useCallback(async () => {
    const track = trackRef.current;
    if (!track) return;
    const next = !torchOn;
    try {
      await setTorch(track, next);
      setTorchOn(next);
    } catch {
      setTorchOn(false);
      setTorchSupported(false);
    }
  }, [torchOn]);

  const shoot = useCallback(async () => {
    const video = videoRef.current;
    const track = trackRef.current;
    if (!video || !track) throw new Error("Fotocamera non attiva.");
    return captureStill(video, track);
  }, []);

  const sample = useCallback(() => {
    const video = videoRef.current;
    if (!video) return Promise.resolve(null);
    return grabPreview(video);
  }, []);

  const attachVideo = useCallback((node: HTMLVideoElement | null) => {
    videoRef.current = node;
  }, []);

  useEffect(() => stop, [stop]);

  return useMemo(
    () => ({
      attachVideo,
      sample,
      start,
      stop,
      shoot,
      ready,
      opening,
      error,
      resolution,
      stillsVia,
      torchSupported,
      torchOn,
      toggleTorch,
    }),
    [
      attachVideo,
      sample,
      start,
      stop,
      shoot,
      ready,
      opening,
      error,
      resolution,
      stillsVia,
      torchSupported,
      torchOn,
      toggleTorch,
    ],
  );
}
