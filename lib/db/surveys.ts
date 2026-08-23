import { createSurvey } from "../models/defaults";
import type { PenPrefs, Survey } from "../models/types";
import { uid } from "../ids";
import { getDb } from "./client";
import { deleteAssetsForSurvey, getAsset } from "./assets";

function perData(a: Survey, b: Survey): number {
  return a.updatedAt < b.updatedAt ? 1 : -1;
}

export async function listSurveys(): Promise<Survey[]> {
  const db = await getDb();
  const all = await db.getAll("surveys");
  return all.sort(perData);
}

export async function getSurvey(id: string): Promise<Survey | undefined> {
  const db = await getDb();
  return db.get("surveys", id);
}

export async function saveSurvey(survey: Survey): Promise<void> {
  const db = await getDb();
  survey.updatedAt = new Date().toISOString();
  await db.put("surveys", survey);
}

export async function createAndSaveSurvey(input: {
  title: string;
  description?: string;
  date?: string;
}): Promise<Survey> {
  const survey = createSurvey(input);
  await saveSurvey(survey);
  return survey;
}

export async function deleteSurvey(id: string): Promise<void> {
  await deleteAssetsForSurvey(id);
  const db = await getDb();
  await db.delete("surveys", id);
}

export async function renameSurvey(id: string, title: string): Promise<Survey | undefined> {
  const survey = await getSurvey(id);
  if (!survey) return undefined;
  survey.title = title.trim() || survey.title;
  await saveSurvey(survey);
  return survey;
}

export async function duplicateSurvey(id: string): Promise<Survey | undefined> {
  const survey = await getSurvey(id);
  if (!survey) return undefined;
  const copy: Survey = structuredClone(survey);
  copy.id = uid();
  copy.title = `${survey.title} (copia)`;
  copy.createdAt = new Date().toISOString();
  copy.updatedAt = copy.createdAt;

  const { getAssetsForSurvey, putAsset } = await import("./assets");
  const assets = await getAssetsForSurvey(id);
  const remap = new Map<string, string>();
  for (const asset of assets) {
    const next = await putAsset({
      surveyId: copy.id,
      kind: asset.kind,
      blob: asset.blob,
      name: asset.name,
      mime: asset.mime,
      width: asset.width,
      height: asset.height,
    });
    remap.set(asset.id, next.id);
  }

  if (copy.thumbnailAssetId) {
    copy.thumbnailAssetId = remap.get(copy.thumbnailAssetId);
  }
  for (const page of copy.pages) {
    page.id = uid();
    for (const el of page.elements) {
      el.id = uid();
      if (el.type === "image") {
        el.assetId = remap.get(el.assetId) ?? el.assetId;
        if (el.previewAssetId) {
          el.previewAssetId = remap.get(el.previewAssetId) ?? el.previewAssetId;
        }
      }
      if (el.type === "cad") {
        el.assetId = remap.get(el.assetId) ?? el.assetId;
      }
    }
  }

  await saveSurvey(copy);
  return copy;
}

export async function getThumbnailUrl(survey: Survey): Promise<string | undefined> {
  if (!survey.thumbnailAssetId) return undefined;
  const asset = await getAsset(survey.thumbnailAssetId);
  if (!asset) return undefined;
  return URL.createObjectURL(asset.blob);
}

export async function loadPenPrefs(): Promise<PenPrefs | undefined> {
  const db = await getDb();
  const row = await db.get("settings", "pen");
  return row?.penPrefs;
}

export async function savePenPrefs(penPrefs: PenPrefs): Promise<void> {
  const db = await getDb();
  await db.put("settings", { key: "pen", penPrefs });
}
