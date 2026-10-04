import { sequenceName, safeFileName } from "../format";
import type { RilievoRepository } from "../data/repository";
import type { Measurement, NotablePoint, PhotoMeta, Project } from "../data/types";

export type ProjectArchive = {
  blob: Blob;
  filename: string;
};

/**
 * Original JPEGs plus project.json.
 * Accepted shots are named in capture order (001.jpg…).
 * Rejected shots kept by the debug toggle go under scartate/.
 */
export async function exportProjectZip(
  repository: RilievoRepository,
  projectId: string,
): Promise<ProjectArchive> {
  const project = await repository.getProject(projectId);
  if (!project) throw new Error("Rilievo non trovato.");
  const [photos, points, measurements] = await Promise.all([
    repository.listPhotos(projectId),
    repository.listPoints(projectId),
    repository.listMeasurements(projectId),
  ]);

  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const accepted = photos.filter((photo) => photo.accepted);
  const rejected = photos.filter((photo) => !photo.accepted);
  const files = new Map<string, string>();

  let acceptedIndex = 0;
  for (const photo of accepted) {
    acceptedIndex += 1;
    const path = `foto/${sequenceName(acceptedIndex)}`;
    files.set(photo.id, path);
    const full = await repository.getPhoto(photo.id);
    if (full) zip.file(path, full.blob);
  }

  let rejectedIndex = 0;
  for (const photo of rejected) {
    rejectedIndex += 1;
    const path = `scartate/${sequenceName(rejectedIndex)}`;
    files.set(photo.id, path);
    const full = await repository.getPhoto(photo.id);
    if (full) zip.file(path, full.blob);
  }

  const payload = {
    version: 1,
    app: "Siderio Vcad",
    exportedAt: new Date().toISOString(),
    coordinateSpace:
      "observations.x/y sono pixel del fotogramma raddrizzato (dopo l’orientamento EXIF), origine in alto a sinistra. rawX/rawY sono i pixel nel file JPEG prima dell’EXIF.",
    project: publicProject(project),
    photos: photos.map((photo) => publicPhoto(photo, files.get(photo.id) ?? null)),
    points: points.map(publicPoint),
    measurements: measurements.map((measurement) => publicMeasurement(measurement, points)),
  };

  zip.file("project.json", JSON.stringify(payload, null, 2));
  const blob = await zip.generateAsync({ type: "blob", compression: "STORE" });
  return { blob, filename: `${safeFileName(project.name)}.zip` };
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function publicProject(project: Project) {
  return {
    id: project.id,
    name: project.name,
    kind: project.kind,
    notes: project.notes,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    job: project.job,
  };
}

function publicPhoto(photo: PhotoMeta, file: string | null) {
  return {
    id: photo.id,
    file,
    sequence: photo.sequence,
    createdAt: photo.createdAt,
    accepted: photo.accepted,
    rejectReason: photo.rejectReason,
    flag: photo.flag,
    mime: photo.mime,
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
  };
}

function publicPoint(point: NotablePoint) {
  return {
    id: point.id,
    label: point.label,
    observations: point.observations,
  };
}

function publicMeasurement(measurement: Measurement, points: NotablePoint[]) {
  const label = (id: string) => points.find((point) => point.id === id)?.label ?? null;
  return {
    id: measurement.id,
    pointA: measurement.pointA,
    pointB: measurement.pointB,
    labelA: label(measurement.pointA),
    labelB: label(measurement.pointB),
    distanceMm: measurement.distanceMm,
    note: measurement.note,
    createdAt: measurement.createdAt,
  };
}
