/** Domain model for a rilievo. Kept free of storage details so a Supabase sync can reuse it. */

export type ProjectKind = "stanza" | "facciata";

export type JobStatus =
  | "non_inviato"
  | "in_coda"
  | "in_elaborazione"
  | "completato"
  | "errore"
  | "non_disponibile";

export type ProjectJob = {
  status: JobStatus;
  message: string;
  progress: number | null;
  updatedAt: string;
};

export type Project = {
  id: string;
  name: string;
  kind: ProjectKind;
  notes: string;
  createdAt: string;
  updatedAt: string;
  job: ProjectJob;
  scaleChecklist: ScaleChecklist;
};

export type RejectReason = "mosso" | "simile";

/** Accepted-shot warnings. They do not drop the photo. */
export type PhotoWarning = "rotazione" | "sovrapposizione" | "texture";

export type ScaleChecklist = {
  lunghezza: boolean;
  larghezza: boolean;
  altezza: boolean;
};

export type PhotoPose = {
  alpha: number | null;
  beta: number | null;
  gamma: number | null;
  absolute: boolean;
  compassHeading: number | null;
  screenAngle: number | null;
};

export type CameraDirection = {
  east: number;
  north: number;
  up: number;
  headingDeg: number;
  elevationDeg: number;
};

export type PhotoMotion = {
  stepDetected: boolean;
  yawDeltaDeg: number | null;
  accelMagnitude: number | null;
  gyroDegPerSec: number | null;
};

export type PhotoQuality = {
  laplacianVariance: number;
  difference: number | null;
  threshold: number;
  cornersPerK: number;
  gradient: number;
};

export type PhotoMeta = {
  id: string;
  projectId: string;
  createdAt: string;
  /** Capture order among photos stored for this project, starting at 1. */
  sequence: number;
  accepted: boolean;
  rejectReason: RejectReason | null;
  /** @deprecated Prefer warnings. Kept for archives written before the texture split. */
  flag: PhotoWarning | null;
  warnings: PhotoWarning[];
  mime: "image/jpeg";
  /** R2 object key once the PUT has succeeded. */
  r2Key: string | null;
  uploadedAt: string | null;
  /** False after the operator frees the local JPEG. The thumb and metadata stay. */
  localBlob: boolean;
  byteSize: number;
  /** JPEG pixel size before EXIF orientation. */
  width: number;
  height: number;
  /** EXIF orientation tag, 1–8. 1 means the pixels are already upright. */
  exifOrientation: number;
  /** Size after applying EXIF orientation. Annotation x/y live in this space. */
  orientedWidth: number;
  orientedHeight: number;
  pose: PhotoPose | null;
  direction: CameraDirection | null;
  motion: PhotoMotion | null;
  quality: PhotoQuality | null;
};

export type PointObservation = {
  photoId: string;
  /** Upright pixels, origin top-left, after EXIF orientation. */
  x: number;
  y: number;
  /** Pixels in the JPEG raster before EXIF orientation. */
  rawX: number;
  rawY: number;
};

export type NotablePoint = {
  id: string;
  projectId: string;
  label: string;
  observations: PointObservation[];
};

export type Measurement = {
  id: string;
  projectId: string;
  pointA: string;
  pointB: string;
  distanceMm: number;
  note: string;
  createdAt: string;
};

export type NewProjectInput = {
  name: string;
  kind: ProjectKind;
  notes: string;
};

export type ProjectPatch = Partial<Pick<Project, "name" | "kind" | "notes" | "job" | "scaleChecklist">>;

export type NewPhotoInput = {
  projectId: string;
  blob: Blob;
  thumb: Blob;
  accepted: boolean;
  rejectReason: RejectReason | null;
  warnings: PhotoWarning[];
  width: number;
  height: number;
  exifOrientation: number;
  orientedWidth: number;
  orientedHeight: number;
  pose: PhotoPose | null;
  direction: CameraDirection | null;
  motion: PhotoMotion | null;
  quality: PhotoQuality | null;
};

export type ThumbRecord = {
  id: string;
  projectId: string;
  blob: Blob;
};

export type UploadKind = "photo" | "manifest";

export type UploadPhase = "in_coda" | "invio" | "caricata" | "errore";

export type UploadRecord = {
  id: string;
  projectId: string;
  kind: UploadKind;
  key: string;
  phase: UploadPhase;
  attempts: number;
  nextAttemptAt: number;
  lastError: string | null;
  again: boolean;
  updatedAt: string;
};

export type UploadSummary = {
  accepted: number;
  uploaded: number;
  pending: number;
  failed: number;
  reclaimable: number;
  lastError: string | null;
};

export function emptyChecklist(): ScaleChecklist {
  return { lunghezza: false, larghezza: false, altezza: false };
}
