import { contentSignature, timeOf, type SurveyDocument, type SurveyMeasurement, type SurveyPhoto, type SurveyPoint, type Tombstone } from "./document";

function later(a: string | null | undefined, b: string | null | undefined) {
  return timeOf(a) >= timeOf(b) ? (a ?? b ?? "") : (b ?? a ?? "");
}

function earlier(a: string, b: string) {
  return timeOf(a) <= timeOf(b) ? a : b;
}

function latestTomb(items: Tombstone[], id: string) {
  let found: Tombstone | null = null;
  for (const item of items) {
    if (item.id !== id) continue;
    if (!found || timeOf(item.deletedAt) >= timeOf(found.deletedAt)) found = item;
  }
  return found;
}

function mergePhoto(left: SurveyPhoto | undefined, right: SurveyPhoto | undefined): SurveyPhoto | null {
  if (!left) return right ?? null;
  if (!right) return left;
  const leftAt = timeOf(left.updatedAt || left.uploadedAt || left.createdAt);
  const rightAt = timeOf(right.updatedAt || right.uploadedAt || right.createdAt);
  const newer = leftAt >= rightAt ? left : right;
  const older = newer === left ? right : left;
  return {
    ...older,
    ...newer,
    r2Key: newer.r2Key || older.r2Key,
    file: newer.file || older.file,
    uploadedAt: newer.uploadedAt || older.uploadedAt,
  };
}

function mergePoint(left: SurveyPoint | undefined, right: SurveyPoint | undefined): SurveyPoint | null {
  if (!left) return right ?? null;
  if (!right) return left;
  const newer = timeOf(left.updatedAt) >= timeOf(right.updatedAt) ? left : right;
  const older = newer === left ? right : left;
  const byPhoto = new Map<string, { observation: SurveyPoint["observations"][number]; at: number }>();
  for (const source of [older, newer]) {
    for (const observation of source.observations) {
      const at = timeOf(source.updatedAt);
      const previous = byPhoto.get(observation.photoId);
      if (!previous || at >= previous.at) byPhoto.set(observation.photoId, { observation, at });
    }
  }
  return {
    ...newer,
    updatedAt: later(left.updatedAt, right.updatedAt),
    observations: [...byPhoto.values()].map((item) => item.observation),
  };
}

function mergeMeasurement(left: SurveyMeasurement | undefined, right: SurveyMeasurement | undefined) {
  if (!left) return right ?? null;
  if (!right) return left;
  return timeOf(left.updatedAt) >= timeOf(right.updatedAt) ? left : right;
}

function keepLive<T extends { id: string; updatedAt: string }>(item: T | null, tombs: Tombstone[]) {
  if (!item) return { item: null as T | null, tomb: null as Tombstone | null };
  const tomb = latestTomb(tombs, item.id);
  if (tomb && timeOf(tomb.deletedAt) >= timeOf(item.updatedAt)) return { item: null, tomb };
  return { item, tomb: null };
}

/**
 * Per-id merge. An item that exists on only one side is kept.
 * A tombstone wins when its deletedAt is at least the item's updatedAt.
 * A later edit resurrects the item.
 */
export function mergeDocuments(left: SurveyDocument, right: SurveyDocument): SurveyDocument {
  const project = timeOf(left.project.updatedAt) >= timeOf(right.project.updatedAt) ? left.project : right.project;
  const photoTombs = [...left.tombstones.photos, ...right.tombstones.photos];
  const pointTombs = [...left.tombstones.points, ...right.tombstones.points];
  const measureTombs = [...left.tombstones.measurements, ...right.tombstones.measurements];

  const photoIds = new Set([...left.photos, ...right.photos, ...photoTombs].map((item) => item.id));
  const pointIds = new Set([...left.points, ...right.points, ...pointTombs].map((item) => item.id));
  const measureIds = new Set([...left.measurements, ...right.measurements, ...measureTombs].map((item) => item.id));

  const photos: SurveyPhoto[] = [];
  const photoTombstones: Tombstone[] = [];
  for (const id of photoIds) {
    const merged = mergePhoto(
      left.photos.find((item) => item.id === id),
      right.photos.find((item) => item.id === id),
    );
    const kept = keepLive(merged, photoTombs);
    if (kept.item) photos.push(kept.item);
    if (kept.tomb) photoTombstones.push(kept.tomb);
  }

  const points: SurveyPoint[] = [];
  const pointTombstones: Tombstone[] = [];
  for (const id of pointIds) {
    const merged = mergePoint(
      left.points.find((item) => item.id === id),
      right.points.find((item) => item.id === id),
    );
    const kept = keepLive(merged, pointTombs);
    if (kept.item) points.push(kept.item);
    if (kept.tomb) pointTombstones.push(kept.tomb);
  }

  const measurements: SurveyMeasurement[] = [];
  const measurementTombstones: Tombstone[] = [];
  for (const id of measureIds) {
    const merged = mergeMeasurement(
      left.measurements.find((item) => item.id === id),
      right.measurements.find((item) => item.id === id),
    );
    const kept = keepLive(merged, measureTombs);
    if (kept.item) measurements.push(kept.item);
    if (kept.tomb) measurementTombstones.push(kept.tomb);
  }

  const deletedAt = later(left.deletedAt, right.deletedAt) || null;
  const removed = Boolean(deletedAt) && timeOf(deletedAt) >= timeOf(project.updatedAt);
  const now = later(left.updatedAt, right.updatedAt) || project.updatedAt;

  return {
    version: 2,
    app: "Siderio Vcad",
    exportedAt: now,
    coordinateSpace: left.coordinateSpace || right.coordinateSpace,
    revision: Math.max(left.revision, right.revision),
    updatedAt: now,
    deletedAt: removed ? deletedAt : null,
    project: {
      ...project,
      id: left.project.id || right.project.id,
      createdAt: earlier(left.project.createdAt, right.project.createdAt),
    },
    photos: photos.sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id)),
    points,
    measurements,
    tombstones: {
      photos: photoTombstones,
      points: pointTombstones,
      measurements: measurementTombstones,
    },
  };
}

export function sameContent(left: SurveyDocument, right: SurveyDocument) {
  return contentSignature(left) === contentSignature(right);
}
