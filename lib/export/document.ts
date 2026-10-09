import type { RilievoRepository } from "../data/repository";
import type { Measurement, NotablePoint, PhotoMeta, Project } from "../data/types";

export type ProjectDocument = ReturnType<typeof serialize>;

/**
 * Same JSON the ZIP writes as project.json.
 * The R2 copy is this document, uploaded again when points or measurements change.
 */
export async function buildProjectDocument(repository: RilievoRepository, projectId: string) {
  const project = await repository.getProject(projectId);
  if (!project) throw new Error("Rilievo non trovato.");
  const [photos, points, measurements] = await Promise.all([
    repository.listPhotos(projectId),
    repository.listPoints(projectId),
    repository.listMeasurements(projectId),
  ]);
  const files = new Map<string, string>();
  let acceptedIndex = 0;
  let rejectedIndex = 0;
  for (const photo of photos) {
    if (photo.accepted) {
      acceptedIndex += 1;
      files.set(photo.id, `foto/${String(acceptedIndex).padStart(3, "0")}.jpg`);
    } else {
      rejectedIndex += 1;
      files.set(photo.id, `scartate/${String(rejectedIndex).padStart(3, "0")}.jpg`);
    }
  }
  return serialize(project, photos, points, measurements, files);
}

function serialize(
  project: Project,
  photos: PhotoMeta[],
  points: NotablePoint[],
  measurements: Measurement[],
  files: Map<string, string>,
) {
  return {
    version: 2,
    app: "Siderio Vcad",
    exportedAt: new Date().toISOString(),
    coordinateSpace:
      "observations.x/y sono pixel del fotogramma raddrizzato (dopo l’orientamento EXIF), origine in alto a sinistra. rawX/rawY sono i pixel nel file JPEG prima dell’EXIF.",
    project: {
      id: project.id,
      name: project.name,
      kind: project.kind,
      notes: project.notes,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      job: project.job,
      scaleChecklist: project.scaleChecklist,
    },
    photos: photos.map((photo) => ({
      id: photo.id,
      file: files.get(photo.id) ?? null,
      r2Key: photo.r2Key,
      sequence: photo.sequence,
      createdAt: photo.createdAt,
      accepted: photo.accepted,
      rejectReason: photo.rejectReason,
      flag: photo.flag,
      warnings: photo.warnings,
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
      uploadedAt: photo.uploadedAt,
    })),
    points: points.map((point) => ({
      id: point.id,
      label: point.label,
      observations: point.observations,
    })),
    measurements: measurements.map((measurement) => {
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
    }),
  };
}
