import JSZip from "jszip";
import type { Survey } from "../models/types";
import { canvasToJpeg, canvasToPng } from "../media/image";
import { pageToCanvas } from "./page-canvas";

export async function exportSurveyImages(
  survey: Survey,
  format: "png" | "jpeg" = "png",
): Promise<Blob> {
  const zip = new JSZip();
  const pages = [...survey.pages].sort((a, b) => a.order - b.order);
  for (let i = 0; i < pages.length; i++) {
    const canvas = await pageToCanvas(pages[i], 2);
    const blob =
      format === "png" ? await canvasToPng(canvas) : await canvasToJpeg(canvas, 0.9);
    const ext = format === "png" ? "png" : "jpg";
    const name = `${String(i + 1).padStart(2, "0")}-${slug(pages[i].title ?? `pagina-${i + 1}`)}.${ext}`;
    zip.file(name, blob);
  }
  return zip.generateAsync({ type: "blob" });
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "pagina";
}
