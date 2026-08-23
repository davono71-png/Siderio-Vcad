import type { CadLayer, CadPrimitive } from "../models/types";

type Pair = { code: number; value: string };

type DxfEnt = {
  type: string;
  map: Map<number, string[]>;
  pairs: Pair[];
};

export type ParsedCad = {
  primitives: CadPrimitive[];
  layers: CadLayer[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  unitsPerMm: number;
  unitsFromFile: boolean;
};

const ACI: Record<number, string> = {
  1: "#C62828",
  2: "#F9A825",
  3: "#2E7D32",
  4: "#00838F",
  5: "#1565C0",
  6: "#6A1B9A",
  7: "#1A2332",
  8: "#546E7A",
  9: "#C45C26",
};

function pairsFromText(text: string): Pair[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const pairs: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i].trim());
    if (Number.isNaN(code)) continue;
    pairs.push({ code, value: lines[i + 1] ?? "" });
  }
  return pairs;
}

function nums(entity: Map<number, string[]>, code: number): number[] {
  return (entity.get(code) ?? []).map(Number);
}

function num(entity: Map<number, string[]>, code: number, d = 0): number {
  const v = entity.get(code)?.[0];
  return v == null ? d : Number(v);
}

function str(entity: Map<number, string[]>, code: number, d = ""): string {
  return (entity.get(code)?.[0] ?? d).trim();
}

function aci(n: number, fallback = "#1A2332"): string {
  const abs = Math.abs(n);
  if (abs === 256 || abs === 0) return fallback;
  return ACI[abs] ?? fallback;
}

function sectionRanges(pairs: Pair[], name: string): Pair[] {
  const out: Pair[] = [];
  let inSec = false;
  for (let i = 0; i < pairs.length; i++) {
    const { code, value } = pairs[i];
    if (code === 0 && value.trim() === "SECTION") {
      const n = pairs[i + 1]?.code === 2 ? pairs[i + 1].value.trim() : "";
      inSec = n === name;
      continue;
    }
    if (code === 0 && value.trim() === "ENDSEC") {
      inSec = false;
      continue;
    }
    if (inSec) out.push(pairs[i]);
  }
  return out;
}

function entitiesFrom(pairs: Pair[]): DxfEnt[] {
  const entities: DxfEnt[] = [];
  let current: DxfEnt | null = null;
  const flush = () => {
    if (current) entities.push(current);
    current = null;
  };
  for (const p of pairs) {
    if (p.code === 0) {
      flush();
      current = { type: p.value.trim(), map: new Map(), pairs: [p] };
      current.map.set(0, [p.value.trim()]);
      continue;
    }
    if (!current) continue;
    current.pairs.push(p);
    const arr = current.map.get(p.code) ?? [];
    arr.push(p.value);
    current.map.set(p.code, arr);
  }
  flush();
  return entities;
}

function parseLayers(pairs: Pair[]): CadLayer[] {
  const table = sectionRanges(pairs, "TABLES");
  const ents = entitiesFrom(table);
  const layers: CadLayer[] = [];
  const seen = new Set<string>();
  for (const e of ents) {
    if (e.type !== "LAYER") continue;
    const name = str(e.map, 2, "0") || "0";
    if (seen.has(name)) continue;
    seen.add(name);
    const flags = num(e.map, 70);
    const col = num(e.map, 62, 7);
    layers.push({
      name,
      color: aci(col),
      visible: (flags & 1) === 0 && col >= 0,
    });
  }
  if (!layers.some((l) => l.name === "0")) {
    layers.unshift({ name: "0", color: "#1A2332", visible: true });
  }
  return layers;
}

function parseBlocks(pairs: Pair[]): Map<string, DxfEnt[]> {
  const blockPairs = sectionRanges(pairs, "BLOCKS");
  const ents = entitiesFrom(blockPairs);
  const blocks = new Map<string, DxfEnt[]>();
  let name = "";
  let body: DxfEnt[] = [];
  const flush = () => {
    if (name && !name.startsWith("*")) blocks.set(name.toUpperCase(), body);
    name = "";
    body = [];
  };
  for (const e of ents) {
    if (e.type === "BLOCK") {
      flush();
      name = str(e.map, 2);
      body = [];
      continue;
    }
    if (e.type === "ENDBLK") {
      flush();
      continue;
    }
    if (name) body.push(e);
  }
  flush();
  return blocks;
}

function groupPolylines(ents: DxfEnt[]): DxfEnt[] {
  const out: DxfEnt[] = [];
  for (let i = 0; i < ents.length; i++) {
    const e = ents[i];
    if (e.type !== "POLYLINE") {
      out.push(e);
      continue;
    }
    const xs: string[] = [];
    const ys: string[] = [];
    i += 1;
    while (i < ents.length && ents[i].type === "VERTEX") {
      xs.push(ents[i].map.get(10)?.[0] ?? "0");
      ys.push(ents[i].map.get(20)?.[0] ?? "0");
      i += 1;
    }
    if (i < ents.length && ents[i].type === "SEQEND") {
      /* consume */
    } else {
      i -= 1;
    }
    const map = new Map(e.map);
    map.set(10, xs);
    map.set(20, ys);
    out.push({ type: "LWPOLYLINE", map, pairs: e.pairs });
  }
  return out;
}

function layerOf(e: DxfEnt): string {
  return str(e.map, 8, "0") || "0";
}

function colorOf(e: DxfEnt, layers: CadLayer[], layerName: string): string {
  const raw = e.map.get(62)?.[0];
  const layerCol = layers.find((l) => l.name === layerName)?.color ?? "#1A2332";
  if (raw == null) return layerCol;
  const n = Number(raw);
  if (n === 256 || n === 0) return layerCol;
  return aci(n, layerCol);
}

function hatchOf(e: DxfEnt, id: string, color: string, layer: string): CadPrimitive | null {
  const pattern = str(e.map, 2).toUpperCase();
  const solidFlag = num(e.map, 70);
  const solid = pattern === "SOLID" || solidFlag === 1;
  const loops: { x: number; y: number }[][] = [];
  let loop: { x: number; y: number }[] = [];
  let edge = "";
  let x1 = 0;
  let y1 = 0;
  const flushLoop = () => {
    if (loop.length >= 2) loops.push(loop);
    loop = [];
  };
  for (const p of e.pairs) {
    if (p.code === 92) {
      flushLoop();
      edge = "";
      continue;
    }
    if (p.code === 72) {
      edge = p.value.trim();
      continue;
    }
    if (p.code === 10) x1 = Number(p.value);
    if (p.code === 20) {
      y1 = Number(p.value);
      if (edge === "1" || edge === "") loop.push({ x: x1, y: y1 });
    }
    if (p.code === 11) x1 = Number(p.value);
    if (p.code === 21) {
      y1 = Number(p.value);
      loop.push({ x: x1, y: y1 });
    }
  }
  flushLoop();
  const xs = nums(e.map, 10);
  const ys = nums(e.map, 20);
  if (!loops.length && xs.length >= 2) {
    loops.push(xs.map((x, i) => ({ x, y: ys[i] ?? 0 })));
  }
  if (!loops.length) return null;
  return { kind: "hatch", id, layer, color, solid, loops };
}

type Xform = { x: number; y: number; sx: number; sy: number; rot: number };

function applyXform(x: number, y: number, xf: Xform): { x: number; y: number } {
  const xr = x * xf.sx;
  const yr = y * xf.sy;
  const c = Math.cos(xf.rot);
  const s = Math.sin(xf.rot);
  return { x: xf.x + xr * c - yr * s, y: xf.y + xr * s + yr * c };
}

function transformPrim(p: CadPrimitive, xf: Xform): CadPrimitive {
  const t = (x: number, y: number) => applyXform(x, y, xf);
  if (p.kind === "line") {
    const a = t(p.x1, p.y1);
    const b = t(p.x2, p.y2);
    return { ...p, x1: a.x, y1: a.y, x2: b.x, y2: b.y };
  }
  if (p.kind === "circle") {
    const c = t(p.cx, p.cy);
    return { ...p, cx: c.x, cy: c.y, r: p.r * Math.abs(xf.sx) };
  }
  if (p.kind === "arc") {
    const c = t(p.cx, p.cy);
    return { ...p, cx: c.x, cy: c.y, r: p.r * Math.abs(xf.sx), start: p.start + xf.rot, end: p.end + xf.rot };
  }
  if (p.kind === "polyline") {
    return { ...p, points: p.points.map((pt) => t(pt.x, pt.y)) };
  }
  if (p.kind === "text") {
    const c = t(p.x, p.y);
    return { ...p, x: c.x, y: c.y, rotation: p.rotation + xf.rot };
  }
  return {
    ...p,
    loops: p.loops.map((loop) => loop.map((pt) => t(pt.x, pt.y))),
  };
}

function entityToPrim(
  e: DxfEnt,
  nextId: () => string,
  layers: CadLayer[],
): CadPrimitive[] {
  const type = e.type;
  const layer = layerOf(e);
  const color = colorOf(e, layers, layer);
  const out: CadPrimitive[] = [];
  const id = nextId();

  if (type === "LINE") {
    out.push({
      kind: "line",
      id,
      layer,
      color,
      x1: num(e.map, 10),
      y1: num(e.map, 20),
      x2: num(e.map, 11),
      y2: num(e.map, 21),
    });
  } else if (type === "CIRCLE") {
    out.push({
      kind: "circle",
      id,
      layer,
      color,
      cx: num(e.map, 10),
      cy: num(e.map, 20),
      r: num(e.map, 40),
    });
  } else if (type === "ARC") {
    out.push({
      kind: "arc",
      id,
      layer,
      color,
      cx: num(e.map, 10),
      cy: num(e.map, 20),
      r: num(e.map, 40),
      start: (num(e.map, 50) * Math.PI) / 180,
      end: (num(e.map, 51) * Math.PI) / 180,
    });
  } else if (type === "LWPOLYLINE" || type === "POLYLINE") {
    const xs = nums(e.map, 10);
    const ys = nums(e.map, 20);
    const points = xs.map((x, i) => ({ x, y: ys[i] ?? 0 }));
    const flags = num(e.map, 70);
    if (points.length) {
      out.push({
        kind: "polyline",
        id,
        layer,
        color,
        points,
        closed: (flags & 1) === 1,
      });
    }
  } else if (type === "POINT") {
    const x = num(e.map, 10);
    const y = num(e.map, 20);
    out.push({
      kind: "line",
      id,
      layer,
      color,
      x1: x,
      y1: y,
      x2: x + 0.01,
      y2: y,
    });
  } else if (type === "TEXT" || type === "MTEXT") {
    out.push({
      kind: "text",
      id,
      layer,
      color,
      x: num(e.map, 10),
      y: num(e.map, 20),
      height: num(e.map, 40, 2.5),
      rotation: (num(e.map, 50) * Math.PI) / 180,
      value: (e.map.get(1)?.[0] ?? "").replace(/\{\\.*?\}/g, "").replace("\\P", " "),
    });
  } else if (type === "SPLINE") {
    const xs = nums(e.map, 10);
    const ys = nums(e.map, 20);
    const points = xs.map((x, i) => ({ x, y: ys[i] ?? 0 }));
    if (points.length) {
      out.push({ kind: "polyline", id, layer, color, points, closed: false });
    }
  } else if (type === "HATCH") {
    const h = hatchOf(e, id, color, layer);
    if (h) out.push(h);
  }
  return out;
}

function explode(
  ents: DxfEnt[],
  blocks: Map<string, DxfEnt[]>,
  layers: CadLayer[],
  nextId: () => string,
  xf: Xform | null,
  depth: number,
): CadPrimitive[] {
  if (depth > 8) return [];
  const grouped = groupPolylines(ents);
  const out: CadPrimitive[] = [];
  for (const e of grouped) {
    if (e.type === "INSERT") {
      const name = str(e.map, 2).toUpperCase();
      const body = blocks.get(name);
      if (!body) continue;
      const local: Xform = {
        x: num(e.map, 10),
        y: num(e.map, 20),
        sx: num(e.map, 41, 1) || 1,
        sy: num(e.map, 42, 1) || 1,
        rot: (num(e.map, 50) * Math.PI) / 180,
      };
      const nested = explode(body, blocks, layers, nextId, local, depth + 1);
      out.push(...(xf ? nested.map((p) => transformPrim(p, xf)) : nested));
      continue;
    }
    const prims = entityToPrim(e, nextId, layers);
    out.push(...(xf ? prims.map((p) => transformPrim(p, xf)) : prims));
  }
  return out;
}

function boundsOf(primitives: CadPrimitive[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const p of primitives) {
    if (p.kind === "line") {
      add(p.x1, p.y1);
      add(p.x2, p.y2);
    } else if (p.kind === "circle") {
      add(p.cx - p.r, p.cy - p.r);
      add(p.cx + p.r, p.cy + p.r);
    } else if (p.kind === "arc") {
      add(p.cx - p.r, p.cy - p.r);
      add(p.cx + p.r, p.cy + p.r);
    } else if (p.kind === "polyline") {
      for (const pt of p.points) add(pt.x, pt.y);
    } else if (p.kind === "text") {
      add(p.x, p.y);
    } else if (p.kind === "hatch") {
      for (const loop of p.loops) for (const pt of loop) add(pt.x, pt.y);
    }
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 100;
    maxY = 100;
  }
  return { minX, minY, maxX, maxY };
}

function readInsunits(pairs: Pair[]): { mmPerUnit: number; fromFile: boolean } {
  for (let i = 0; i < pairs.length; i++) {
    if (pairs[i].code === 9 && pairs[i].value.trim() === "$INSUNITS") {
      const n = Number(pairs[i + 1]?.value ?? 0);
      if (n === 1) return { mmPerUnit: 25.4, fromFile: true };
      if (n === 2) return { mmPerUnit: 304.8, fromFile: true };
      if (n === 4) return { mmPerUnit: 1, fromFile: true };
      if (n === 5) return { mmPerUnit: 10, fromFile: true };
      if (n === 6) return { mmPerUnit: 1000, fromFile: true };
      if (n === 9) return { mmPerUnit: 100, fromFile: true };
      return { mmPerUnit: 1, fromFile: false };
    }
  }
  return { mmPerUnit: 1, fromFile: false };
}

function ensureLayers(listed: CadLayer[], primitives: CadPrimitive[]): CadLayer[] {
  const byName = new Map(listed.map((l) => [l.name, l]));
  for (const p of primitives) {
    if (!byName.has(p.layer)) {
      const layer = { name: p.layer, color: p.color, visible: true };
      listed.push(layer);
      byName.set(p.layer, layer);
    }
  }
  return listed;
}

export function parseDxf(text: string): ParsedCad {
  const pairs = pairsFromText(text);
  const layers = parseLayers(pairs);
  const blocks = parseBlocks(pairs);
  const ents = entitiesFrom(sectionRanges(pairs, "ENTITIES"));
  let n = 0;
  const nextId = () => `e${++n}`;
  const primitives = explode(ents, blocks, layers, nextId, null, 0);
  const units = readInsunits(pairs);
  return {
    primitives,
    layers: ensureLayers(layers, primitives),
    bounds: boundsOf(primitives),
    unitsPerMm: 1 / Math.max(units.mmPerUnit, 1e-6),
    unitsFromFile: units.fromFile,
  };
}

export function looksLikeDxf(data: ArrayBuffer | string): boolean {
  const sample =
    typeof data === "string"
      ? data.slice(0, 400)
      : new TextDecoder("latin1").decode(data.slice(0, 400));
  return /SECTION|ENTITIES|AcDbLine|EOF/i.test(sample);
}

export function dwgVersionLabel(buffer: ArrayBuffer): string | null {
  const ascii = new TextDecoder("latin1").decode(buffer.slice(0, 6));
  if (ascii.startsWith("AC1")) return ascii;
  return null;
}

/**
 * DWG binario: se contiene un DXF (estensione sbagliata o proxy ASCII)
 * lo si legge. Altrimenti si raccolgono i frammenti leggibili.
 */
export function parseCadFile(fileName: string, buffer: ArrayBuffer): ParsedCad {
  const name = fileName.toLowerCase();
  const textUtf8 = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  if (looksLikeDxf(textUtf8) || name.endsWith(".dxf")) {
    return parseDxf(textUtf8);
  }

  const latin = new TextDecoder("latin1").decode(buffer);
  if (looksLikeDxf(latin)) return parseDxf(latin);

  const harvested = harvestAsciiGeometry(latin);
  if (harvested.primitives.length > 0) return harvested;

  throw new CadParseError(
    "Questo DWG binario non si apre nel browser. Esporta il disegno come DXF (ASCII) da AutoCAD o da un visualizzatore CAD e importalo di nuovo. Il file originale resta allegato.",
  );
}

export class CadParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CadParseError";
  }
}

function harvestAsciiGeometry(raw: string): ParsedCad {
  const primitives: CadPrimitive[] = [];
  const lineRe =
    /LINE[^\d\-]*([\-0-9.]+)[^\d\-]+([\-0-9.]+)[^\d\-]+([\-0-9.]+)[^\d\-]+([\-0-9.]+)/gi;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = lineRe.exec(raw))) {
    primitives.push({
      kind: "line",
      id: `h${++n}`,
      layer: "DWG",
      color: "#1A2332",
      x1: Number(m[1]),
      y1: Number(m[2]),
      x2: Number(m[3]),
      y2: Number(m[4]),
    });
  }
  return {
    primitives: primitives.slice(0, 20000),
    layers: [{ name: "DWG", color: "#1A2332", visible: true }],
    bounds: boundsOf(primitives),
    unitsPerMm: 1,
    unitsFromFile: false,
  };
}
