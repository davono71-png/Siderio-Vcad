import type { ResultName } from "./files";
import type { SceneDoc } from "./scene";

export type JobStatusDoc = {
  ok: boolean | null;
  stage: string | null;
  progress: number | null;
  message: string | null;
  error: string | null;
  updatedAt: string | null;
};

export type ResultsPayload = {
  ok: true;
  projectId: string;
  empty: boolean;
  name: string | null;
  kind: "stanza" | "facciata" | null;
  engineReady: boolean;
  files: { name: ResultName; bytes: number; viewUrl: string | null }[];
  scene: SceneDoc | null;
  status: JobStatusDoc | null;
  photos: { registered: number | null; total: number | null };
  warnings: string[];
};
