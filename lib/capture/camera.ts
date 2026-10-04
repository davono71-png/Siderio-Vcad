const PERMISSION_MSG =
  "Accesso alla fotocamera negato. Consenti la fotocamera per questo sito e riprova. Su Android: lucchetto nella barra degli indirizzi. Su iPhone: Impostazioni → Safari → Fotocamera → Consenti.";

type RichCaps = MediaTrackCapabilities & {
  torch?: boolean;
  focusMode?: string[];
  exposureMode?: string[];
  whiteBalanceMode?: string[];
};

type RichConstraint = MediaTrackConstraintSet & {
  torch?: boolean;
  focusMode?: string;
  exposureMode?: string;
  whiteBalanceMode?: string;
};

export type OpenedCamera = {
  stream: MediaStream;
  track: MediaStreamTrack;
  width: number;
  height: number;
  heightLabel: string;
  torch: boolean;
  stillsVia: "imagecapture" | "frame";
};

export function cameraErrorMessage(error: unknown) {
  if (!error || typeof error !== "object") return "Fotocamera non disponibile.";
  const name = "name" in error ? String(error.name) : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
    return PERMISSION_MSG;
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "Nessuna fotocamera trovata su questo dispositivo.";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "La fotocamera è già in uso da un’altra app. Chiudila e riprova.";
  }
  if (name === "OverconstrainedError") {
    return "Il browser non riesce ad aprire la fotocamera posteriore con queste impostazioni.";
  }
  if (error instanceof Error && error.message) return error.message;
  return "Fotocamera non disponibile.";
}

/**
 * Opens the rear camera.
 * getUserMedia is invoked synchronously by the caller’s click, before any await,
 * so iOS Safari still treats it as a user gesture.
 * Where ImageCapture exists, the preview stays near 1080p (smooth) and the still
 * is requested at the sensor maximum. Otherwise the video frame is the still,
 * so the stream itself asks for the highest resolution.
 */
export function openRearCamera(): Promise<OpenedCamera> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return Promise.reject(
      new Error("Questo browser non espone la fotocamera. Usa Chrome o Safari su HTTPS."),
    );
  }
  if (!window.isSecureContext) {
    return Promise.reject(
      new Error("La fotocamera richiede HTTPS. L’anteprima Vercel è adatta; in locale usa localhost."),
    );
  }

  const imageCapture = typeof ImageCapture === "function";
  const video: MediaTrackConstraints = {
    facingMode: { ideal: "environment" },
    width: { ideal: imageCapture ? 1920 : 3840 },
    height: { ideal: imageCapture ? 1080 : 2160 },
    frameRate: { ideal: 30 },
  };

  return navigator.mediaDevices.getUserMedia({ audio: false, video }).then(async (stream) => {
    const track = stream.getVideoTracks()[0];
    if (!track) {
      stream.getTracks().forEach((item) => item.stop());
      throw new Error("Nessuna traccia video dalla fotocamera.");
    }
    if (!imageCapture) await boostResolution(track);
    await preferContinuousAeAf(track);
    const settings = track.getSettings();
    const width = settings.width ?? 0;
    const height = settings.height ?? 0;
    return {
      stream,
      track,
      width,
      height,
      heightLabel: width && height ? `${width}×${height}` : "",
      torch: supportsTorch(track),
      stillsVia: imageCapture ? "imagecapture" : "frame",
    };
  }, (error: unknown) => {
    throw new Error(cameraErrorMessage(error));
  });
}

export async function setTorch(track: MediaStreamTrack, on: boolean) {
  await track.applyConstraints({ advanced: [{ torch: on } as RichConstraint] });
}

export async function captureStill(video: HTMLVideoElement, track: MediaStreamTrack) {
  if (typeof ImageCapture === "function") {
    try {
      const capture = new ImageCapture(track);
      const blob = await takePhotoAtMax(capture);
      if (blob && blob.size > 0) return blob;
    } catch {
      /* Fall back to the current video frame. */
    }
  }
  return frameToJpeg(video, 0.92);
}

export async function grabPreview(video: HTMLVideoElement) {
  const sourceW = video.videoWidth;
  const sourceH = video.videoHeight;
  if (!sourceW || !sourceH || video.readyState < 2) return null;
  const maxW = 320;
  const scale = Math.min(1, maxW / sourceW);
  const width = Math.max(16, Math.round(sourceW * scale));
  const height = Math.max(16, Math.round(sourceH * scale));

  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, width, height);
    const image = ctx.getImageData(0, 0, width, height);
    const thumb = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.72 });
    return { image, thumb, sourceWidth: sourceW, sourceHeight: sourceH };
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true, alpha: false });
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, width, height);
  const image = ctx.getImageData(0, 0, width, height);
  const thumb = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.72));
  if (!thumb) return null;
  return { image, thumb, sourceWidth: sourceW, sourceHeight: sourceH };
}

async function takePhotoAtMax(capture: ImageCapture) {
  try {
    const caps = await capture.getPhotoCapabilities();
    const settings: PhotoSettings = {};
    if (caps.imageWidth?.max) settings.imageWidth = caps.imageWidth.max;
    if (caps.imageHeight?.max) settings.imageHeight = caps.imageHeight.max;
    return await capture.takePhoto(settings);
  } catch {
    return capture.takePhoto();
  }
}

function frameToJpeg(video: HTMLVideoElement, quality: number) {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return Promise.reject(new Error("Il fotogramma non è ancora pronto."));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) return Promise.reject(new Error("Canvas non disponibile."));
  ctx.drawImage(video, 0, 0, width, height);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Impossibile codificare la foto."))),
      "image/jpeg",
      quality,
    );
  });
}

function supportsTorch(track: MediaStreamTrack) {
  const caps = (track.getCapabilities?.() ?? {}) as RichCaps;
  return Boolean(caps.torch);
}

async function boostResolution(track: MediaStreamTrack) {
  const caps = track.getCapabilities?.();
  const width = caps?.width?.max;
  const height = caps?.height?.max;
  if (!width || !height) return;
  try {
    await track.applyConstraints({
      width: { ideal: width },
      height: { ideal: height },
    });
  } catch {
    /* Keep the mode the browser already chose. */
  }
}

async function preferContinuousAeAf(track: MediaStreamTrack) {
  const caps = (track.getCapabilities?.() ?? {}) as RichCaps;
  const advanced: RichConstraint[] = [];
  if (caps.focusMode?.includes("continuous")) advanced.push({ focusMode: "continuous" });
  if (caps.exposureMode?.includes("continuous")) advanced.push({ exposureMode: "continuous" });
  if (caps.whiteBalanceMode?.includes("continuous")) advanced.push({ whiteBalanceMode: "continuous" });
  if (!advanced.length) return;
  try {
    await track.applyConstraints({ advanced });
  } catch {
    for (const item of advanced) {
      try {
        await track.applyConstraints({ advanced: [item] });
      } catch {
        /* This control is not usable on the open track. */
      }
    }
  }
}
