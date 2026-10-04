import type { RejectReason } from "../data/types";

/** Tunable gates for the on-device selector. Intervals stay in one place. */
export const AUTO_INTERVALS = [
  { ms: 1000, label: "1 s" },
  { ms: 2000, label: "2 s" },
] as const;

export const SELECT = {
  similarMax: 11,
  rotationYawMin: 18,
  rotationDiffMax: 34,
  blurAbsolute: 8,
  blurPeakMin: 45,
  blurRatio: 0.38,
  blurCap: 90,
  history: 8,
} as const;

export type SelectContext = {
  recentLaplacians: number[];
  yawDeltaDeg: number | null;
  stepDetected: boolean;
  hasPrevious: boolean;
};

export type SelectDecision = {
  accept: boolean;
  reason: RejectReason | null;
  flag: "rotazione" | null;
  threshold: number;
};

export function selectFrame(
  laplacian: number,
  difference: number | null,
  ctx: SelectContext,
): SelectDecision {
  const peak = ctx.recentLaplacians.reduce((max, value) => Math.max(max, value), 0);
  const adaptive = ctx.recentLaplacians.length >= 3 && peak > SELECT.blurPeakMin;
  const threshold = adaptive ? peak * SELECT.blurRatio : SELECT.blurAbsolute;
  const blurry =
    laplacian < SELECT.blurAbsolute ||
    (adaptive && laplacian < peak * SELECT.blurRatio && laplacian < SELECT.blurCap);

  if (blurry) {
    return { accept: false, reason: "mosso", flag: null, threshold };
  }

  const similar = ctx.hasPrevious && difference != null && difference < SELECT.similarMax;
  if (similar) {
    return { accept: false, reason: "simile", flag: null, threshold };
  }

  const rotating =
    ctx.yawDeltaDeg != null &&
    ctx.yawDeltaDeg >= SELECT.rotationYawMin &&
    !ctx.stepDetected &&
    difference != null &&
    difference >= SELECT.similarMax &&
    difference < SELECT.rotationDiffMax;

  return {
    accept: true,
    reason: null,
    flag: rotating ? "rotazione" : null,
    threshold,
  };
}

export function pushLaplacian(history: number[], value: number) {
  const next = history.length >= SELECT.history ? history.slice(1) : history.slice();
  next.push(value);
  return next;
}

export type CoverageSample = { headingDeg: number; elevationDeg: number };

export function elevationBand(elevationDeg: number): "basso" | "medio" | "alto" {
  if (elevationDeg > 22) return "alto";
  if (elevationDeg < -22) return "basso";
  return "medio";
}

export function hintFor(input: {
  decision: SelectDecision;
  shots: CoverageSample[];
  sensors: boolean;
}) {
  if (input.decision.reason === "mosso") return "Troppo mosso";
  if (input.decision.reason === "simile") return "Troppo simile all’ultima";
  if (input.decision.flag === "rotazione") return "Spostati di un passo";
  const acceptedShots = input.shots.length;
  if (acceptedShots >= 4 && !input.shots.some((shot) => elevationBand(shot.elevationDeg) === "alto")) {
    return "Copri il soffitto";
  }
  if (acceptedShots >= 4 && !input.shots.some((shot) => elevationBand(shot.elevationDeg) === "basso")) {
    return "Copri il pavimento";
  }
  if (!input.sensors && acceptedShots === 0) {
    return "Sensori di orientamento non disponibili: la mappa resterà vuota";
  }
  if (acceptedShots === 0) return "Scatta, poi spostati di un passo";
  return "Bene, tieni un 60–80% di sovrapposizione";
}
