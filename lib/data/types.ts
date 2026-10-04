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
};

export type RejectReason = "mosso" | "simile";

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
};

export type PhotoQuality = {
  laplacianVariance: number;
  difference: number | null;
  threshold: number;
};

export type PhotoMeta = {
  id: string;
  projectId: string;
  createdAt: string;
  /** Capture order among photos stored for this project, starting at 1. */
  sequence: number;
  accepted: boolean;
  rejectReason: RejectReason | null;
  flag: "rotazione" | null;
  mime: "image/jpeg";
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

export type ProjectPatch = Partial<Pick<Project, "name" | "kind" | "notes" | "job">>;

export type NewPhotoInput = {
  projectId: string;
  blob: Blob;
  thumb: Blob;
  accepted: boolean;
  rejectReason: RejectReason | null;
  flag: "rotazione" | null;
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
