/** Object keys the presign route is willing to sign. Not a substitute for auth. */

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PHOTO_KEY = new RegExp(`^rilievi/(${UUID})/foto/(\\d{1,6})-(${UUID})\\.jpg$`, "i");
const MANIFEST_KEY = new RegExp(`^rilievi/(${UUID})/project\\.json$`, "i");

export const MAX_JPEG_BYTES = 25 * 1024 * 1024;
export const MAX_JSON_BYTES = 2 * 1024 * 1024;
export const PRESIGN_SECONDS = 10 * 60;

export function isUuid(value: string) {
  return new RegExp(`^${UUID}$`, "i").test(value);
}

export function photoObjectKey(projectId: string, sequence: number, photoId: string) {
  const seq = String(Math.max(0, Math.floor(sequence))).padStart(3, "0");
  return `rilievi/${projectId}/foto/${seq}-${photoId}.jpg`;
}

export function manifestObjectKey(projectId: string) {
  return `rilievi/${projectId}/project.json`;
}

export type PresignInput = {
  op: string;
  key: string;
  contentType?: string;
  contentLength?: number;
};

export type PresignCheck =
  | { ok: true; kind: "photo" | "manifest" }
  | { ok: false; code: "bad_key" | "bad_type" | "bad_size" | "bad_op" };

export function checkPresign(input: PresignInput): PresignCheck {
  if (input.op !== "put" && input.op !== "get") return { ok: false, code: "bad_op" };
  const photo = PHOTO_KEY.exec(input.key);
  const manifest = MANIFEST_KEY.exec(input.key);
  if (!photo && !manifest) return { ok: false, code: "bad_key" };
  const kind = photo ? "photo" : "manifest";
  if (input.op === "get") return { ok: true, kind };

  const type = (input.contentType ?? "").toLowerCase();
  const size = input.contentLength;
  if (kind === "photo") {
    if (type !== "image/jpeg") return { ok: false, code: "bad_type" };
    if (size == null || !Number.isFinite(size) || size < 1 || size > MAX_JPEG_BYTES) {
      return { ok: false, code: "bad_size" };
    }
  } else {
    if (type !== "application/json") return { ok: false, code: "bad_type" };
    if (size == null || !Number.isFinite(size) || size < 2 || size > MAX_JSON_BYTES) {
      return { ok: false, code: "bad_size" };
    }
  }
  return { ok: true, kind };
}
