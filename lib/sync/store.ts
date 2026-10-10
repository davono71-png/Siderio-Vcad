import { isUuid, manifestObjectKey } from "../storage/keys";
import { listCommonPrefixes, putObjectText, readObjectRecord, readObjectText, StorageConfigError } from "../storage/r2";
import { parseSurveyDocument, type SurveyDocument } from "./document";
import { mergeDocuments } from "./merge";

const INDEX_KEY = "rilievi/index.json";

export type SurveyCard = {
  id: string;
  name: string;
  kind: "stanza" | "facciata";
  updatedAt: string;
  revision: number;
  photos: number;
  deletedAt: string | null;
};

type MemoryState = {
  docs: Map<string, { text: string; etag: string }>;
  seq: number;
};

const memoryGlobal = globalThis as typeof globalThis & { __siderioSyncMemory?: MemoryState };

function memoryOn() {
  return process.env.SIDERO_SYNC_MEMORY === "1";
}

function memory() {
  if (!memoryGlobal.__siderioSyncMemory) memoryGlobal.__siderioSyncMemory = { docs: new Map(), seq: 1 };
  return memoryGlobal.__siderioSyncMemory;
}

function cardFrom(document: SurveyDocument): SurveyCard {
  return {
    id: document.project.id,
    name: document.project.name,
    kind: document.project.kind,
    updatedAt: document.updatedAt || document.project.updatedAt,
    revision: document.revision,
    photos: document.photos.filter((photo) => photo.accepted).length,
    deletedAt: document.deletedAt,
  };
}

async function readText(key: string) {
  if (memoryOn()) return memory().docs.get(key)?.text ?? null;
  return readObjectText(key);
}

async function readRecord(key: string) {
  if (memoryOn()) return memory().docs.get(key) ?? null;
  return readObjectRecord(key);
}

function remember(key: string, body: string) {
  const state = memory();
  state.seq += 1;
  const record = { text: body, etag: String(state.seq) };
  state.docs.set(key, record);
  return record.etag;
}

async function writeText(key: string, body: string) {
  if (memoryOn()) {
    remember(key, body);
    return "ok" as const;
  }
  return putObjectText(key, body);
}

async function compareAndWrite(key: string, body: string, etag: string | null) {
  if (memoryOn()) {
    const current = memory().docs.get(key);
    if (etag) {
      if (!current || current.etag !== etag) return "conflict" as const;
    } else if (current) {
      return "conflict" as const;
    }
    remember(key, body);
    return "ok" as const;
  }
  return putObjectText(key, body, etag ? { ifMatch: etag } : { ifNoneMatch: "*" });
}

function parseIndex(raw: string | null): SurveyCard[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { surveys?: SurveyCard[] };
    if (!Array.isArray(parsed.surveys)) return [];
    return parsed.surveys.filter((item) => item && typeof item.id === "string" && isUuid(item.id));
  } catch {
    return [];
  }
}

async function writeIndex(surveys: SurveyCard[]) {
  await writeText(INDEX_KEY, JSON.stringify({ surveys }));
}

export async function readSurvey(id: string) {
  if (!isUuid(id)) return null;
  const raw = await readText(manifestObjectKey(id));
  if (!raw) return null;
  try {
    return parseSurveyDocument(JSON.parse(raw), id);
  } catch {
    return null;
  }
}

export async function commitSurvey(
  id: string,
  baseRevision: number,
  incoming: SurveyDocument,
): Promise<{ conflict: true; document: SurveyDocument | null } | { conflict: false; document: SurveyDocument }> {
  const record = await readRecord(manifestObjectKey(id));
  let current: SurveyDocument | null = null;
  if (record) {
    try {
      current = parseSurveyDocument(JSON.parse(record.text), id);
    } catch {
      current = null;
    }
  }
  const currentRevision = current?.revision ?? 0;
  if (current && currentRevision !== baseRevision) return { conflict: true, document: current };
  if (!current && baseRevision !== 0) return { conflict: true, document: null };
  const merged = current ? mergeDocuments(current, incoming) : incoming;
  const now = new Date().toISOString();
  const next: SurveyDocument = {
    ...merged,
    revision: currentRevision + 1,
    updatedAt: now,
    exportedAt: now,
    project: { ...merged.project, id },
  };
  const wrote = await compareAndWrite(manifestObjectKey(id), JSON.stringify(next), record?.etag ?? null);
  if (wrote === "conflict") {
    const again = await readSurvey(id);
    return { conflict: true, document: again };
  }
  await rememberIndex(next);
  return { conflict: false, document: next };
}

async function rememberIndex(document: SurveyDocument) {
  const surveys = parseIndex(await readText(INDEX_KEY)).filter((item) => item.id !== document.project.id);
  if (!document.deletedAt) surveys.push(cardFrom(document));
  surveys.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  await writeIndex(surveys);
}

export async function writeSurvey(document: SurveyDocument) {
  const id = document.project.id;
  const key = manifestObjectKey(id);
  const record = await readRecord(key);
  const wrote = await compareAndWrite(key, JSON.stringify(document), record?.etag ?? null);
  if (wrote === "conflict") return "conflict" as const;
  await rememberIndex(document);
  return "ok" as const;
}

export async function listSurveyCards(): Promise<SurveyCard[]> {
  const indexed = parseIndex(await readText(INDEX_KEY));
  const byId = new Map(indexed.map((item) => [item.id, item]));
  if (!memoryOn()) {
    try {
      const prefixes = await listCommonPrefixes("rilievi/");
      for (const prefix of prefixes) {
        const id = /^rilievi\/([0-9a-f-]{36})\/$/i.exec(prefix)?.[1];
        if (!id || !isUuid(id) || byId.has(id)) continue;
        const document = await readSurvey(id);
        if (!document) continue;
        byId.set(id, cardFrom(document));
      }
    } catch (error) {
      if (indexed.length === 0) throw error;
    }
  }
  return [...byId.values()]
    .filter((item) => !item.deletedAt)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function storageFailure(error: unknown) {
  if (error instanceof StorageConfigError) return error.code;
  return "unreachable";
}
