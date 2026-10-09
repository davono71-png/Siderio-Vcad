import { isUuid } from "@/lib/storage/keys";
import { ensureBrowserGetCors, listObjects, presignGet, readObjectText, StorageConfigError } from "@/lib/storage/r2";
import { isResultName, isViewable, RESULT_PRESIGN_SECONDS, resultObjectKey, viewContentType, type ResultName } from "./files";
import type { SceneDoc } from "./scene";
import type { JobStatusDoc, ResultsPayload } from "./types";

export type { JobStatusDoc, ResultsPayload };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseJson(raw: string | null) {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function warningsFrom(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
}

function sceneFrom(value: unknown): SceneDoc | null {
  const record = asRecord(value);
  if (!record) return null;
  return record as SceneDoc;
}

function statusFrom(value: unknown): JobStatusDoc | null {
  const record = asRecord(value);
  if (!record) return null;
  const progress = typeof record.progress === "number" && Number.isFinite(record.progress) ? record.progress : null;
  return {
    ok: typeof record.ok === "boolean" ? record.ok : null,
    stage: text(record.stage),
    progress,
    message: text(record.message),
    error: text(record.error),
    updatedAt: text(record.updatedAt),
  };
}

function collectWarnings(scene: SceneDoc | null, statusRaw: unknown, scaleRaw: unknown, diagnosticRaw: unknown) {
  const found: string[] = [];
  const push = (value: unknown) => {
    const line = text(value);
    if (line && !found.includes(line)) found.push(line);
  };
  push(asRecord(scene?.scale)?.warning);
  for (const line of warningsFrom(scene?.warnings)) push(line);
  push(asRecord(scaleRaw)?.warning);
  push(asRecord(asRecord(diagnosticRaw)?.scale)?.warning);
  for (const line of warningsFrom(asRecord(statusRaw)?.warnings)) push(line);
  return found;
}

function photosFrom(diagnosticRaw: unknown) {
  const diagnostic = asRecord(diagnosticRaw);
  const sfm = asRecord(diagnostic?.sfm);
  const registered = typeof sfm?.registered === "number" ? sfm.registered : null;
  const total = typeof sfm?.total === "number" ? sfm.total : typeof diagnostic?.images === "number" ? diagnostic.images : null;
  return { registered, total };
}

function kindFrom(scene: SceneDoc | null, projectRaw: unknown): "stanza" | "facciata" | null {
  if (scene?.mode === "facciata" || scene?.mode === "stanza") return scene.mode;
  const project = asRecord(asRecord(projectRaw)?.project);
  const kind = project?.kind;
  return kind === "facciata" || kind === "stanza" ? kind : null;
}

export function engineReady() {
  return Boolean(process.env.RUNPOD_API_KEY?.trim() && process.env.RUNPOD_ENDPOINT_ID?.trim());
}

export async function loadResults(projectId: string): Promise<ResultsPayload> {
  if (!isUuid(projectId)) throw new Error("bad_id");
  await ensureBrowserGetCors().catch(() => undefined);
  const prefix = `rilievi/${projectId}/risultati/`;
  const listed = await listObjects(prefix);
  const present = new Map<ResultName, number>();
  for (const item of listed) {
    const name = item.key.slice(prefix.length);
    if (isResultName(name)) present.set(name, item.size);
  }

  async function read(name: ResultName) {
    if (!present.has(name)) return null;
    return parseJson(await readObjectText(resultObjectKey(projectId, name)));
  }

  const [sceneRaw, roomRaw, statusRaw, scaleRaw, diagnosticRaw, projectRaw] = await Promise.all([
    read("scene.json"),
    read("room.json"),
    read("status.json"),
    read("scale_report.json"),
    read("diagnostic.json"),
    parseJson(await readObjectText(`rilievi/${projectId}/project.json`)),
  ]);

  const scene = sceneFrom(sceneRaw) ?? sceneFrom(roomRaw);
  const status = statusFrom(statusRaw);
  const files = await Promise.all(
    [...present.entries()].map(async ([name, bytes]) => {
      if (!isViewable(name)) return { name, bytes, viewUrl: null };
      const signed = await presignGet({
        key: resultObjectKey(projectId, name),
        expiresIn: RESULT_PRESIGN_SECONDS,
        contentType: viewContentType(name),
      });
      return { name, bytes, viewUrl: signed.url };
    }),
  );

  const project = asRecord(asRecord(projectRaw)?.project);

  return {
    ok: true,
    projectId,
    empty: present.size === 0 && !status,
    name: text(project?.name),
    kind: kindFrom(scene, projectRaw),
    engineReady: engineReady(),
    files,
    scene,
    status,
    photos: photosFrom(diagnosticRaw),
    warnings: collectWarnings(scene, statusRaw, scaleRaw, diagnosticRaw),
  };
}

export async function downloadUrl(projectId: string, name: ResultName) {
  if (!isUuid(projectId)) throw new Error("bad_id");
  const key = resultObjectKey(projectId, name);
  const listed = await listObjects(key);
  if (!listed.some((item) => item.key === key)) return null;
  const signed = await presignGet({
    key,
    expiresIn: RESULT_PRESIGN_SECONDS,
    downloadName: name,
    contentType: viewContentType(name),
  });
  return signed.url;
}

export function configError(error: unknown): "missing_env" | "bad_account" | null {
  if (error instanceof StorageConfigError) return error.code;
  return null;
}
