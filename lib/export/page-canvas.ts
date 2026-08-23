import type { ImageElement, SurveyPage } from "../models/types";
import { DrawingEngine } from "../drawing/engine";
import { DEFAULT_PEN_PREFS } from "../models/defaults";
import { getAsset } from "../db/assets";

export async function pageToCanvas(
  page: SurveyPage,
  scale = 2,
): Promise<HTMLCanvasElement> {
  const engine = new DrawingEngine(structuredClone(page), { ...DEFAULT_PEN_PREFS });
  for (const el of page.elements) {
    if (el.type !== "image") continue;
    await loadEngineImage(engine, el);
  }
  return engine.renderExportCanvas(scale);
}

async function loadEngineImage(engine: DrawingEngine, el: ImageElement) {
  const previewId = el.previewAssetId ?? el.assetId;
  const asset = (await getAsset(previewId)) ?? (await getAsset(el.assetId));
  if (!asset) return;
  const url = URL.createObjectURL(asset.blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("img"));
      image.src = url;
    });
    engine.images.set(el.assetId, img);
    if (el.previewAssetId) engine.images.set(el.previewAssetId, img);
  } finally {
    URL.revokeObjectURL(url);
  }
}
