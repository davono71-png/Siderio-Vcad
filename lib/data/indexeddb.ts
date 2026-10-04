import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { createId } from "./id";
import { freshJob, type RilievoRepository } from "./repository";
import type {
  Measurement,
  NewPhotoInput,
  NewProjectInput,
  NotablePoint,
  PhotoMeta,
  Project,
  ProjectPatch,
  ThumbRecord,
} from "./types";

const DB_NAME = "siderio-rilievi";
const DB_VERSION = 1;

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
}

let dbPromise: Promise<IDBPDatabase<RilievoDb>> | null = null;

function db() {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB non è disponibile in questo browser."));
  }
  if (!dbPromise) {
    dbPromise = openDB<RilievoDb>(DB_NAME, DB_VERSION, {
      upgrade(database) {
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
      },
    }).catch((error: unknown) => {
      dbPromise = null;
      throw error instanceof Error ? error : new Error("Impossibile aprire l’archivio locale.");
    });
  }
  return dbPromise;
}

function bySequence(a: PhotoMeta, b: PhotoMeta) {
  return a.sequence - b.sequence || a.createdAt.localeCompare(b.createdAt);
}

export class IndexedDbRepository implements RilievoRepository {
  async listProjects() {
    const database = await db();
    const all = await database.getAll("projects");
    return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getProject(id: string) {
    const database = await db();
    return (await database.get("projects", id)) ?? null;
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
    return next;
  }

  async deleteProject(id: string) {
    const database = await db();
    const photos = await database.getAllFromIndex("photos", "by-project", id);
    const points = await database.getAllFromIndex("points", "by-project", id);
    const measurements = await database.getAllFromIndex("measurements", "by-project", id);
    const tx = database.transaction(
      ["projects", "photos", "photoBlobs", "photoThumbs", "points", "measurements"],
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
    await tx.done;
  }

  async listPhotos(projectId: string) {
    const database = await db();
    const photos = await database.getAllFromIndex("photos", "by-project", projectId);
    return photos.sort(bySequence);
  }

  async getPhoto(id: string) {
    const database = await db();
    const meta = await database.get("photos", id);
    const row = await database.get("photoBlobs", id);
    if (!meta || !row) return null;
    return { meta, blob: row.blob };
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
      flag: input.flag,
      mime: "image/jpeg",
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
    if (!meta) return;
    const points = await database.getAllFromIndex("points", "by-project", meta.projectId);
    const tx = database.transaction(["photos", "photoBlobs", "photoThumbs", "points", "projects"], "readwrite");
    await tx.objectStore("photos").delete(id);
    await tx.objectStore("photoBlobs").delete(id);
    await tx.objectStore("photoThumbs").delete(id);
    for (const point of points) {
      const observations = point.observations.filter((item) => item.photoId !== id);
      if (observations.length === point.observations.length) continue;
      await tx.objectStore("points").put({ ...point, observations });
    }
    const project = await tx.objectStore("projects").get(meta.projectId);
    if (project) {
      project.updatedAt = new Date().toISOString();
      await tx.objectStore("projects").put(project);
    }
    await tx.done;
  }

  async listPoints(projectId: string) {
    const database = await db();
    const points = await database.getAllFromIndex("points", "by-project", projectId);
    return points.sort((a, b) => a.label.localeCompare(b.label, "it"));
  }

  async upsertPoint(point: NotablePoint) {
    const database = await db();
    const tx = database.transaction(["points", "projects"], "readwrite");
    await tx.objectStore("points").put(point);
    const project = await tx.objectStore("projects").get(point.projectId);
    if (project) {
      project.updatedAt = new Date().toISOString();
      await tx.objectStore("projects").put(project);
    }
    await tx.done;
  }

  async deletePoint(id: string) {
    const database = await db();
    const point = await database.get("points", id);
    if (!point) return;
    const measurements = await database.getAllFromIndex("measurements", "by-project", point.projectId);
    const tx = database.transaction(["points", "measurements", "projects"], "readwrite");
    await tx.objectStore("points").delete(id);
    for (const measurement of measurements) {
      if (measurement.pointA === id || measurement.pointB === id) {
        await tx.objectStore("measurements").delete(measurement.id);
      }
    }
    const project = await tx.objectStore("projects").get(point.projectId);
    if (project) {
      project.updatedAt = new Date().toISOString();
      await tx.objectStore("projects").put(project);
    }
    await tx.done;
  }

  async listMeasurements(projectId: string) {
    const database = await db();
    const measurements = await database.getAllFromIndex("measurements", "by-project", projectId);
    return measurements.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async upsertMeasurement(measurement: Measurement) {
    const database = await db();
    const tx = database.transaction(["measurements", "projects"], "readwrite");
    await tx.objectStore("measurements").put(measurement);
    const project = await tx.objectStore("projects").get(measurement.projectId);
    if (project) {
      project.updatedAt = new Date().toISOString();
      await tx.objectStore("projects").put(project);
    }
    await tx.done;
  }

  async deleteMeasurement(id: string) {
    const database = await db();
    const measurement = await database.get("measurements", id);
    if (!measurement) return;
    const tx = database.transaction(["measurements", "projects"], "readwrite");
    await tx.objectStore("measurements").delete(id);
    const project = await tx.objectStore("projects").get(measurement.projectId);
    if (project) {
      project.updatedAt = new Date().toISOString();
      await tx.objectStore("projects").put(project);
    }
    await tx.done;
  }

  async enqueueReconstruction(projectId: string) {
    const job = freshJob({
      status: "non_disponibile",
      message:
        "L’invio al worker GPU non è ancora collegato. Le foto e le quote restano su questo telefono: esportale in ZIP se ti servono subito.",
      progress: null,
    });
    await this.updateProject(projectId, { job });
    return job;
  }
}
