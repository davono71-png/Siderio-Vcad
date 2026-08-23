import type { Point } from "../models/types";

/** Keep strokes responsive: drop near-duplicates, keep pressure extrema. */
export function simplifyStroke(points: Point[], minDist = 0.6): Point[] {
  if (points.length < 3) return points;
  const out: Point[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = out[out.length - 1];
    const cur = points[i];
    if (Math.hypot(cur.x - prev.x, cur.y - prev.y) >= minDist) out.push(cur);
  }
  out.push(points[points.length - 1]);
  return out;
}

export function strokePath(ctx: CanvasRenderingContext2D, points: Point[]): void {
  if (points.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  if (points.length === 1) {
    ctx.lineTo(points[0].x + 0.01, points[0].y);
    return;
  }
  if (points.length === 2) {
    ctx.lineTo(points[1].x, points[1].y);
    return;
  }
  for (let i = 1; i < points.length - 1; i++) {
    const midX = (points[i].x + points[i + 1].x) / 2;
    const midY = (points[i].y + points[i + 1].y) / 2;
    ctx.quadraticCurveTo(points[i].x, points[i].y, midX, midY);
  }
  const last = points[points.length - 1];
  ctx.lineTo(last.x, last.y);
}

export function widthForPoint(
  base: number,
  pressure: number | undefined,
  variable: boolean,
): number {
  if (!variable) return base;
  const p = pressure == null || pressure === 0 ? 0.5 : pressure;
  return base * (0.45 + p * 0.9);
}
