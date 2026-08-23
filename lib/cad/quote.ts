import type {
  CadElement,
  LengthUnit,
  MeasureElement,
  MeasureKind,
  Point,
  QuoteShape,
} from "../models/types";
import { cadScale, cadToPagePoint } from "../drawing/render";
import { formatLength } from "../format";

/** Quota vera solo se entrambi gli estremi agganciano un'entità DXF. */
export function measureKindFromEnds(
  entityA?: string,
  entityB?: string,
): MeasureKind {
  return entityA && entityB ? "true" : "inserted";
}

export function isTrueMeasure(el: MeasureElement): boolean {
  if (el.kind) return el.kind === "true";
  return Boolean(el.entityA && el.entityB);
}

export function formatTrueLabel(
  mm: number,
  unit: LengthUnit = "m",
  shape: QuoteShape = "length",
): string {
  const n = formatLength(mm, unit);
  if (shape === "radius") return `R ${n}`;
  if (shape === "diameter") return `Ø ${n}`;
  return n;
}

export function trueMeasureFields(
  mm: number,
  entityA?: string,
  entityB?: string,
  unit: LengthUnit = "m",
  shape: QuoteShape = "length",
): Pick<
  MeasureElement,
  "kind" | "mm" | "label" | "entityA" | "entityB" | "quoteShape"
> {
  return {
    kind: "true",
    mm,
    label: formatTrueLabel(mm, unit, shape),
    entityA,
    entityB,
    quoteShape: shape,
  };
}

export function insertedMeasureFields(
  label: string,
): Pick<MeasureElement, "kind" | "mm" | "label"> {
  return { kind: "inserted", mm: 0, label };
}

/**
 * Riscrive una quota. Sulle vere l'originale resta in `label` e il nuovo
 * valore va in `note` (sotto, tra parentesi). Sulle inserite si cambia solo
 * il testo utente.
 */
export function rewriteMeasure(el: MeasureElement, raw: string): MeasureElement {
  const label = raw.trim();
  if (!label) return el;
  if (isTrueMeasure(el)) return { ...el, note: label };
  return { ...el, label };
}

function pageBox(pageW: number, pageH: number) {
  return { x: 0, y: 0, width: pageW, height: pageH };
}

function cadLenToMm(cadDist: number, cad: CadElement): number {
  const factor = cad.scaleFactor && cad.scaleFactor > 0 ? cad.scaleFactor : 1;
  return (cadDist / Math.max(cad.unitsPerMm, 1e-9)) * factor;
}

/** Centro+bordo → raggio; due diametralmente opposti → diametro. */
export function inferQuoteShape(
  a: Point & { entityId?: string },
  b: Point & { entityId?: string },
  cad: CadElement,
  pageW: number,
  pageH: number,
): QuoteShape {
  if (!a.entityId || a.entityId !== b.entityId) return "length";
  const prim = cad.primitives.find((p) => p.id === a.entityId);
  if (!prim || (prim.kind !== "circle" && prim.kind !== "arc")) return "length";
  const box = pageBox(pageW, pageH);
  const center = cadToPagePoint(prim.cx, prim.cy, cad.bounds, box);
  const rPage = prim.r * cadScale(cad.bounds, box);
  if (rPage <= 0) return "length";
  const tol = Math.max(4, rPage * 0.08);
  const da = Math.hypot(a.x - center.x, a.y - center.y);
  const db = Math.hypot(b.x - center.x, b.y - center.y);
  const aCenter = da < tol;
  const bCenter = db < tol;
  const aRim = Math.abs(da - rPage) < tol;
  const bRim = Math.abs(db - rPage) < tol;
  if ((aCenter && bRim) || (bCenter && aRim)) return "radius";
  if (aRim && bRim && prim.kind === "circle") {
    const chord = Math.hypot(b.x - a.x, b.y - a.y);
    if (Math.abs(chord - 2 * rPage) < tol * 1.5) return "diameter";
  }
  return "length";
}

export function trueQuoteMm(
  a: Point & { entityId?: string },
  b: Point & { entityId?: string },
  cad: CadElement,
  pageW: number,
  pageH: number,
  shape: QuoteShape,
): number {
  if (shape === "radius" || shape === "diameter") {
    const id = a.entityId ?? b.entityId;
    const prim = cad.primitives.find((p) => p.id === id);
    if (prim && (prim.kind === "circle" || prim.kind === "arc")) {
      const rMm = cadLenToMm(prim.r, cad);
      return shape === "diameter" ? rMm * 2 : rMm;
    }
  }
  const pxPerCad = cadScale(cad.bounds, pageBox(pageW, pageH));
  if (pxPerCad <= 0) return 0;
  const cadDist = Math.hypot(b.x - a.x, b.y - a.y) / pxPerCad;
  return cadLenToMm(cadDist, cad);
}

export function buildTrueQuote(
  a: Point & { entityId?: string },
  b: Point & { entityId?: string },
  cad: CadElement,
  pageW: number,
  pageH: number,
): Pick<
  MeasureElement,
  "kind" | "mm" | "label" | "entityA" | "entityB" | "quoteShape"
> {
  const shape = inferQuoteShape(a, b, cad, pageW, pageH);
  const mm = trueQuoteMm(a, b, cad, pageW, pageH, shape);
  return trueMeasureFields(
    mm,
    a.entityId,
    b.entityId,
    cad.quoteUnit ?? "m",
    shape,
  );
}
