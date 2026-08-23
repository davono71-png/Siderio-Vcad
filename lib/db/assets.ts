import type { AssetKind, AssetRecord } from "../models/types";
import { uid } from "../ids";
import { getDb } from "./client";

export type StoredAsset = AssetRecord & { blob: Blob };

export async function putAsset(input: {
  surveyId: string;
  kind: AssetKind;
  blob: Blob;
  name: string;
  mime?: string;
  width?: number;
  height?: number;
  id?: string;
}): Promise<StoredAsset> {
  const record: StoredAsset = {
    id: input.id ?? uid(),
    surveyId: input.surveyId,
    kind: input.kind,
    mime: input.mime ?? input.blob.type ?? "application/octet-stream",
    name: input.name,
    byteSize: input.blob.size,
    width: input.width,
    height: input.height,
    createdAt: new Date().toISOString(),
    blob: input.blob,
  };
  const db = await getDb();
  await db.put("assets", record);
  return record;
}

export async function getAsset(id: string): Promise<StoredAsset | undefined> {
  const db = await getDb();
  return db.get("assets", id);
}

export async function getAssetsForSurvey(surveyId: string): Promise<StoredAsset[]> {
  const db = await getDb();
  return db.getAllFromIndex("assets", "by-survey", surveyId);
}

export async function deleteAsset(id: string): Promise<void> {
  const db = await getDb();
  await db.delete("assets", id);
}

export async function deleteAssetsForSurvey(surveyId: string): Promise<void> {
  const assets = await getAssetsForSurvey(surveyId);
  const db = await getDb();
  const tx = db.transaction("assets", "readwrite");
  await Promise.all(assets.map((a) => tx.store.delete(a.id)));
  await tx.done;
}
