import type { SurveyDocument } from "../sync/document";
import type {
  Measurement,
  NewPhotoInput,
  NewProjectInput,
  NotablePoint,
  PhotoMeta,
  Project,
  ProjectJob,
  ProjectPatch,
  ThumbRecord,
  UploadRecord,
  UploadSummary,
} from "./types";

/**
 * Storage seam for rilievi.
 * Pages talk only to this interface. The current implementation is IndexedDB
 * on the device; a later Supabase repository can implement the same methods
 * and sync blobs to Storage without rewriting the screens.
 */
export interface RilievoRepository {
  listProjects(): Promise<Project[]>;
  getProject(id: string): Promise<Project | null>;
  createProject(input: NewProjectInput): Promise<Project>;
  updateProject(id: string, patch: ProjectPatch): Promise<Project>;
  deleteProject(id: string): Promise<void>;

  listPhotos(projectId: string): Promise<PhotoMeta[]>;
  getPhoto(id: string): Promise<{ meta: PhotoMeta; blob: Blob | null } | null>;
  listThumbs(projectId: string): Promise<ThumbRecord[]>;
  addPhoto(input: NewPhotoInput): Promise<PhotoMeta>;
  deletePhoto(id: string): Promise<void>;

  listPoints(projectId: string): Promise<NotablePoint[]>;
  listAllPoints(projectId: string): Promise<NotablePoint[]>;
  upsertPoint(point: NotablePoint): Promise<void>;
  deletePoint(id: string): Promise<void>;

  listMeasurements(projectId: string): Promise<Measurement[]>;
  listAllMeasurements(projectId: string): Promise<Measurement[]>;
  upsertMeasurement(measurement: Measurement): Promise<void>;
  deleteMeasurement(id: string): Promise<void>;

  listAllPhotos(projectId: string): Promise<PhotoMeta[]>;
  /** Writes a merged archive document without bumping timestamps that are already set. */
  importSurvey(document: SurveyDocument): Promise<void>;

  /**
   * Placeholder for the GPU worker queue. Photos may already be in R2;
   * reconstruction itself is not wired yet.
   */
  enqueueReconstruction(projectId: string): Promise<ProjectJob>;

  enqueuePhotoUpload(meta: PhotoMeta): Promise<void>;
  touchManifest(projectId: string, delayMs?: number): Promise<void>;
  uploadSummary(projectId: string): Promise<UploadSummary>;
  retryUploads(projectId: string): Promise<void>;
  expeditePending(): Promise<void>;
  resetStaleClaims(olderThanMs: number): Promise<void>;
  claimUploads(now: number, limit: number): Promise<UploadRecord[]>;
  finishUpload(id: string, ok: boolean, errorCode: string | null, permanent: boolean): Promise<void>;
  markUploadingAgain(id: string): Promise<void>;
  releaseUploadedBlobs(projectId: string): Promise<number>;
}

export function freshJob(partial?: Partial<ProjectJob>): ProjectJob {
  return {
    status: "non_inviato",
    message: "Le foto restano su questo telefono e, con la rete, vengono copiate sull’archivio. Il worker non è ancora collegato.",
    progress: null,
    updatedAt: new Date().toISOString(),
    ...partial,
  };
}
