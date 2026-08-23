import { PDFDocument } from "pdf-lib";
import type { Survey } from "../models/types";
import { canvasToPng } from "../media/image";
import { pageToCanvas } from "./page-canvas";

const A4_PT = { width: 595.28, height: 841.89 };

export async function exportSurveyPdf(survey: Survey): Promise<Blob> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(survey.title);
  pdf.setAuthor("Siderio Vcad");
  pdf.setCreator("Siderio Vcad");

  const pages = [...survey.pages].sort((a, b) => a.order - b.order);
  for (const page of pages) {
    const canvas = await pageToCanvas(page, 2);
    const png = await canvasToPng(canvas);
    const bytes = new Uint8Array(await png.arrayBuffer());
    const image = await pdf.embedPng(bytes);
    const landscape = page.format === "a4-landscape";
    const size =
      page.format.startsWith("a4")
        ? landscape
          ? { width: A4_PT.height, height: A4_PT.width }
          : A4_PT
        : { width: image.width, height: image.height };
    const pdfPage = pdf.addPage([size.width, size.height]);
    pdfPage.drawImage(image, {
      x: 0,
      y: 0,
      width: size.width,
      height: size.height,
    });
  }

  const bytes = await pdf.save();
  return new Blob([toArrayBuffer(bytes)], { type: "application/pdf" });
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
