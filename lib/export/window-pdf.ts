import { PDFDocument } from "pdf-lib";
import type { SurveyPage } from "../models/types";
import { pageToCanvas } from "./page-canvas";
import { canvasToPng } from "../media/image";

const A4_PT = { width: 595.28, height: 841.89 };

export async function exportWindowPdf(
  page: SurveyPage,
  a: { x: number; y: number },
  b: { x: number; y: number },
): Promise<Blob> {
  const scale = 2;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const w = Math.max(8, Math.abs(b.x - a.x));
  const h = Math.max(8, Math.abs(b.y - a.y));
  const full = await pageToCanvas(page, scale);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D non disponibile");
  ctx.drawImage(
    full,
    x * scale,
    y * scale,
    w * scale,
    h * scale,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  const png = await canvasToPng(canvas);
  const pdf = await PDFDocument.create();
  pdf.setTitle("Riquadro");
  pdf.setCreator("Siderio Vcad");
  const bytes = new Uint8Array(await png.arrayBuffer());
  const image = await pdf.embedPng(bytes);
  const landscape = w > h;
  const size = landscape
    ? { width: A4_PT.height, height: A4_PT.width }
    : A4_PT;
  const pdfPage = pdf.addPage([size.width, size.height]);
  const fit = Math.min(size.width / image.width, size.height / image.height);
  const dw = image.width * fit;
  const dh = image.height * fit;
  pdfPage.drawImage(image, {
    x: (size.width - dw) / 2,
    y: (size.height - dh) / 2,
    width: dw,
    height: dh,
  });
  const out = await pdf.save();
  const copy = new Uint8Array(out.byteLength);
  copy.set(out);
  return new Blob([copy.buffer], { type: "application/pdf" });
}
