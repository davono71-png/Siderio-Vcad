import type { CadElement, CadUnitKind, LengthUnit, MeasureElement } from "../models/types";
import { cadScale } from "../drawing/render";
import { formatMm } from "../format";
import { buildTrueQuote, isTrueMeasure } from "./quote";

export type { LengthUnit };

export const UNIT_PRESETS: {
  id: CadUnitKind;
  label: string;
  unitsPerMm: number;
  hint: string;
}[] = [
  { id: "mm", label: "mm", unitsPerMm: 1, hint: "1 unità = 1 mm" },
  { id: "cm", label: "cm", unitsPerMm: 0.1, hint: "1 unità = 1 cm" },
  { id: "m", label: "m", unitsPerMm: 0.001, hint: "1 unità = 1 m" },
];

export function cadScaleFactor(cad: CadElement): number {
  const f = cad.scaleFactor;
  return f && f > 0 ? f : 1;
}

/** Distanza in coordinate pagina → millimetri reali del disegno. */
export function pageDistToMm(
  pageDist: number,
  cad: CadElement,
  pageW: number,
  pageH: number,
): number {
  const pxPerCad = cadScale(cad.bounds, {
    x: 0,
    y: 0,
    width: pageW,
    height: pageH,
  });
  if (pxPerCad <= 0) return 0;
  const cadDist = pageDist / pxPerCad;
  return (cadDist / Math.max(cad.unitsPerMm, 1e-9)) * cadScaleFactor(cad);
}

/** Millimetri reali per una unità di disegno, già col fattore. */
export function mmPerDrawingUnit(cad: CadElement): number {
  return cadScaleFactor(cad) / Math.max(cad.unitsPerMm, 1e-9);
}

export function describeScale(cad: CadElement): string {
  const mm = mmPerDrawingUnit(cad);
  const factor = cadScaleFactor(cad);
  const base = 1 / Math.max(cad.unitsPerMm, 1e-9);
  if (factor === 1 && Math.abs(mm - 1) < 1e-6) return "1 unità = 1 mm";
  if (factor === 1 && Math.abs(mm - 10) < 1e-6) return "1 unità = 1 cm";
  if (factor === 1 && Math.abs(mm - 1000) < 1e-6) return "1 unità = 1 m";
  if (factor !== 1) {
    return `1 unità = ${formatMm(base)} × ${formatFactor(factor)}`;
  }
  return `1 unità = ${formatMm(mm)}`;
}

export function formatFactor(n: number): string {
  if (Number.isInteger(n) && n >= 2) return `1:${n}`;
  return String(n).replace(".", ",");
}

/** Accetta "100", "1:100", "1,5". */
export function parseScaleFactor(raw: string): number | null {
  const t = raw.trim().replace(/\s+/g, "").replace(",", ".");
  if (!t) return null;
  const ratio = /^1:(\d+(?:\.\d+)?)$/.exec(t);
  if (ratio) {
    const n = Number(ratio[1]);
    return n > 0 ? n : null;
  }
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function parseUserLength(raw: string, unit: LengthUnit): number | null {
  const n = Number(raw.trim().replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  if (unit === "m") return n * 1000;
  if (unit === "cm") return n * 10;
  return n;
}

export function unitKindFromUnitsPerMm(unitsPerMm: number): CadUnitKind {
  if (Math.abs(unitsPerMm - 1) < 1e-6) return "mm";
  if (Math.abs(unitsPerMm - 0.1) < 1e-6) return "cm";
  if (Math.abs(unitsPerMm - 0.001) < 1e-6) return "m";
  return "custom";
}

/**
 * Disegno senza $INSUNITS: se il lato è piccolo (casa in metri) si
 * suggerisce il metro, altrimenti i millimetri.
 */
export function suggestUnitKind(bounds: CadElement["bounds"]): CadUnitKind {
  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  if (span > 0 && span <= 200) return "m";
  if (span > 0 && span <= 5000) return "cm";
  return "mm";
}

/** Due punti in pagina + lunghezza vera → unitsPerMm (fattore 1). */
export function calibrateUnitsPerMm(
  pageDist: number,
  knownMm: number,
  cad: CadElement,
  pageW: number,
  pageH: number,
): number {
  const pxPerCad = cadScale(cad.bounds, {
    x: 0,
    y: 0,
    width: pageW,
    height: pageH,
  });
  if (pxPerCad <= 0 || knownMm <= 0) return cad.unitsPerMm;
  const cadDist = pageDist / pxPerCad;
  return cadDist / knownMm;
}

export function rescaleTrueMeasure(
  el: MeasureElement,
  cad: CadElement,
  pageW: number,
  pageH: number,
): MeasureElement {
  if (!isTrueMeasure(el)) return el;
  const q = buildTrueQuote(
    { x: el.x1, y: el.y1, entityId: el.entityA },
    { x: el.x2, y: el.y2, entityId: el.entityB },
    cad,
    pageW,
    pageH,
  );
  return { ...el, mm: q.mm, label: q.label, quoteShape: q.quoteShape };
}
