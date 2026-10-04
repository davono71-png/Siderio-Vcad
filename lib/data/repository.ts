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
  getPhoto(id: string): Promise<{ meta: PhotoMeta; blob: Blob } | null>;
  listThumbs(projectId: string): Promise<ThumbRecord[]>;
  addPhoto(input: NewPhotoInput): Promise<PhotoMeta>;
  deletePhoto(id: string): Promise<void>;

  listPoints(projectId: string): Promise<NotablePoint[]>;
  upsertPoint(point: NotablePoint): Promise<void>;
  deletePoint(id: string): Promise<void>;

  listMeasurements(projectId: string): Promise<Measurement[]>;
  upsertMeasurement(measurement: Measurement): Promise<void>;
  deleteMeasurement(id: string): Promise<void>;

  /**
   * Placeholder for the GPU worker queue. Local builds record the attempt
   * and explain that upload is not wired yet.
   */
  enqueueReconstruction(projectId: string): Promise<ProjectJob>;
}

export function freshJob(partial?: Partial<ProjectJob>): ProjectJob {
  return {
    status: "non_inviato",
    message: "Le foto restano su questo dispositivo finché non le invii al worker.",
    progress: null,
    updatedAt: new Date().toISOString(),
    ...partial,
  };
}
