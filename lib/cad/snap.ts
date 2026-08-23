import type { CadElement } from "../models/types";
import { cadToPagePoint, pageToCadPoint } from "../drawing/render";
import { primitiveVisible } from "./visible";

export type SnapKind = "end" | "mid" | "center" | "quad" | "rim";

export type SnapPoint = {
  x: number;
  y: number;
  kind: SnapKind;
  entityId: string;
};

const TWO_PI = Math.PI * 2;

function normAng(a: number): number {
  let x = a % TWO_PI;
  if (x < 0) x += TWO_PI;
  return x;
}

/** DXF: arco in senso antiorario da start a end, può attraversare 0. */
export function angleOnArc(ang: number, start: number, end: number): boolean {
  const a = normAng(ang);
  const s = normAng(start);
  const e = normAng(end);
  if (s <= e) return a >= s - 1e-6 && a <= e + 1e-6;
  return a >= s - 1e-6 || a <= e + 1e-6;
}

function arcMidAngle(start: number, end: number): number {
  let sweep = end - start;
  while (sweep < 0) sweep += TWO_PI;
  while (sweep > TWO_PI) sweep -= TWO_PI;
  return start + sweep / 2;
}

function polar(cx: number, cy: number, r: number, ang: number) {
  return { x: cx + r * Math.cos(ang), y: cy + r * Math.sin(ang) };
}

export function cadSnapPoints(
  cad: CadElement,
  pageBox = {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  },
): SnapPoint[] {
  const box =
    pageBox.width > 0 ? pageBox : { x: 0, y: 0, width: 1000, height: 1000 };
  const out: SnapPoint[] = [];
  const toPage = (x: number, y: number) => cadToPagePoint(x, y, cad.bounds, box);

  for (const p of cad.primitives) {
    if (!primitiveVisible(cad, p)) continue;
    if (p.kind === "hatch") continue;
    if (p.kind === "line") {
      const a = toPage(p.x1, p.y1);
      const b = toPage(p.x2, p.y2);
      out.push({ ...a, kind: "end", entityId: p.id }, { ...b, kind: "end", entityId: p.id });
      out.push({
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
        kind: "mid",
        entityId: p.id,
      });
    } else if (p.kind === "circle") {
      const c = toPage(p.cx, p.cy);
      out.push({ ...c, kind: "center", entityId: p.id });
      for (const q of [
        toPage(p.cx + p.r, p.cy),
        toPage(p.cx - p.r, p.cy),
        toPage(p.cx, p.cy + p.r),
        toPage(p.cx, p.cy - p.r),
      ]) {
        out.push({ ...q, kind: "quad", entityId: p.id });
      }
    } else if (p.kind === "arc") {
      const c = toPage(p.cx, p.cy);
      out.push({ ...c, kind: "center", entityId: p.id });
      const start = polar(p.cx, p.cy, p.r, p.start);
      const end = polar(p.cx, p.cy, p.r, p.end);
      const mid = polar(p.cx, p.cy, p.r, arcMidAngle(p.start, p.end));
      out.push(
        { ...toPage(start.x, start.y), kind: "end", entityId: p.id },
        { ...toPage(end.x, end.y), kind: "end", entityId: p.id },
        { ...toPage(mid.x, mid.y), kind: "mid", entityId: p.id },
      );
    } else if (p.kind === "polyline") {
      for (const pt of p.points) {
        out.push({ ...toPage(pt.x, pt.y), kind: "end", entityId: p.id });
      }
    }
  }
  return out;
}

function rimSnaps(
  x: number,
  y: number,
  cad: CadElement,
  box: { x: number; y: number; width: number; height: number },
): SnapPoint[] {
  const cadPt = pageToCadPoint(x, y, cad.bounds, box);
  const out: SnapPoint[] = [];
  for (const p of cad.primitives) {
    if (!primitiveVisible(cad, p)) continue;
    if (p.kind !== "circle" && p.kind !== "arc") continue;
    const dx = cadPt.x - p.cx;
    const dy = cadPt.y - p.cy;
    const d = Math.hypot(dx, dy);
    if (d < 1e-9 || p.r <= 0) continue;
    const ang = Math.atan2(dy, dx);
    if (p.kind === "arc" && !angleOnArc(ang, p.start, p.end)) continue;
    const rim = cadToPagePoint(
      p.cx + (dx / d) * p.r,
      p.cy + (dy / d) * p.r,
      cad.bounds,
      box,
    );
    out.push({ ...rim, kind: "rim", entityId: p.id });
  }
  return out;
}

export function snapNear(
  x: number,
  y: number,
  snaps: SnapPoint[],
  threshold: number,
): SnapPoint | null {
  let best: SnapPoint | null = null;
  let bestD = threshold;
  for (const s of snaps) {
    const d = Math.hypot(s.x - x, s.y - y);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

/** Snap statici + proiezione sul bordo di cerchi e archi. */
export function snapCad(
  x: number,
  y: number,
  cad: CadElement,
  pageBox: { x: number; y: number; width: number; height: number },
  threshold: number,
): SnapPoint | null {
  const box =
    pageBox.width > 0 ? pageBox : { x: 0, y: 0, width: 1000, height: 1000 };
  return snapNear(x, y, [...cadSnapPoints(cad, box), ...rimSnaps(x, y, cad, box)], threshold);
}
