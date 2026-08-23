import type { AssetRecord, Survey } from "../models/types";
import { getAssetsForSurvey, putAsset, type StoredAsset } from "../db/assets";
import { saveSurvey } from "../db/surveys";
import { uid } from "../ids";

const MAGIC = "SRILIEVO1";

type ProjectFile = {
  magic: typeof MAGIC;
  version: 1;
  exportedAt: string;
  survey: Survey;
  assets: {
    id: string;
    meta: AssetRecord;
    data: string;
  }[];
};

export async function exportProject(survey: Survey): Promise<Blob> {
  const assets = await getAssetsForSurvey(survey.id);
  const packed: ProjectFile = {
    magic: MAGIC,
    version: 1,
    exportedAt: new Date().toISOString(),
    survey,
    assets: await Promise.all(
      assets.map(async (a) => ({
        id: a.id,
        meta: stripBlob(a),
        data: await blobToBase64(a.blob),
      })),
    ),
  };
  const json = new TextEncoder().encode(JSON.stringify(packed));
  const compressed = await gzip(json);
  const header = new TextEncoder().encode(`${MAGIC}\n`);
  const out = new Uint8Array(header.length + compressed.length);
  out.set(header, 0);
  out.set(compressed, header.length);
  return new Blob([out], { type: "application/octet-stream" });
}

export async function importProject(file: Blob): Promise<Survey> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const decoded = await decodeProject(buf);
  if (decoded.magic !== MAGIC || !decoded.survey) {
    throw new Error("File .srilievo non valido");
  }

  const idMap = new Map<string, string>();
  const newSurveyId = uid();
  for (const asset of decoded.assets) {
    const blob = base64ToBlob(asset.data, asset.meta.mime);
    const next = await putAsset({
      surveyId: newSurveyId,
      kind: asset.meta.kind,
      blob,
      name: asset.meta.name,
      mime: asset.meta.mime,
      width: asset.meta.width,
      height: asset.meta.height,
    });
    idMap.set(asset.id, next.id);
  }

  const survey: Survey = structuredClone(decoded.survey);
  survey.id = newSurveyId;
  survey.createdAt = new Date().toISOString();
  survey.updatedAt = survey.createdAt;
  if (survey.thumbnailAssetId) {
    survey.thumbnailAssetId = idMap.get(survey.thumbnailAssetId);
  }
  for (const page of survey.pages) {
    page.id = uid();
    for (const el of page.elements) {
      el.id = uid();
      if (el.type === "image") {
        el.assetId = idMap.get(el.assetId) ?? el.assetId;
        if (el.previewAssetId) {
          el.previewAssetId = idMap.get(el.previewAssetId) ?? el.previewAssetId;
        }
      }
      if (el.type === "cad") {
        el.assetId = idMap.get(el.assetId) ?? el.assetId;
      }
    }
  }
  await saveSurvey(survey);
  return survey;
}

async function decodeProject(buf: Uint8Array): Promise<ProjectFile> {
  const text = new TextDecoder().decode(buf.slice(0, 16));
  if (text.startsWith(MAGIC)) {
    const nl = buf.indexOf(10);
    const body = buf.slice(nl + 1);
    try {
      const unzipped = await gunzip(body);
      return JSON.parse(new TextDecoder().decode(unzipped)) as ProjectFile;
    } catch {
      return JSON.parse(new TextDecoder().decode(body)) as ProjectFile;
    }
  }
  return JSON.parse(new TextDecoder().decode(buf)) as ProjectFile;
}

function stripBlob(a: StoredAsset): AssetRecord {
  return {
    id: a.id,
    surveyId: a.surveyId,
    kind: a.kind,
    mime: a.mime,
    name: a.name,
    byteSize: a.byteSize,
    width: a.width,
    height: a.height,
    createdAt: a.createdAt,
  };
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return btoa(bin);
}

function base64ToBlob(data: string, mime: string): Blob {
  const bin = atob(data);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new Blob([buf], { type: mime });
}

async function gzip(data: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === "undefined") return data;
  const stream = new Blob([toArrayBuffer(data)])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") return data;
  const stream = new Blob([toArrayBuffer(data)])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
