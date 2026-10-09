/** Names the worker writes under rilievi/<id>/risultati/. Nothing else is signed. */

export const RESULT_FILES = [
  "walls.step",
  "extra.step",
  "scene.json",
  "room.json",
  "status.json",
  "scale_report.md",
  "scale_report.json",
  "diagnostic.json",
  "preview_iso.png",
  "preview_top.png",
  "preview_plan.png",
  "room_textured.glb",
  "room_textured_obj.zip",
  "room_dense.ply",
] as const;

export type ResultName = (typeof RESULT_FILES)[number];

const VIEW_TYPES: Partial<Record<ResultName, string>> = {
  "room_textured.glb": "model/gltf-binary",
  "preview_iso.png": "image/png",
  "preview_top.png": "image/png",
  "preview_plan.png": "image/png",
};

export const RESULT_PRESIGN_SECONDS = 60 * 60;

export function isResultName(value: string): value is ResultName {
  return (RESULT_FILES as readonly string[]).includes(value);
}

export function resultObjectKey(projectId: string, name: ResultName) {
  return `rilievi/${projectId}/risultati/${name}`;
}

export function viewContentType(name: ResultName) {
  return VIEW_TYPES[name];
}

export function isViewable(name: ResultName) {
  return name === "room_textured.glb" || name.endsWith(".png");
}
