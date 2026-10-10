import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { createId } from "./id";
import { freshJob, type RilievoRepository } from "./repository";
import { photoObjectKey, manifestObjectKey } from "../storage/keys";
import {
  measurementFromSurvey,
  photoMetaFromSurvey,
  pointFromSurvey,
  timeOf,
  type SurveyDocument,
} from "../sync/document";
import type {
  Measurement,
  NewPhotoInput,
  NewProjectInput,
  NotablePoint,
  PhotoMeta,
  PhotoWarning,
  Project,
  ProjectPatch,
  ScaleChecklist,
  ThumbRecord,
  UploadRecord,
} from "./types";
import { emptyChecklist } from "./types";

const DB_NAME = "siderio-rilievi";
const DB_VERSION = 2;

type BlobRow = { id: string; projectId: string; blob: Blob };

interface RilievoDb extends DBSchema {
  projects: {
    key: string;
    value: Project;
    indexes: { "by-updated": string };
  };
  photos: {
    key: string;
    value: PhotoMeta;
    indexes: { "by-project": string };
  };
  photoBlobs: {
    key: string;
    value: BlobRow;
  };
  photoThumbs: {
    key: string;
    value: ThumbRecord;
    indexes: { "by-project": string };
  };
  points: {
    key: string;
    value: NotablePoint;
    indexes: { "by-project": string };
  };
  measurements: {
    key: string;
    value: Measurement;
    indexes: { "by-project": string };
  };
  uploads: {
    key: string;
    value: UploadRecord;
    indexes: { "by-project": string };
  };
}

const BLOCKED_MESSAGE =
  "L’archivio è aperto in un’altra scheda di Siderio. Chiudi le altre schede o finestre dell’app e riprova.";

/** How long to wait after `blocked` before giving up. A refresh closes the old page within this window. */
const BLOCKED_GRACE_MS = 2500;
/** Safety net when the open itself never settles (slow phone or a connection that never closes). */
const OPEN_LIMIT_MS = 20000;

let dbPromise: Promise<IDBPDatabase<RilievoDb>> | null = null;
let held: IDBPDatabase<RilievoDb> | null = null;
let lifecycleBound = false;

function bindLifecycle() {
  if (lifecycleBound || typeof window === "undefined") return;
  lifecycleBound = true;
  window.addEventListener("pagehide", () => {
    held?.close();
    held = null;
    dbPromise = null;
  });
}

function closeNative(event: IDBVersionChangeEvent) {
  const target = event.target;
  if (target && "close" in target && typeof target.close === "function") {
    try {
      target.close();
    } catch {
      /* already closing */
    }
  }
}

function db() {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB non è disponibile in questo browser."));
  }
  bindLifecycle();
  if (!dbPromise) dbPromise = openDatabase();
  return dbPromise;
}

function openDatabase() {
  let settled = false;
  let blockedTimer: number | null = null;
  let limitTimer: number | null = null;

  const clearTimers = () => {
    if (blockedTimer != null) window.clearTimeout(blockedTimer);
    if (limitTimer != null) window.clearTimeout(limitTimer);
    blockedTimer = null;
    limitTimer = null;
  };

  return new Promise<IDBPDatabase<RilievoDb>>((resolve, reject) => {
    const giveUp = () => {
      if (settled) return;
      settled = true;
      clearTimers();
      dbPromise = null;
      void opened.then((database) => database.close()).catch(() => undefined);
      reject(new Error(BLOCKED_MESSAGE));
    };

    const opened = openDB<RilievoDb>(DB_NAME, DB_VERSION, {
      upgrade(database, oldVersion) {
        if (oldVersion < 1) {
          const projects = database.createObjectStore("projects", { keyPath: "id" });
          projects.createIndex("by-updated", "updatedAt");

          const photos = database.createObjectStore("photos", { keyPath: "id" });
          photos.createIndex("by-project", "projectId");

          database.createObjectStore("photoBlobs", { keyPath: "id" });

          const thumbs = database.createObjectStore("photoThumbs", { keyPath: "id" });
          thumbs.createIndex("by-project", "projectId");

          const points = database.createObjectStore("points", { keyPath: "id" });
          points.createIndex("by-project", "projectId");

          const measurements = database.createObjectStore("measurements", { keyPath: "id" });
          measurements.createIndex("by-project", "projectId");
        }
        if (oldVersion < 2 && !database.objectStoreNames.contains("uploads")) {
          const uploads = database.createObjectStore("uploads", { keyPath: "id" });
          uploads.createIndex("by-project", "projectId");
        }
      },
      blocked() {
        if (settled || blockedTimer != null) return;
        blockedTimer = window.setTimeout(giveUp, BLOCKED_GRACE_MS);
      },
      blocking(_current, _blocked, event) {
        closeNative(event);
        held?.close();
        held = null;
        dbPromise = null;
      },
      terminated() {
        held = null;
        dbPromise = null;
      },
    });

    limitTimer = window.setTimeout(giveUp, OPEN_LIMIT_MS);

    opened.then(
      (database) => {
        if (settled) {
          database.close();
          return;
        }
        settled = true;
        clearTimers();
        held = database;
        database.onclose = () => {
          if (held === database) held = null;
          if (dbPromise) dbPromise = null;
        };
        resolve(database);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimers();
        dbPromise = null;
        reject(error instanceof Error ? error : new Error("Impossibile aprire l’archivio locale."));
      },
    );
  });
}

function bySequence(a: PhotoMeta, b: PhotoMeta) {
  return a.sequence - b.sequence || a.createdAt.localeCompare(b.createdAt);
}

function asChecklist(value: ScaleChecklist | undefined): ScaleChecklist {
  return {
    lunghezza: value?.lunghezza === true,
    larghezza: value?.larghezza === true,
    altezza: value?.altezza === true,
  };
}

function asWarnings(photo: PhotoMeta): PhotoWarning[] {
  if (Array.isArray(photo.warnings)) return photo.warnings;
  return photo.flag ? [photo.flag] : [];
}

function normalizeProject(project: Project): Project {
  return {
    ...project,
    revision: typeof project.revision === "number" && Number.isFinite(project.revision) ? project.revision : 0,
    scaleChecklist: asChecklist(project.scaleChecklist),
  };
}

function normalizePhoto(photo: PhotoMeta): PhotoMeta {
  const warnings = asWarnings(photo);
  const motion = photo.motion
    ? { ...photo.motion, gyroDegPerSec: photo.motion.gyroDegPerSec ?? null }
    : null;
  const quality = photo.quality
    ? {
        ...photo.quality,
        cornersPerK: photo.quality.cornersPerK ?? 0,
        gradient: photo.quality.gradient ?? 0,
      }
    : null;
  return {
    ...photo,
    warnings,
    flag: photo.flag ?? warnings[0] ?? null,
    r2Key: photo.r2Key ?? null,
    uploadedAt: photo.uploadedAt ?? null,
    localBlob: photo.localBlob !== false,
    motion,
    quality,
  };
}

export class IndexedDbRepository implements RilievoRepository {
  async listProjects() {
    const database = await db();
    const all = await database.getAll("projects");
    return all.map(normalizeProject).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getProject(id: string) {
    const database = await db();
    const project = await database.get("projects", id);
    return project ? normalizeProject(project) : null;
  }

  async createProject(input: NewProjectInput) {
    const database = await db();
    const now = new Date().toISOString();
    const project: Project = {
      id: createId(),
      name: input.name.trim() || "Senza nome",
      kind: input.kind,
      notes: input.notes.trim(),
      createdAt: now,
      updatedAt: now,
      job: freshJob(),
      scaleChecklist: emptyChecklist(),
      revision: 0,
    };
    await database.put("projects", project);
    return project;
  }

  async updateProject(id: string, patch: ProjectPatch) {
    const database = await db();
    const current = await database.get("projects", id);
    if (!current) throw new Error("Rilievo non trovato.");
    const next: Project = {
      ...current,
      ...patch,
      name: patch.name !== undefined ? patch.name.trim() || current.name : current.name,
      notes: patch.notes !== undefined ? patch.notes.trim() : current.notes,
      updatedAt: new Date().toISOString(),
    };
    await database.put("projects", next);
    return normalizeProject(next);
  }

  async deleteProject(id: string) {
    const database = await db();
    const photos = await database.getAllFromIndex("photos", "by-project", id);
    const points = await database.getAllFromIndex("points", "by-project", id);
    const measurements = await database.getAllFromIndex("measurements", "by-project", id);
    const uploads = await database.getAllFromIndex("uploads", "by-project", id);
    const tx = database.transaction(
      ["projects", "photos", "photoBlobs", "photoThumbs", "points", "measurements", "uploads"],
      "readwrite",
    );
    await tx.objectStore("projects").delete(id);
    for (const photo of photos) {
      await tx.objectStore("photos").delete(photo.id);
      await tx.objectStore("photoBlobs").delete(photo.id);
      await tx.objectStore("photoThumbs").delete(photo.id);
    }
    for (const point of points) await tx.objectStore("points").delete(point.id);
    for (const measurement of measurements) await tx.objectStore("measurements").delete(measurement.id);
    for (const upload of uploads) await tx.objectStore("uploads").delete(upload.id);
    await tx.done;
  }

  async listPhotos(projectId: string) {
    const photos = await this.listAllPhotos(projectId);
    return photos.filter((photo) => !photo.deletedAt);
  }

  async listAllPhotos(projectId: string) {
    const database = await db();
    const photos = await database.getAllFromIndex("photos", "by-project", projectId);
    return photos.map(normalizePhoto).sort(bySequence);
  }

  async getPhoto(id: string) {
    const database = await db();
    const stored = await database.get("photos", id);
    if (!stored) return null;
    const row = await database.get("photoBlobs", id);
    return { meta: normalizePhoto(stored), blob: row?.blob ?? null };
  }

  async listThumbs(projectId: string) {
    const database = await db();
    return database.getAllFromIndex("photoThumbs", "by-project", projectId);
  }

  async addPhoto(input: NewPhotoInput) {
    const database = await db();
    const existing = await database.getAllFromIndex("photos", "by-project", input.projectId);
    const now = new Date().toISOString();
    const meta: PhotoMeta = {
      id: createId(),
      projectId: input.projectId,
      createdAt: now,
      sequence: existing.reduce((max, photo) => Math.max(max, photo.sequence), 0) + 1,
      accepted: input.accepted,
      rejectReason: input.rejectReason,
      flag: input.warnings[0] ?? null,
      warnings: input.warnings,
      mime: "image/jpeg",
      r2Key: null,
      uploadedAt: null,
      localBlob: true,
      byteSize: input.blob.size,
      width: input.width,
      height: input.height,
      exifOrientation: input.exifOrientation,
      orientedWidth: input.orientedWidth,
      orientedHeight: input.orientedHeight,
      pose: input.pose,
      direction: input.direction,
      motion: input.motion,
      quality: input.quality,
    };
    const tx = database.transaction(["photos", "photoBlobs", "photoThumbs", "projects"], "readwrite");
    await tx.objectStore("photos").put(meta);
    await tx.objectStore("photoBlobs").put({ id: meta.id, projectId: input.projectId, blob: input.blob });
    await tx.objectStore("photoThumbs").put({
      id: meta.id,
      projectId: input.projectId,
      blob: input.thumb,
    });
    const project = await tx.objectStore("projects").get(input.projectId);
    if (project) {
      project.updatedAt = now;
      await tx.objectStore("projects").put(project);
    }
    await tx.done;
    return meta;
  }

  async deletePhoto(id: string) {
    const database = await db();
    const meta = await database.get("photos", id);
    if (!meta || meta.deletedAt) return;
    const now = new Date().toISOString();
    const tx = database.transaction(
      ["photos", "photoBlobs", "photoThumbs", "projects", "uploads"],
      "readwrite",
    );
    await tx.objectStore("photos").put({ ...meta, deletedAt: now, updatedAt: now, localBlob: false });
    await tx.objectStore("photoBlobs").delete(id);
    await tx.objectStore("photoThumbs").delete(id);
    await tx.objectStore("uploads").delete(id);
    const project = await tx.objectStore("projects").get(meta.projectId);
    if (project) {
      project.updatedAt = now;
      await tx.objectStore("projects").put(project);
    }
    await tx.done;
  }

  async listPoints(projectId: string) {
    const points = await this.listAllPoints(projectId);
    return points.filter((point) => !point.deletedAt);
  }

  async listAllPoints(projectId: string) {
    const database = await db();
    const points = await database.getAllFromIndex("points", "by-project", projectId);
    return points.sort((a, b) => a.label.localeCompare(b.label, "it"));
  }

  async upsertPoint(point: NotablePoint) {
    const database = await db();
    const now = new Date().toISOString();
    const tx = database.transaction(["points", "projects"], "readwrite");
    await tx.objectStore("points").put({ ...point, updatedAt: now, deletedAt: null });
    const project = await tx.objectStore("projects").get(point.projectId);
    if (project) {
      project.updatedAt = now;
      await tx.objectStore("projects").put(project);
    }
    await tx.done;
  }

  async deletePoint(id: string) {
    const database = await db();
    const point = await database.get("points", id);
    if (!point || point.deletedAt) return;
    const measurements = await database.getAllFromIndex("measurements", "by-project", point.projectId);
    const now = new Date().toISOString();
    const tx = database.transaction(["points", "measurements", "projects"], "readwrite");
    await tx.objectStore("points").put({ ...point, deletedAt: now, updatedAt: now });
    for (const measurement of measurements) {
      if (measurement.deletedAt) continue;
      if (measurement.pointA === id || measurement.pointB === id) {
        await tx.objectStore("measurements").put({ ...measurement, deletedAt: now, updatedAt: now });
      }
    }
    const project = await tx.objectStore("projects").get(point.projectId);
    if (project) {
      project.updatedAt = now;
      await tx.objectStore("projects").put(project);
    }
    await tx.done;
  }

  async listMeasurements(projectId: string) {
    const measurements = await this.listAllMeasurements(projectId);
    return measurements.filter((measurement) => !measurement.deletedAt);
  }

  async listAllMeasurements(projectId: string) {
    const database = await db();
    const measurements = await database.getAllFromIndex("measurements", "by-project", projectId);
    return measurements.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async upsertMeasurement(measurement: Measurement) {
    const database = await db();
    const now = new Date().toISOString();
    const tx = database.transaction(["measurements", "projects"], "readwrite");
    await tx.objectStore("measurements").put({ ...measurement, updatedAt: now, deletedAt: null });
    const project = await tx.objectStore("projects").get(measurement.projectId);
    if (project) {
      project.updatedAt = now;
      await tx.objectStore("projects").put(project);
    }
    await tx.done;
  }

  async deleteMeasurement(id: string) {
    const database = await db();
    const measurement = await database.get("measurements", id);
    if (!measurement || measurement.deletedAt) return;
    const now = new Date().toISOString();
    const tx = database.transaction(["measurements", "projects"], "readwrite");
    await tx.objectStore("measurements").put({ ...measurement, deletedAt: now, updatedAt: now });
    const project = await tx.objectStore("projects").get(measurement.projectId);
    if (project) {
      project.updatedAt = now;
      await tx.objectStore("projects").put(project);
    }
    await tx.done;
  }

  async importSurvey(document: SurveyDocument) {
    const database = await db();
    const projectId = document.project.id;
    const [existingProject, existingPhotos, existingPoints, existingMeasurements] = await Promise.all([
      database.get("projects", projectId),
      database.getAllFromIndex("photos", "by-project", projectId),
      database.getAllFromIndex("points", "by-project", projectId),
      database.getAllFromIndex("measurements", "by-project", projectId),
    ]);
    if (
      document.deletedAt &&
      timeOf(document.deletedAt) >= timeOf(existingProject?.updatedAt ?? document.project.updatedAt)
    ) {
      await this.deleteProject(projectId);
      return;
    }

    const localProjectNewer =
      existingProject != null && timeOf(existingProject.updatedAt) > timeOf(document.project.updatedAt);
    const project: Project = localProjectNewer
      ? { ...existingProject, revision: Math.max(existingProject.revision ?? 0, document.revision) }
      : {
          id: projectId,
          name: document.project.name,
          kind: document.project.kind,
          notes: document.project.notes,
          createdAt: document.project.createdAt,
          updatedAt: document.project.updatedAt,
          revision: document.revision,
          job: document.project.job,
          scaleChecklist: document.project.scaleChecklist,
        };

    const tx = database.transaction(
      ["projects", "photos", "photoBlobs", "photoThumbs", "points", "measurements"],
      "readwrite",
    );
    await tx.objectStore("projects").put(project);

    for (const photo of document.photos) {
      const existing = existingPhotos.find((item) => item.id === photo.id) ?? null;
      if (existing?.deletedAt && timeOf(existing.deletedAt) > timeOf(photo.updatedAt)) continue;
      if (existing && !existing.deletedAt && timeOf(existing.updatedAt) > timeOf(photo.updatedAt)) {
        if (!existing.r2Key && photo.r2Key) {
          await tx.objectStore("photos").put({ ...existing, r2Key: photo.r2Key, uploadedAt: photo.uploadedAt });
        }
        continue;
      }
      const meta = photoMetaFromSurvey(photo, projectId, existing);
      const blob = await tx.objectStore("photoBlobs").get(photo.id);
      meta.localBlob = Boolean(blob);
      await tx.objectStore("photos").put(meta);
    }
    for (const tomb of document.tombstones.photos) {
      const existing = existingPhotos.find((item) => item.id === tomb.id);
      if (!existing) continue;
      if (existing.updatedAt && timeOf(existing.updatedAt) > timeOf(tomb.deletedAt) && !existing.deletedAt) continue;
      await tx.objectStore("photos").put({ ...existing, deletedAt: tomb.deletedAt, updatedAt: tomb.deletedAt, localBlob: false });
      await tx.objectStore("photoBlobs").delete(tomb.id);
      await tx.objectStore("photoThumbs").delete(tomb.id);
    }

    for (const point of document.points) {
      const existing = existingPoints.find((item) => item.id === point.id);
      if (existing?.deletedAt && timeOf(existing.deletedAt) > timeOf(point.updatedAt)) continue;
      if (existing && !existing.deletedAt && timeOf(existing.updatedAt) > timeOf(point.updatedAt)) continue;
      await tx.objectStore("points").put(pointFromSurvey(point, projectId));
    }
    for (const tomb of document.tombstones.points) {
      const existing = existingPoints.find((item) => item.id === tomb.id);
      if (existing && !existing.deletedAt && timeOf(existing.updatedAt) > timeOf(tomb.deletedAt)) continue;
      const base = existing ?? pointFromSurvey(
        { id: tomb.id, label: "", observations: [], updatedAt: tomb.deletedAt },
        projectId,
      );
      await tx.objectStore("points").put({ ...base, deletedAt: tomb.deletedAt, updatedAt: tomb.deletedAt });
    }

    for (const measurement of document.measurements) {
      const existing = existingMeasurements.find((item) => item.id === measurement.id);
      if (existing?.deletedAt && timeOf(existing.deletedAt) > timeOf(measurement.updatedAt)) continue;
      if (existing && !existing.deletedAt && timeOf(existing.updatedAt) > timeOf(measurement.updatedAt)) continue;
      await tx.objectStore("measurements").put(measurementFromSurvey(measurement, projectId));
    }
    for (const tomb of document.tombstones.measurements) {
      const existing = existingMeasurements.find((item) => item.id === tomb.id);
      if (existing && !existing.deletedAt && timeOf(existing.updatedAt) > timeOf(tomb.deletedAt)) continue;
      const base = existing ?? measurementFromSurvey(
        {
          id: tomb.id,
          pointA: "",
          pointB: "",
          labelA: null,
          labelB: null,
          distanceMm: 0,
          note: "",
          createdAt: tomb.deletedAt,
          updatedAt: tomb.deletedAt,
        },
        projectId,
      );
      await tx.objectStore("measurements").put({ ...base, deletedAt: tomb.deletedAt, updatedAt: tomb.deletedAt });
    }
    await tx.done;
  }

  async enqueueReconstruction(projectId: string) {
    const job = freshJob({
      status: "non_disponibile",
      message:
        "L’invio al worker GPU non è ancora collegato. Le foto vengono copiate sull’archivio quando la rete c’è; lo ZIP resta disponibile.",
      progress: null,
    });
    await this.updateProject(projectId, { job });
    return job;
  }

  async enqueuePhotoUpload(meta: PhotoMeta) {
    if (!meta.accepted) return;
    const database = await db();
    const existing = await database.get("uploads", meta.id);
    if (existing && (existing.phase === "caricata" || existing.phase === "invio")) return;
    const now = new Date().toISOString();
    const record: UploadRecord = {
      id: meta.id,
      projectId: meta.projectId,
      kind: "photo",
      key: photoObjectKey(meta.projectId, meta.sequence, meta.id),
      phase: "in_coda",
      attempts: existing?.attempts ?? 0,
      nextAttemptAt: Date.now(),
      lastError: null,
      again: false,
      updatedAt: now,
    };
    await database.put("uploads", record);
  }

  async touchManifest(projectId: string, delayMs = 2000) {
    const database = await db();
    const id = `manifest:${projectId}`;
    const existing = await database.get("uploads", id);
    const now = Date.now();
    if (existing?.phase === "invio") {
      await database.put("uploads", { ...existing, again: true, updatedAt: new Date().toISOString() });
      return;
    }
    const record: UploadRecord = {
      id,
      projectId,
      kind: "manifest",
      key: manifestObjectKey(projectId),
      phase: "in_coda",
      attempts: 0,
      nextAttemptAt: now + delayMs,
      lastError: existing?.phase === "errore" ? null : (existing?.lastError ?? null),
      again: false,
      updatedAt: new Date().toISOString(),
    };
    await database.put("uploads", record);
  }

  async uploadSummary(projectId: string) {
    const database = await db();
    const photos = (await database.getAllFromIndex("photos", "by-project", projectId))
      .map(normalizePhoto)
      .filter((photo) => !photo.deletedAt);
    const uploads = await database.getAllFromIndex("uploads", "by-project", projectId);
    const accepted = photos.filter((photo) => photo.accepted);
    const uploaded = accepted.filter((photo) => photo.uploadedAt != null).length;
    const pending = uploads.filter((item) => item.phase === "in_coda" || item.phase === "invio").length;
    const failed = uploads.filter((item) => item.phase === "errore");
    const reclaimable = accepted.filter((photo) => photo.uploadedAt != null && photo.localBlob).length;
    const lastError = uploads.find((item) => item.lastError && item.phase !== "caricata")?.lastError ?? null;
    return {
      accepted: accepted.length,
      uploaded,
      pending,
      failed: failed.length,
      reclaimable,
      lastError,
    };
  }

  async retryUploads(projectId: string) {
    const database = await db();
    const uploads = await database.getAllFromIndex("uploads", "by-project", projectId);
    const tx = database.transaction("uploads", "readwrite");
    const now = new Date().toISOString();
    for (const item of uploads) {
      if (item.phase !== "errore" && item.phase !== "in_coda") continue;
      await tx.store.put({
        ...item,
        phase: "in_coda",
        attempts: 0,
        nextAttemptAt: Date.now(),
        lastError: null,
        updatedAt: now,
      });
    }
    await tx.done;
  }

  async expeditePending() {
    const database = await db();
    const uploads = await database.getAll("uploads");
    const tx = database.transaction("uploads", "readwrite");
    const now = new Date().toISOString();
    for (const item of uploads) {
      if (item.phase !== "in_coda") continue;
      await tx.store.put({ ...item, nextAttemptAt: Date.now(), updatedAt: now });
    }
    await tx.done;
  }

  async resetStaleClaims(olderThanMs: number) {
    const database = await db();
    const uploads = await database.getAll("uploads");
    const cutoff = Date.now() - olderThanMs;
    const tx = database.transaction("uploads", "readwrite");
    for (const item of uploads) {
      if (item.phase !== "invio") continue;
      if (Date.parse(item.updatedAt) > cutoff) continue;
      await tx.store.put({
        ...item,
        phase: "in_coda",
        nextAttemptAt: Date.now(),
        updatedAt: new Date().toISOString(),
      });
    }
    await tx.done;
  }

  async claimUploads(now: number, limit: number) {
    const database = await db();
    const uploads = await database.getAll("uploads");
    const ready = uploads
      .filter((item) => item.phase === "in_coda" && item.nextAttemptAt <= now)
      .sort((a, b) => a.nextAttemptAt - b.nextAttemptAt || a.updatedAt.localeCompare(b.updatedAt));
    const tx = database.transaction("uploads", "readwrite");
    const claimed: UploadRecord[] = [];
    for (const item of ready) {
      if (claimed.length >= limit) break;
      const current = await tx.store.get(item.id);
      if (!current || current.phase !== "in_coda" || current.nextAttemptAt > now) continue;
      const next: UploadRecord = { ...current, phase: "invio", again: false, updatedAt: new Date().toISOString() };
      await tx.store.put(next);
      claimed.push(next);
    }
    await tx.done;
    return claimed;
  }

  async finishUpload(id: string, ok: boolean, errorCode: string | null, permanent: boolean) {
    const database = await db();
    const current = await database.get("uploads", id);
    if (!current) return;
    const now = new Date().toISOString();
    if (ok) {
      if (current.kind === "photo") {
        const photo = await database.get("photos", id);
        if (photo) {
          const meta = normalizePhoto(photo);
          await database.put("photos", {
            ...meta,
            r2Key: current.key,
            uploadedAt: now,
            localBlob: meta.localBlob,
          });
        }
      }
      if (current.again) {
        await database.put("uploads", {
          ...current,
          phase: "in_coda",
          attempts: 0,
          nextAttemptAt: Date.now(),
          lastError: null,
          again: false,
          updatedAt: now,
        });
        return;
      }
      await database.put("uploads", {
        ...current,
        phase: "caricata",
        lastError: null,
        again: false,
        updatedAt: now,
      });
      return;
    }

    const attempts = current.attempts + 1;
    const giveUp = permanent || attempts >= 6;
    const backoff = Math.min(60_000, 2000 * 2 ** Math.max(0, attempts - 1));
    await database.put("uploads", {
      ...current,
      phase: giveUp ? "errore" : "in_coda",
      attempts,
      nextAttemptAt: Date.now() + backoff,
      lastError: errorCode,
      updatedAt: now,
    });
  }

  async markUploadingAgain(id: string) {
    const database = await db();
    const current = await database.get("uploads", id);
    if (!current || current.phase !== "invio") return;
    await database.put("uploads", { ...current, again: true });
  }

  async releaseUploadedBlobs(projectId: string) {
    const database = await db();
    const photos = await database.getAllFromIndex("photos", "by-project", projectId);
    const tx = database.transaction(["photos", "photoBlobs"], "readwrite");
    let freed = 0;
    for (const photo of photos) {
      const meta = normalizePhoto(photo);
      if (!meta.accepted || !meta.uploadedAt || !meta.localBlob) continue;
      await tx.objectStore("photoBlobs").delete(meta.id);
      await tx.objectStore("photos").put({ ...meta, localBlob: false });
      freed += 1;
    }
    await tx.done;
    return freed;
  }
}
