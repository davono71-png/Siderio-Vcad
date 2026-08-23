import type { ImageElement, SurveyPage } from "../models/types";
import type { DrawingEngine } from "../drawing/engine";
import { getAsset } from "../db/assets";
import { loadImage } from "./image";

export async function hydratePageImages(
  engine: DrawingEngine,
  page: SurveyPage,
): Promise<void> {
  const jobs: Promise<void>[] = [];
  for (const el of page.elements) {
    if (el.type !== "image") continue;
    jobs.push(loadIntoEngine(engine, el));
  }
  await Promise.all(jobs);
  engine.dirtyFull = true;
  engine.emit();
}

async function loadIntoEngine(engine: DrawingEngine, el: ImageElement) {
  const key = el.previewAssetId ?? el.assetId;
  if (engine.images.has(key) || engine.images.has(el.assetId)) return;
  const asset = (await getAsset(key)) ?? (await getAsset(el.assetId));
  if (!asset) return;
  const url = URL.createObjectURL(asset.blob);
  try {
    const img = await loadImage(url);
    engine.images.set(el.assetId, img);
    if (el.previewAssetId) engine.images.set(el.previewAssetId, img);
  } finally {
    URL.revokeObjectURL(url);
  }
}
