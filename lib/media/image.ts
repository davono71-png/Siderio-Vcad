export async function ingestImageFile(file: Blob): Promise<{
  original: Blob;
  preview: Blob;
  width: number;
  height: number;
  previewWidth: number;
  previewHeight: number;
}> {
  const original =
    file.type && file.type.startsWith("image/")
      ? file
      : new Blob([file], { type: "image/jpeg" });

  let width: number;
  let height: number;
  let draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(original);
    width = bitmap.width;
    height = bitmap.height;
    draw = (ctx, w, h) => ctx.drawImage(bitmap, 0, 0, w, h);
    const result = await rasterPreview(width, height, draw);
    bitmap.close();
    return { original, preview: result.preview, width, height, ...result.size };
  }

  const url = URL.createObjectURL(original);
  try {
    const img = await loadImage(url);
    width = img.naturalWidth;
    height = img.naturalHeight;
    draw = (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h);
    const result = await rasterPreview(width, height, draw);
    return { original, preview: result.preview, width, height, ...result.size };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function rasterPreview(
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
) {
  // Copia d'archivio, non anteprima: l'originale a piena risoluzione non lascia
  // mai il dispositivo, quindi questa è l'unica versione che sopravvive.
  const maxEdge = 3072;
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const previewWidth = Math.max(1, Math.round(width * scale));
  const previewHeight = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = previewWidth;
  canvas.height = previewHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D non disponibile");
  draw(ctx, previewWidth, previewHeight);
  const preview = await canvasToJpeg(canvas, 0.86);
  return { preview, size: { previewWidth, previewHeight } };
}

export async function captureFromVideo(video: HTMLVideoElement): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth || 1600;
  canvas.height = video.videoHeight || 1200;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D non disponibile");
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvasToJpeg(canvas, 0.92);
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Immagine non caricata"));
    img.src = url;
  });
}

export async function canvasToJpeg(
  canvas: HTMLCanvasElement,
  quality = 0.85,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Export canvas fallito"))),
      "image/jpeg",
      quality,
    );
  });
}

export async function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Export canvas fallito"))),
      "image/png",
    );
  });
}
