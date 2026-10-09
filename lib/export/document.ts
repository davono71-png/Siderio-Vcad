import type { RilievoRepository } from "../data/repository";
import { documentFromParts, type SurveyDocument } from "../sync/document";

export type ProjectDocument = SurveyDocument;

/**
 * Same JSON the ZIP writes as project.json.
 * The R2 copy is this document. Live points and measurements stay in the
 * shape the worker reads; deletions are tombstones beside those arrays.
 */
export async function buildProjectDocument(repository: RilievoRepository, projectId: string) {
  const project = await repository.getProject(projectId);
  if (!project) throw new Error("Rilievo non trovato.");
  const [photos, points, measurements, allPhotos, allPoints, allMeasurements] = await Promise.all([
    repository.listPhotos(projectId),
    repository.listPoints(projectId),
    repository.listMeasurements(projectId),
    repository.listAllPhotos(projectId),
    repository.listAllPoints(projectId),
    repository.listAllMeasurements(projectId),
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
  return documentFromParts({ project, photos, points, measurements, files, allPhotos, allPoints, allMeasurements });
}
