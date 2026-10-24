import { getRepository } from "../data";
import type { PhotoMeta } from "../data/types";
import { fetchRemotePhoto } from "./remote";

const THUMB_PX = 480;
const PARALLEL = 4;

/** Downscale an upright copy, the same kind of JPEG the camera stores as a thumb. */
async function shrink(blob: Blob): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
    const ratio = Math.min(1, THUMB_PX / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * ratio));
    const height = Math.max(1, Math.round(bitmap.height * ratio));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.72));
  } catch {
    return null;
  }
}

/**
 * Thumbnails for photos this device does not hold, from the archive.
 * A few downloads run at once, each result is kept on the device, and
 * `onThumb` fires as soon as one is ready so the list fills in progressively.
 */
export async function fillRemoteThumbs(
  photos: PhotoMeta[],
  onThumb: (photoId: string, blob: Blob) => void,
  cancelled: () => boolean,
) {
  const queue = photos.filter((photo) => photo.r2Key);
  const repo = getRepository();
  async function worker() {
    while (queue.length && !cancelled()) {
      const photo = queue.shift();
      if (!photo?.r2Key) continue;
      const full = await fetchRemotePhoto(photo.r2Key);
      if (!full || cancelled()) continue;
      const thumb = (await shrink(full)) ?? full;
      if (thumb !== full) await repo.saveThumb({ id: photo.id, projectId: photo.projectId, blob: thumb }).catch(() => undefined);
      if (!cancelled()) onThumb(photo.id, thumb);
    }
  }
  await Promise.all(Array.from({ length: PARALLEL }, worker));
}
