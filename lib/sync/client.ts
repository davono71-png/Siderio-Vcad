import { getRepository } from "../data";
import { buildProjectDocument } from "../export/document";
import { parseSurveyDocument, type SurveyDocument } from "./document";
import { mergeDocuments, sameContent } from "./merge";

export type SyncResult = "ok" | "missing" | "offline" | "unauthorized" | "unconfigured" | "error";

const tails = new Map<string, Promise<SyncResult>>();

export function noteAccess(response: Response) {
  if (typeof window === "undefined") return;
  if (response.status === 401 || response.status === 503) {
    window.dispatchEvent(new CustomEvent("siderio-auth"));
  }
}

async function readJson(response: Response) {
  return (await response.json().catch(() => null)) as { ok?: boolean; code?: string; document?: unknown } | null;
}

async function fetchRemote(projectId: string): Promise<SurveyDocument | null> {
  const response = await fetch(`/api/rilievi/${projectId}`, { cache: "no-store" });
  if (response.status === 404) return null;
  noteAccess(response);
  const body = await readJson(response);
  if (response.status === 401) throw new Error("unauthorized");
  if (response.status === 503 && body?.code === "unconfigured") throw new Error("unconfigured");
  if (!response.ok) throw new Error(body?.code || "sync_read_failed");
  return parseSurveyDocument(body?.document, projectId);
}

async function putRemote(projectId: string, baseRevision: number, document: SurveyDocument) {
  const response = await fetch(`/api/rilievi/${projectId}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ baseRevision, document }),
  });
  noteAccess(response);
  const body = await readJson(response);
  return { response, body };
}

async function readLocal(projectId: string) {
  try {
    return await buildProjectDocument(getRepository(), projectId);
  } catch {
    return null;
  }
}

async function doSync(projectId: string): Promise<SyncResult> {
  const repo = getRepository();
  let remote: SurveyDocument | null;
  try {
    remote = await fetchRemote(projectId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "unauthorized") return "unauthorized";
    if (message === "unconfigured") return "unconfigured";
    if (typeof navigator !== "undefined" && !navigator.onLine) return "offline";
    return "error";
  }

  const local = await readLocal(projectId);
  if (!local && !remote) return "missing";
  if (!local && remote) {
    if (remote.deletedAt) return "missing";
    await repo.importSurvey(remote);
    return "ok";
  }
  if (!local) return "missing";

  let merged = remote ? mergeDocuments(local, remote) : local;
  if (merged.deletedAt) {
    await repo.deleteProject(projectId);
    return "missing";
  }
  await repo.importSurvey(merged);

  const fresh = await readLocal(projectId);
  if (!fresh) return "missing";
  merged = remote ? mergeDocuments(fresh, remote) : fresh;
  if (remote && sameContent(merged, remote)) return "ok";

  let base = remote?.revision ?? 0;
  let pending = merged;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const current = await readLocal(projectId);
    if (!current) return "missing";
    pending = mergeDocuments(pending, current);
    let result: Awaited<ReturnType<typeof putRemote>>;
    try {
      result = await putRemote(projectId, base, pending);
    } catch {
      return typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "error";
    }
    if (result.response.status === 409) {
      const server = parseSurveyDocument(result.body?.document, projectId);
      if (!server) {
        base = 0;
        continue;
      }
      pending = mergeDocuments(pending, server);
      await repo.importSurvey(pending);
      base = server.revision;
      continue;
    }
    if (result.response.status === 401) return "unauthorized";
    if (result.response.status === 503 && result.body?.code === "unconfigured") return "unconfigured";
    if (!result.response.ok) return "error";
    const saved = parseSurveyDocument(result.body?.document, projectId);
    if (saved && !saved.deletedAt) await repo.importSurvey(saved);
    return "ok";
  }
  return "error";
}

/** Pull the archive, merge with this device, and push when something changed. */
export function syncSurvey(projectId: string) {
  const previous = tails.get(projectId) ?? Promise.resolve("ok" as SyncResult);
  const run = previous.catch(() => "error" as SyncResult).then(() => doSync(projectId));
  tails.set(projectId, run);
  void run.finally(() => {
    if (tails.get(projectId) === run) tails.delete(projectId);
  });
  return run;
}

export async function deleteRemoteSurvey(projectId: string) {
  const response = await fetch(`/api/rilievi/${projectId}`, { method: "DELETE" });
  noteAccess(response);
  if (response.status === 404) return "ok" as const;
  if (response.ok) return "ok" as const;
  const body = await readJson(response);
  if (response.status === 401) return "unauthorized" as const;
  if (body?.code === "unconfigured") return "unconfigured" as const;
  return "error" as const;
}

export type RemoteCard = {
  id: string;
  name: string;
  kind: "stanza" | "facciata";
  updatedAt: string;
  revision: number;
  photos: number;
};

export async function fetchRemoteSurveys(): Promise<{ ok: true; surveys: RemoteCard[] } | { ok: false; code: string }> {
  try {
    const response = await fetch("/api/rilievi", { cache: "no-store" });
    noteAccess(response);
    const body = (await response.json().catch(() => null)) as { ok?: boolean; code?: string; surveys?: RemoteCard[] } | null;
    if (!response.ok || !body?.ok || !Array.isArray(body.surveys)) {
      return { ok: false, code: body?.code || "error" };
    }
    return { ok: true, surveys: body.surveys };
  } catch {
    return { ok: false, code: "offline" };
  }
}
