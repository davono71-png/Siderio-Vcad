import type { SurveyPage } from "../models/types";
import { pageToCanvas } from "./page-canvas";

/**
 * Anteprima renderizzata di una pagina, pronta da mostrare altrove.
 *
 * La Suite non ha un motore di disegno e non deve averlo: duplicare
 * `lib/drawing/` in un secondo repo vuol dire due copie che divergono al primo
 * ritocco. Meglio far salire un'immagine gia' fatta e mostrarla e basta.
 *
 * WebP perche' la pagina esce con lo sfondo carta gia' dipinto — quindi opaca —
 * e a parita' di nitidezza sui tratti pesa circa un terzo di un PNG. Se il
 * browser non lo produce si ripiega su JPEG, che tutti sanno fare.
 */

/** 1× sulle dimensioni di pagina: un A4 esce a 1240×1754, che si legge bene. */
const SCALA = 1;
const QUALITA = 0.9;

export type AnteprimaPagina = {
  blob: Blob;
  mime: string;
};

export async function renderPagePreview(page: SurveyPage): Promise<AnteprimaPagina> {
  const canvas = await pageToCanvas(page, SCALA);
  const webp = await toBlob(canvas, "image/webp", QUALITA);
  if (webp) return { blob: webp, mime: "image/webp" };
  const jpeg = await toBlob(canvas, "image/jpeg", QUALITA);
  if (jpeg) return { blob: jpeg, mime: "image/jpeg" };
  throw new Error("Anteprima della pagina non generata");
}

function toBlob(
  canvas: HTMLCanvasElement,
  mime: string,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(
      (b) => resolve(b && b.type === mime ? b : null),
      mime,
      quality,
    );
  });
}
