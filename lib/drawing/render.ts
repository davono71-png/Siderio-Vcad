import type { CadElement, CadPrimitive, SurveyPage } from "../models/types";
import { primitiveVisible } from "../cad/visible";
import { strokePath, widthForPoint } from "./smooth";

export function drawPaperBackground(
  ctx: CanvasRenderingContext2D,
  page: SurveyPage,
): void {
  ctx.save();
  ctx.fillStyle = "#FFFBF5";
  ctx.fillRect(0, 0, page.width, page.height);

  if (page.paper === "grid") {
    const step = page.format.startsWith("a4") ? page.width / 42 : 24;
    ctx.strokeStyle = "rgba(44, 44, 44, 0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= page.width; x += step) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, page.height);
    }
    for (let y = 0; y <= page.height; y += step) {
      ctx.moveTo(0, y);
      ctx.lineTo(page.width, y);
    }
    ctx.stroke();
    ctx.strokeStyle = "rgba(44, 44, 44, 0.32)";
    ctx.beginPath();
    for (let x = 0; x <= page.width; x += step * 5) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, page.height);
    }
    for (let y = 0; y <= page.height; y += step * 5) {
      ctx.moveTo(0, y);
      ctx.lineTo(page.width, y);
    }
    ctx.stroke();
  }

  if (page.paper === "lined") {
    const step = 36;
    const margin = page.width * 0.08;
    ctx.strokeStyle = "rgba(44, 44, 44, 0.45)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(margin, 0);
    ctx.lineTo(margin, page.height);
    ctx.stroke();
    ctx.strokeStyle = "rgba(44, 44, 44, 0.28)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let y = step * 2; y < page.height; y += step) {
      ctx.moveTo(0, y);
      ctx.lineTo(page.width, y);
    }
    ctx.stroke();
  }

    ctx.strokeStyle = "rgba(44, 44, 44, 0.12)";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, page.width - 2, page.height - 2);
  ctx.restore();
}

export function drawCad(
  ctx: CanvasRenderingContext2D,
  cad: CadElement,
  box: { x: number; y: number; width: number; height: number },
): void {
  drawCadPrimitives(ctx, cad.primitives, cad.bounds, box, cad);
}

export function drawCadPrimitives(
  ctx: CanvasRenderingContext2D,
  primitives: CadPrimitive[],
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  box: { x: number; y: number; width: number; height: number },
  cad?: CadElement,
): void {
  const bw = Math.max(bounds.maxX - bounds.minX, 1);
  const bh = Math.max(bounds.maxY - bounds.minY, 1);
  const pad = 24;
  const scale = Math.min((box.width - pad * 2) / bw, (box.height - pad * 2) / bh);
  const ox = box.x + (box.width - bw * scale) / 2 - bounds.minX * scale;
  // DXF Y is up; canvas Y is down.
  const oy = box.y + (box.height + bh * scale) / 2 + bounds.minY * scale;

  const tx = (x: number) => ox + x * scale;
  const ty = (y: number) => oy - y * scale;

  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(0.8, 1.1);
  ctx.font = `${Math.max(10, 12)}px sans-serif`;

  for (const prim of primitives) {
    if (cad && !primitiveVisible(cad, prim)) continue;
    ctx.strokeStyle = prim.color;
    ctx.fillStyle = prim.color;
    if (prim.kind === "hatch") {
      ctx.save();
      ctx.globalAlpha = prim.solid ? 0.35 : 0.18;
      for (const loop of prim.loops) {
        if (loop.length < 2) continue;
        ctx.beginPath();
        ctx.moveTo(tx(loop[0].x), ty(loop[0].y));
        for (let i = 1; i < loop.length; i++) ctx.lineTo(tx(loop[i].x), ty(loop[i].y));
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = prim.solid ? 0.55 : 0.4;
        ctx.stroke();
        ctx.globalAlpha = prim.solid ? 0.35 : 0.18;
      }
      ctx.restore();
      continue;
    }
    if (prim.kind === "line") {
      ctx.beginPath();
      ctx.moveTo(tx(prim.x1), ty(prim.y1));
      ctx.lineTo(tx(prim.x2), ty(prim.y2));
      ctx.stroke();
    } else if (prim.kind === "circle") {
      ctx.beginPath();
      ctx.arc(tx(prim.cx), ty(prim.cy), prim.r * scale, 0, Math.PI * 2);
      ctx.stroke();
    } else if (prim.kind === "arc") {
      ctx.beginPath();
      ctx.arc(
        tx(prim.cx),
        ty(prim.cy),
        prim.r * scale,
        -prim.end,
        -prim.start,
        true,
      );
      ctx.stroke();
    } else if (prim.kind === "polyline") {
      if (prim.points.length === 0) continue;
      ctx.beginPath();
      ctx.moveTo(tx(prim.points[0].x), ty(prim.points[0].y));
      for (let i = 1; i < prim.points.length; i++) {
        ctx.lineTo(tx(prim.points[i].x), ty(prim.points[i].y));
      }
      if (prim.closed) ctx.closePath();
      ctx.stroke();
    } else if (prim.kind === "text") {
      ctx.save();
      ctx.translate(tx(prim.x), ty(prim.y));
      ctx.rotate(-prim.rotation);
      ctx.fillText(prim.value, 0, 0);
      ctx.restore();
    }
  }
  ctx.restore();
}

export function cadToPagePoint(
  cadX: number,
  cadY: number,
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  box: { x: number; y: number; width: number; height: number },
): { x: number; y: number } {
  const bw = Math.max(bounds.maxX - bounds.minX, 1);
  const bh = Math.max(bounds.maxY - bounds.minY, 1);
  const pad = 24;
  const scale = Math.min((box.width - pad * 2) / bw, (box.height - pad * 2) / bh);
  const ox = box.x + (box.width - bw * scale) / 2 - bounds.minX * scale;
  const oy = box.y + (box.height + bh * scale) / 2 + bounds.minY * scale;
  return { x: ox + cadX * scale, y: oy - cadY * scale };
}

export function pageToCadPoint(
  x: number,
  y: number,
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  box: { x: number; y: number; width: number; height: number },
): { x: number; y: number } {
  const bw = Math.max(bounds.maxX - bounds.minX, 1);
  const bh = Math.max(bounds.maxY - bounds.minY, 1);
  const pad = 24;
  const scale = Math.min((box.width - pad * 2) / bw, (box.height - pad * 2) / bh);
  const ox = box.x + (box.width - bw * scale) / 2 - bounds.minX * scale;
  const oy = box.y + (box.height + bh * scale) / 2 + bounds.minY * scale;
  return { x: (x - ox) / scale, y: (oy - y) / scale };
}

export function cadScale(
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  box: { x: number; y: number; width: number; height: number },
): number {
  const bw = Math.max(bounds.maxX - bounds.minX, 1);
  const bh = Math.max(bounds.maxY - bounds.minY, 1);
  const pad = 24;
  return Math.min((box.width - pad * 2) / bw, (box.height - pad * 2) / bh);
}

export function drawStrokeOn(
  ctx: CanvasRenderingContext2D,
  points: { x: number; y: number; p?: number }[],
  style: {
    tool: string;
    color: string;
    width: number;
    opacity: number;
  },
  composite: GlobalCompositeOperation = "source-over",
): void {
  if (points.length === 0) return;
  ctx.save();
  ctx.globalCompositeOperation = composite;
  ctx.strokeStyle = style.color;
  ctx.globalAlpha = style.opacity;
  ctx.lineJoin = "round";
  ctx.lineCap = style.tool === "highlighter" ? "butt" : "round";

  const variable = style.tool === "free" || style.tool === "fountain" || style.tool === "pencil";
  if (!variable || points.length < 2) {
    ctx.lineWidth = style.width;
    strokePath(ctx, points);
    ctx.stroke();
    ctx.restore();
    return;
  }

  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    ctx.beginPath();
    ctx.lineWidth = widthForPoint(style.width, b.p ?? a.p, true);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.restore();
}
