import { sequenceName, safeFileName } from "../format";
import type { RilievoRepository } from "../data/repository";
import { buildProjectDocument } from "./document";
import { fetchRemotePhoto } from "../upload/remote";

export type ProjectArchive = {
  blob: Blob;
  filename: string;
};

/**
 * Original JPEGs plus project.json.
 * Accepted shots are named in capture order (001.jpg…).
 * Rejected shots kept by the debug toggle go under scartate/.
 * If the local JPEG was freed after upload, the bytes are read back from R2.
 */
export async function exportProjectZip(
  repository: RilievoRepository,
  projectId: string,
): Promise<ProjectArchive> {
  const project = await repository.getProject(projectId);
  if (!project) throw new Error("Rilievo non trovato.");
  const photos = await repository.listPhotos(projectId);

  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();

  let acceptedIndex = 0;
  let rejectedIndex = 0;
  for (const photo of photos) {
    const path = photo.accepted
      ? `foto/${sequenceName((acceptedIndex += 1))}`
      : `scartate/${sequenceName((rejectedIndex += 1))}`;
    const bytes = await photoBytes(repository, photo.id, photo.r2Key);
    if (bytes) zip.file(path, bytes);
  }

  const payload = await buildProjectDocument(repository, projectId);
  zip.file("project.json", JSON.stringify(payload, null, 2));
  const blob = await zip.generateAsync({ type: "blob", compression: "STORE" });
  return { blob, filename: `${safeFileName(project.name)}.zip` };
}

async function photoBytes(repository: RilievoRepository, photoId: string, r2Key: string | null) {
  const full = await repository.getPhoto(photoId);
  if (full?.blob) return full.blob;
  if (!r2Key) return null;
  return fetchRemotePhoto(r2Key);
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
