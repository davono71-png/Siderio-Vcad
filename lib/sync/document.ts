import type {
  CameraDirection,
  Measurement,
  NotablePoint,
  PhotoMeta,
  PhotoMotion,
  PhotoPose,
  PhotoQuality,
  PhotoWarning,
  Project,
  ProjectJob,
  ProjectKind,
  RejectReason,
  ScaleChecklist,
} from "../data/types";
import { emptyChecklist } from "../data/types";

export type Tombstone = { id: string; deletedAt: string };

/** Pixel observations, the same shape scale.py already reads. */
export type SurveyObservation = {
  photoId: string;
  x: number;
  y: number;
  rawX: number;
  rawY: number;
};

export type SurveyPoint = {
  id: string;
  label: string;
  observations: SurveyObservation[];
  updatedAt: string;
};

export type SurveyMeasurement = {
  id: string;
  pointA: string;
  pointB: string;
  labelA: string | null;
  labelB: string | null;
  distanceMm: number;
  note: string;
  createdAt: string;
  updatedAt: string;
};

export type SurveyPhoto = {
  id: string;
  file: string | null;
  r2Key: string | null;
  sequence: number;
  createdAt: string;
  accepted: boolean;
  rejectReason: RejectReason | null;
  flag: PhotoWarning | null;
  warnings: PhotoWarning[];
  mime: "image/jpeg";
  byteSize: number;
  width: number;
  height: number;
  exifOrientation: number;
  orientedWidth: number;
  orientedHeight: number;
  pose: PhotoPose | null;
  direction: CameraDirection | null;
  motion: PhotoMotion | null;
  quality: PhotoQuality | null;
  uploadedAt: string | null;
  updatedAt: string;
};

export type SurveyProject = {
  id: string;
  name: string;
  kind: ProjectKind;
  notes: string;
  createdAt: string;
  updatedAt: string;
  job: ProjectJob;
  scaleChecklist: ScaleChecklist;
};

/**
 * Version 2 project.json.
 * Live `points` and `measurements` stay in the shape the worker reads.
 * Deletions live in `tombstones`, never inside those arrays.
 */
export type SurveyDocument = {
  version: 2;
  app: "Siderio Vcad";
  exportedAt: string;
  coordinateSpace: string;
  revision: number;
  updatedAt: string;
  deletedAt: string | null;
  project: SurveyProject;
  photos: SurveyPhoto[];
  points: SurveyPoint[];
  measurements: SurveyMeasurement[];
  tombstones: {
    photos: Tombstone[];
    points: Tombstone[];
    measurements: Tombstone[];
  };
};

const COORDINATE_SPACE =
  "observations.x/y sono pixel del fotogramma raddrizzato (dopo l’orientamento EXIF), origine in alto a sinistra. rawX/rawY sono i pixel nel file JPEG prima dell’EXIF.";

export function timeOf(value: string | null | undefined) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function contentSignature(document: SurveyDocument) {
  const ordered = <T extends { id: string }>(items: T[]) => [...items].sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify({
    deletedAt: document.deletedAt,
    project: document.project,
    photos: ordered(document.photos),
    points: ordered(document.points),
    measurements: ordered(document.measurements),
    tombstones: {
      photos: ordered(document.tombstones.photos),
      points: ordered(document.tombstones.points),
      measurements: ordered(document.tombstones.measurements),
    },
  });
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asIso(value: unknown, fallback: string) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : fallback;
}

function asKind(value: unknown): ProjectKind {
  return value === "stanza" || value === "facciata" ? value : "facciata";
}

function asChecklist(value: unknown): ScaleChecklist {
  const record = value && typeof value === "object" ? (value as Partial<ScaleChecklist>) : {};
  return {
    lunghezza: record.lunghezza === true,
    larghezza: record.larghezza === true,
    altezza: record.altezza === true,
  };
}

function asJob(value: unknown, fallback: string): ProjectJob {
  const record = value && typeof value === "object" ? (value as Partial<ProjectJob>) : {};
  const status = record.status;
  const allowed = ["non_inviato", "in_coda", "in_elaborazione", "completato", "errore", "non_disponibile"] as const;
  return {
    status: allowed.includes(status as (typeof allowed)[number]) ? (status as ProjectJob["status"]) : "non_inviato",
    message: asString(record.message),
    progress: typeof record.progress === "number" && Number.isFinite(record.progress) ? record.progress : null,
    updatedAt: asIso(record.updatedAt, fallback),
  };
}

function asObservations(value: unknown): SurveyObservation[] {
  if (!Array.isArray(value)) return [];
  const observations: SurveyObservation[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Partial<SurveyObservation>;
    if (typeof record.photoId !== "string" || !record.photoId) continue;
    const x = Number(record.x);
    const y = Number(record.y);
    const rawX = Number(record.rawX ?? record.x);
    const rawY = Number(record.rawY ?? record.y);
    if (![x, y, rawX, rawY].every((part) => Number.isFinite(part))) continue;
    observations.push({ photoId: record.photoId, x, y, rawX, rawY });
  }
  return observations;
}

function asWarnings(value: unknown, flag: PhotoWarning | null): PhotoWarning[] {
  const allowed = new Set<PhotoWarning>(["rotazione", "sovrapposizione", "texture"]);
  if (!Array.isArray(value)) return flag ? [flag] : [];
  return value.filter((item): item is PhotoWarning => typeof item === "string" && allowed.has(item as PhotoWarning));
}

function asPhoto(value: unknown, fallback: string): SurveyPhoto | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<SurveyPhoto>;
  if (typeof record.id !== "string" || !record.id) return null;
  const flag =
    record.flag === "rotazione" || record.flag === "sovrapposizione" || record.flag === "texture" ? record.flag : null;
  const createdAt = asIso(record.createdAt, fallback);
  return {
    id: record.id,
    file: typeof record.file === "string" ? record.file : null,
    r2Key: typeof record.r2Key === "string" ? record.r2Key : null,
    sequence: typeof record.sequence === "number" && Number.isFinite(record.sequence) ? record.sequence : 0,
    createdAt,
    accepted: record.accepted !== false,
    rejectReason: record.rejectReason === "mosso" || record.rejectReason === "simile" ? record.rejectReason : null,
    flag,
    warnings: asWarnings(record.warnings, flag),
    mime: "image/jpeg",
    byteSize: typeof record.byteSize === "number" ? record.byteSize : 0,
    width: typeof record.width === "number" ? record.width : 0,
    height: typeof record.height === "number" ? record.height : 0,
    exifOrientation: typeof record.exifOrientation === "number" ? record.exifOrientation : 1,
    orientedWidth: typeof record.orientedWidth === "number" ? record.orientedWidth : 0,
    orientedHeight: typeof record.orientedHeight === "number" ? record.orientedHeight : 0,
    pose: record.pose ?? null,
    direction: record.direction ?? null,
    motion: record.motion ?? null,
    quality: record.quality ?? null,
    uploadedAt: typeof record.uploadedAt === "string" ? record.uploadedAt : null,
    updatedAt: asIso(record.updatedAt, asIso(record.uploadedAt, createdAt)),
  };
}

function asPoint(value: unknown, fallback: string): SurveyPoint | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<SurveyPoint>;
  if (typeof record.id !== "string" || !record.id) return null;
  return {
    id: record.id,
    label: asString(record.label, "A").slice(0, 40),
    observations: asObservations(record.observations),
    updatedAt: asIso(record.updatedAt, fallback),
  };
}

function asMeasurement(value: unknown, fallback: string): SurveyMeasurement | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<SurveyMeasurement> & { labelA?: unknown; labelB?: unknown };
  if (typeof record.id !== "string" || !record.id) return null;
  if (typeof record.pointA !== "string" || typeof record.pointB !== "string") return null;
  const distance = Number(record.distanceMm);
  if (!Number.isFinite(distance)) return null;
  const createdAt = asIso(record.createdAt, fallback);
  return {
    id: record.id,
    pointA: record.pointA,
    pointB: record.pointB,
    labelA: typeof record.labelA === "string" ? record.labelA : null,
    labelB: typeof record.labelB === "string" ? record.labelB : null,
    distanceMm: distance,
    note: asString(record.note).slice(0, 500),
    createdAt,
    updatedAt: asIso(record.updatedAt, createdAt),
  };
}

function asTombstones(value: unknown) {
  const empty = { photos: [] as Tombstone[], points: [] as Tombstone[], measurements: [] as Tombstone[] };
  if (!value || typeof value !== "object") return empty;
  const record = value as { photos?: unknown; points?: unknown; measurements?: unknown };
  const read = (items: unknown) => {
    if (!Array.isArray(items)) return [];
    const tombs: Tombstone[] = [];
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const row = item as Partial<Tombstone>;
      if (typeof row.id !== "string" || typeof row.deletedAt !== "string") continue;
      if (!Number.isFinite(Date.parse(row.deletedAt))) continue;
      tombs.push({ id: row.id, deletedAt: row.deletedAt });
    }
    return tombs;
  };
  return { photos: read(record.photos), points: read(record.points), measurements: read(record.measurements) };
}

export function parseSurveyDocument(value: unknown, expectedId?: string): SurveyDocument | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<SurveyDocument> & { project?: Partial<SurveyProject> };
  const project = record.project;
  if (!project || typeof project.id !== "string" || !project.id) return null;
  if (expectedId && project.id !== expectedId) return null;
  const createdAt = asIso(project.createdAt, new Date(0).toISOString());
  const updatedAt = asIso(project.updatedAt, asIso(record.updatedAt, createdAt));
  const photos = (Array.isArray(record.photos) ? record.photos : [])
    .map((item) => asPhoto(item, updatedAt))
    .filter((item): item is SurveyPhoto => item != null);
  const points = (Array.isArray(record.points) ? record.points : [])
    .map((item) => asPoint(item, updatedAt))
    .filter((item): item is SurveyPoint => item != null);
  const measurements = (Array.isArray(record.measurements) ? record.measurements : [])
    .map((item) => asMeasurement(item, updatedAt))
    .filter((item): item is SurveyMeasurement => item != null);
  const revision = typeof record.revision === "number" && Number.isFinite(record.revision) ? Math.max(0, Math.floor(record.revision)) : 0;
  return {
    version: 2,
    app: "Siderio Vcad",
    exportedAt: asIso(record.exportedAt, updatedAt),
    coordinateSpace: COORDINATE_SPACE,
    revision,
    updatedAt: asIso(record.updatedAt, updatedAt),
    deletedAt: typeof record.deletedAt === "string" && Number.isFinite(Date.parse(record.deletedAt)) ? record.deletedAt : null,
    project: {
      id: project.id,
      name: asString(project.name, "Senza nome").slice(0, 200) || "Senza nome",
      kind: asKind(project.kind),
      notes: asString(project.notes).slice(0, 4000),
      createdAt,
      updatedAt,
      job: asJob(project.job, updatedAt),
      scaleChecklist: project.scaleChecklist ? asChecklist(project.scaleChecklist) : emptyChecklist(),
    },
    photos,
    points,
    measurements,
    tombstones: asTombstones(record.tombstones),
  };
}

export function documentFromParts(input: {
  project: Project;
  photos: PhotoMeta[];
  points: NotablePoint[];
  measurements: Measurement[];
  files: Map<string, string>;
  allPhotos: PhotoMeta[];
  allPoints: NotablePoint[];
  allMeasurements: Measurement[];
}): SurveyDocument {
  const fallback = input.project.updatedAt || input.project.createdAt;
  const labelOf = (id: string) => input.points.find((point) => point.id === id)?.label ?? null;
  const tombs = (rows: Array<{ id: string; deletedAt?: string | null }>): Tombstone[] =>
    rows.flatMap((row) => (row.deletedAt ? [{ id: row.id, deletedAt: row.deletedAt }] : []));
  return {
    version: 2,
    app: "Siderio Vcad",
    exportedAt: new Date().toISOString(),
    coordinateSpace: COORDINATE_SPACE,
    revision: input.project.revision ?? 0,
    updatedAt: fallback,
    deletedAt: null,
    project: {
      id: input.project.id,
      name: input.project.name,
      kind: input.project.kind,
      notes: input.project.notes,
      createdAt: input.project.createdAt,
      updatedAt: input.project.updatedAt,
      job: input.project.job,
      scaleChecklist: input.project.scaleChecklist ?? emptyChecklist(),
    },
    photos: input.photos.map((photo) => ({
      id: photo.id,
      file: input.files.get(photo.id) ?? null,
      r2Key: photo.r2Key,
      sequence: photo.sequence,
      createdAt: photo.createdAt,
      accepted: photo.accepted,
      rejectReason: photo.rejectReason,
      flag: photo.flag,
      warnings: photo.warnings,
      mime: "image/jpeg",
      byteSize: photo.byteSize,
      width: photo.width,
      height: photo.height,
      exifOrientation: photo.exifOrientation,
      orientedWidth: photo.orientedWidth,
      orientedHeight: photo.orientedHeight,
      pose: photo.pose,
      direction: photo.direction,
      motion: photo.motion,
      quality: photo.quality,
      uploadedAt: photo.uploadedAt,
      updatedAt: photo.updatedAt || photo.uploadedAt || photo.createdAt || fallback,
    })),
    points: input.points.map((point) => ({
      id: point.id,
      label: point.label,
      observations: point.observations,
      updatedAt: point.updatedAt || fallback,
    })),
    measurements: input.measurements.map((measurement) => ({
      id: measurement.id,
      pointA: measurement.pointA,
      pointB: measurement.pointB,
      labelA: labelOf(measurement.pointA),
      labelB: labelOf(measurement.pointB),
      distanceMm: measurement.distanceMm,
      note: measurement.note,
      createdAt: measurement.createdAt,
      updatedAt: measurement.updatedAt || measurement.createdAt || fallback,
    })),
    tombstones: {
      photos: tombs(input.allPhotos),
      points: tombs(input.allPoints),
      measurements: tombs(input.allMeasurements),
    },
  };
}

export function photoMetaFromSurvey(photo: SurveyPhoto, projectId: string, existing: PhotoMeta | null): PhotoMeta {
  return {
    id: photo.id,
    projectId,
    createdAt: photo.createdAt,
    sequence: photo.sequence,
    accepted: photo.accepted,
    rejectReason: photo.rejectReason,
    flag: photo.flag,
    warnings: photo.warnings,
    mime: "image/jpeg",
    r2Key: photo.r2Key ?? existing?.r2Key ?? null,
    uploadedAt: photo.uploadedAt ?? existing?.uploadedAt ?? null,
    localBlob: existing?.localBlob === true,
    byteSize: photo.byteSize || existing?.byteSize || 0,
    width: photo.width || existing?.width || 0,
    height: photo.height || existing?.height || 0,
    exifOrientation: photo.exifOrientation || existing?.exifOrientation || 1,
    orientedWidth: photo.orientedWidth || existing?.orientedWidth || 0,
    orientedHeight: photo.orientedHeight || existing?.orientedHeight || 0,
    pose: photo.pose,
    direction: photo.direction,
    motion: photo.motion,
    quality: photo.quality,
    updatedAt: photo.updatedAt,
    deletedAt: null,
  };
}

export function pointFromSurvey(point: SurveyPoint, projectId: string): NotablePoint {
  return {
    id: point.id,
    projectId,
    label: point.label,
    observations: point.observations,
    updatedAt: point.updatedAt,
    deletedAt: null,
  };
}

export function measurementFromSurvey(measurement: SurveyMeasurement, projectId: string): Measurement {
  return {
    id: measurement.id,
    projectId,
    pointA: measurement.pointA,
    pointB: measurement.pointB,
    distanceMm: measurement.distanceMm,
    note: measurement.note,
    createdAt: measurement.createdAt,
    updatedAt: measurement.updatedAt,
    deletedAt: null,
  };
}
