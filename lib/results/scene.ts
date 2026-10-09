/** Facade / room documents written by the worker. Lengths in the file are millimetres. */

export type ScenePlane = {
  role?: string;
  type?: string;
  step?: string;
  widthMm?: number;
  heightMm?: number;
  thicknessMm?: number;
  originMm?: number[];
  axisU?: number[];
  axisV?: number[];
  normal?: number[];
};

export type SceneOpening = {
  kind?: string;
  x0?: number;
  x1?: number;
  y0?: number;
  y1?: number;
  widthMm?: number;
  heightMm?: number;
};

export type SceneDoc = {
  mode?: string;
  note?: string;
  dims?: { length_x?: number; width_y?: number; height_z?: number };
  planes?: ScenePlane[];
  openings?: SceneOpening[];
  scale?: { warning?: string | null };
  warnings?: unknown;
};

export type WallSolid = {
  role: string;
  origin: [number, number, number];
  axisU: [number, number, number];
  axisV: [number, number, number];
  normal: [number, number, number];
  width: number;
  height: number;
  thickness: number;
  holes: { u0: number; v0: number; u1: number; v1: number }[];
};

const MM = 0.001;

function num(value: unknown) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function vec3(value: number[] | undefined, fallback: [number, number, number]): [number, number, number] {
  const x = num(value?.[0]);
  const y = num(value?.[1]);
  const z = num(value?.[2]);
  if (x == null || y == null || z == null) return fallback;
  return [x, y, z];
}

function unit(v: [number, number, number]): [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len < 1e-8) return v;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function dot(a: [number, number, number], b: [number, number, number]) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function isWall(plane: ScenePlane) {
  if (plane.step === "extra") return false;
  if (plane.step === "walls") return true;
  return plane.role === "background" || plane.role === "terreno" || plane.role === "ritorno";
}

function holesFor(plane: ScenePlane, openings: SceneOpening[], origin: [number, number, number], axisU: [number, number, number], axisV: [number, number, number], width: number, height: number) {
  if (plane.role !== "background") return [];
  const holes = [];
  for (const opening of openings) {
    const x0 = num(opening.x0);
    const x1 = num(opening.x1);
    const y0 = num(opening.y0);
    const y1 = num(opening.y1);
    if (x0 == null || x1 == null || y0 == null || y1 == null) continue;
    const corner = (x: number, y: number): [number, number, number] => [x * MM - origin[0], y * MM - origin[1], 0 - origin[2]];
    const a = corner(x0, y0);
    const b = corner(x1, y1);
    let u0 = Math.min(dot(a, axisU), dot(b, axisU));
    let u1 = Math.max(dot(a, axisU), dot(b, axisU));
    let v0 = Math.min(dot(a, axisV), dot(b, axisV));
    let v1 = Math.max(dot(a, axisV), dot(b, axisV));
    const eps = 0.001;
    u0 = Math.max(eps, u0);
    v0 = Math.max(eps, v0);
    u1 = Math.min(width - eps, u1);
    v1 = Math.min(height - eps, v1);
    if (u1 - u0 < 0.05 || v1 - v0 < 0.05) continue;
    holes.push({ u0, v0, u1, v1 });
  }
  return holes;
}

export function wallSolids(scene: SceneDoc): WallSolid[] {
  const openings = scene.openings ?? [];
  const solids: WallSolid[] = [];
  for (const plane of scene.planes ?? []) {
    if (!isWall(plane)) continue;
    const widthMm = num(plane.widthMm);
    const heightMm = num(plane.heightMm);
    const thicknessMm = num(plane.thicknessMm);
    if (widthMm == null || heightMm == null || thicknessMm == null) continue;
    const width = widthMm * MM;
    const height = heightMm * MM;
    const thickness = thicknessMm * MM;
    if (width < 0.02 || height < 0.02 || thickness < 0.001) continue;
    const originMm = vec3(plane.originMm, [0, 0, 0]);
    const origin: [number, number, number] = [originMm[0] * MM, originMm[1] * MM, originMm[2] * MM];
    const axisU = unit(vec3(plane.axisU, [1, 0, 0]));
    const axisV = unit(vec3(plane.axisV, [0, 1, 0]));
    const normal = unit(vec3(plane.normal, [0, 0, 1]));
    solids.push({
      role: plane.role ?? "muro",
      origin,
      axisU,
      axisV,
      normal,
      width,
      height,
      thickness,
      holes: holesFor(plane, openings, origin, axisU, axisV, width, height),
    });
  }
  if (solids.length > 0) return solids;
  return roomShell(scene);
}

function roomShell(scene: SceneDoc): WallSolid[] {
  const length = (num(scene.dims?.length_x) ?? 0) * MM;
  const width = (num(scene.dims?.width_y) ?? 0) * MM;
  const height = (num(scene.dims?.height_z) ?? 0) * MM;
  if (length < 0.4 || width < 0.4 || height < 0.4) return [];
  const t = 0.15;
  const wall = (role: string, origin: [number, number, number], axisU: [number, number, number], axisV: [number, number, number], normal: [number, number, number], w: number, h: number): WallSolid => ({
    role,
    origin,
    axisU,
    axisV,
    normal,
    width: w,
    height: h,
    thickness: t,
    holes: [],
  });
  return [
    wall("terreno", [0, 0, 0], [1, 0, 0], [0, 0, 1], [0, 1, 0], length, width),
    wall("muro", [0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], length, height),
    wall("muro", [length, 0, width], [-1, 0, 0], [0, 1, 0], [0, 0, -1], length, height),
    wall("muro", [0, 0, width], [0, 0, -1], [0, 1, 0], [1, 0, 0], width, height),
    wall("muro", [length, 0, 0], [0, 0, 1], [0, 1, 0], [-1, 0, 0], width, height),
  ];
}

export type ResultFacts = {
  mode: "stanza" | "facciata" | null;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  doors: { widthMm: number; heightMm: number }[];
};

export function resultFacts(scene: SceneDoc | null): ResultFacts {
  const mode = scene?.mode === "facciata" || scene?.mode === "stanza" ? scene.mode : null;
  const background = scene?.planes?.find((plane) => plane.role === "background");
  const doors = (scene?.openings ?? [])
    .filter((opening) => (opening.kind ?? "door") === "door")
    .map((opening) => ({
      widthMm: num(opening.widthMm) ?? (num(opening.x1) != null && num(opening.x0) != null ? (num(opening.x1) as number) - (num(opening.x0) as number) : 0),
      heightMm: num(opening.heightMm) ?? (num(opening.y1) != null && num(opening.y0) != null ? (num(opening.y1) as number) - (num(opening.y0) as number) : 0),
    }))
    .filter((door) => door.widthMm > 100 && door.heightMm > 100);
  return {
    mode,
    lengthMm: num(background?.widthMm) ?? num(scene?.dims?.length_x),
    widthMm: mode === "facciata" ? null : num(scene?.dims?.width_y),
    heightMm: num(background?.heightMm) ?? num(scene?.dims?.height_z),
    doors,
  };
}
