import type { Point } from "../models/types";

export function dist(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

export function segmentNormal(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): { nx: number; ny: number } {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  return { nx: -dy / len, ny: dx / len };
}

/** Scostamento con segno: sopra/sotto rispetto al punto medio del tratto. */
export function signedPerpOffset(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  px: number,
  py: number,
): number {
  const { nx, ny } = segmentNormal(x1, y1, x2, y2);
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  return (px - mx) * nx + (py - my) * ny;
}

/** Linea di quota parallela al tratto, scostata di `off`. */
export function offsetMeasureLine(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  off: number,
): { a: Point; b: Point } {
  const { nx, ny } = segmentNormal(x1, y1, x2, y2);
  return {
    a: { x: x1 + nx * off, y: y1 + ny * off },
    b: { x: x2 + nx * off, y: y2 + ny * off },
  };
}

export function distToSegment(
  p: Point,
  a: Point,
  b: Point,
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return dist(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function distToPolyline(p: Point, points: Point[]): number {
  if (points.length === 0) return Infinity;
  if (points.length === 1) return dist(p, points[0]);
  let min = Infinity;
  for (let i = 1; i < points.length; i++) {
    min = Math.min(min, distToSegment(p, points[i - 1], points[i]));
  }
  return min;
}

export function rectFromSize(
  x: number,
  y: number,
  w: number,
  h: number,
  rotation = 0,
): { x: number; y: number; width: number; height: number; rotation: number } {
  return { x, y, width: w, height: h, rotation };
}

export function pointInRotatedRect(
  p: Point,
  rect: { x: number; y: number; width: number; height: number; rotation: number },
): boolean {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const rad = (-rect.rotation * Math.PI) / 180;
  const dx = p.x - cx;
  const dy = p.y - cy;
  const lx = dx * Math.cos(rad) - dy * Math.sin(rad) + cx;
  const ly = dx * Math.sin(rad) + dy * Math.cos(rad) + cy;
  return (
    lx >= rect.x &&
    lx <= rect.x + rect.width &&
    ly >= rect.y &&
    ly <= rect.y + rect.height
  );
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
