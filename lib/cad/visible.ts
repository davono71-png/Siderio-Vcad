import type { CadElement, CadPrimitive } from "../models/types";

export function primitiveVisible(cad: CadElement, p: CadPrimitive): boolean {
  if (p.kind === "hatch" && cad.hideHatches) return false;
  const layer = cad.layers?.find((l) => l.name === p.layer);
  if (layer && !layer.visible) return false;
  return true;
}

export function visiblePrimitives(cad: CadElement): CadPrimitive[] {
  return cad.primitives.filter((p) => primitiveVisible(cad, p));
}
