import type { PhotoWarning, RejectReason } from "../data/types";

export type { PhotoWarning };

/** Tunable gates for the on-device selector. Intervals stay in one place. */
export const AUTO_INTERVALS = [
  { ms: 1000, label: "1 s" },
  { ms: 2000, label: "2 s" },
] as const;

export const SELECT = {
  similarMax: 11,
  rotationYawMin: 18,
  rotationDiffMax: 34,
  /** Yaw since the last accepted shot above this is too little overlap. */
  yawOverlapMax: 33,
  /** Gyro at the shutter, degrees per second. */
  gyroBlurMin: 40,
  /** Recent linear acceleration, m/s², used when the gyro is quiet. */
  accelBlurMin: 3.2,
  softRatio: 0.42,
  softMedianMin: 35,
  /** Absolute Laplacian still required before calling a steady frame “mossa”. */
  softAbsolute: 20,
  /** Scene change above this is a new view, not the same photo gone soft. */
  sameViewMax: 30,
  textureCornersMax: 1.5,
  textureGradientMax: 8,
  history: 8,
  upElevationMin: 30,
  upElevationMax: 48,
  downElevation: -30,
  upSectors: 12,
  upSectorsNeeded: 6,
} as const;

export type FrameScores = {
  laplacian: number;
  difference: number | null;
  cornersPerK: number;
  gradient: number;
};

export type SelectContext = {
  recentLaplacians: number[];
  yawDeltaDeg: number | null;
  stepDetected: boolean;
  hasPrevious: boolean;
  /** Null when no motion sensor has reported yet. 0 means the phone is steady. */
  gyroDegPerSec: number | null;
  recentAccel: number | null;
};

export type SelectDecision = {
  accept: boolean;
  reason: RejectReason | null;
  warnings: PhotoWarning[];
  threshold: number;
};

export function selectFrame(scores: FrameScores, ctx: SelectContext): SelectDecision {
  const medianLap = median(ctx.recentLaplacians);
  const threshold = medianLap > 0 ? medianLap * SELECT.softRatio : 0;
  const warnings: PhotoWarning[] = [];

  if (isMotionBlur(scores, ctx, medianLap)) {
    return { accept: false, reason: "mosso", warnings, threshold };
  }

  const similar = ctx.hasPrevious && scores.difference != null && scores.difference < SELECT.similarMax;
  if (similar) {
    return { accept: false, reason: "simile", warnings, threshold };
  }

  const lowTexture = scores.cornersPerK < SELECT.textureCornersMax && scores.gradient < SELECT.textureGradientMax;
  if (lowTexture) warnings.push("texture");

  const rotating =
    ctx.yawDeltaDeg != null &&
    ctx.yawDeltaDeg >= SELECT.rotationYawMin &&
    !ctx.stepDetected &&
    scores.difference != null &&
    scores.difference >= SELECT.similarMax &&
    scores.difference < SELECT.rotationDiffMax;
  if (rotating) warnings.push("rotazione");

  if (ctx.hasPrevious && ctx.yawDeltaDeg != null && ctx.yawDeltaDeg > SELECT.yawOverlapMax) {
    warnings.push("sovrapposizione");
  }

  return { accept: true, reason: null, warnings, threshold };
}

function isMotionBlur(scores: FrameScores, ctx: SelectContext, medianLap: number) {
  const relativeSoft =
    ctx.recentLaplacians.length >= 3 &&
    medianLap >= SELECT.softMedianMin &&
    scores.laplacian < medianLap * SELECT.softRatio;
  const motionHigh =
    (ctx.gyroDegPerSec != null && ctx.gyroDegPerSec >= SELECT.gyroBlurMin) ||
    (ctx.recentAccel != null && ctx.recentAccel >= SELECT.accelBlurMin);
  if (motionHigh && (relativeSoft || scores.laplacian < 16)) return true;

  const sensorsUnknown = ctx.gyroDegPerSec == null && ctx.recentAccel == null;
  const sameView = scores.difference == null || scores.difference < SELECT.sameViewMax;
  return sensorsUnknown && relativeSoft && sameView && scores.laplacian < SELECT.softAbsolute;
}

function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function pushLaplacian(history: number[], value: number) {
  const next = history.length >= SELECT.history ? history.slice(1) : history.slice();
  next.push(value);
  return next;
}

export type CoverageSample = { headingDeg: number; elevationDeg: number };

export type PitchBand = "giu" | "orizzonte" | "su";

/** Down / horizon / up 30–45° (with a few degrees of tolerance on the up band). */
export function pitchBand(elevationDeg: number): PitchBand {
  if (elevationDeg >= SELECT.upElevationMin && elevationDeg <= SELECT.upElevationMax) return "su";
  if (elevationDeg <= SELECT.downElevation) return "giu";
  return "orizzonte";
}

export function sectorIndex(headingDeg: number, sectors = SELECT.upSectors) {
  const turn = ((headingDeg % 360) + 360) % 360;
  return Math.floor(turn / (360 / sectors)) % sectors;
}

export function countBandSectors(shots: CoverageSample[], band: PitchBand, sectors = SELECT.upSectors) {
  const seen = new Set<number>();
  for (const shot of shots) {
    if (pitchBand(shot.elevationDeg) === band) seen.add(sectorIndex(shot.headingDeg, sectors));
  }
  return seen.size;
}

export function hintFor(input: {
  decision: SelectDecision;
  shots: CoverageSample[];
  sensors: boolean;
}) {
  if (input.decision.reason === "mosso") return "Troppo mosso";
  if (input.decision.reason === "simile") return "Troppo simile all’ultima";
  if (input.decision.warnings.includes("sovrapposizione")) return "Ruota meno tra uno scatto e l’altro";

  const up = countBandSectors(input.shots, "su");
  if (input.shots.length >= 4 && up < SELECT.upSectorsNeeded) {
    return "Alza il telefono: angoli del soffitto, 30–45°";
  }
  if (input.decision.warnings.includes("texture")) {
    return "Parete liscia: inquadra un bordo o attacca un foglio con texture";
  }
  if (input.decision.warnings.includes("rotazione")) return "Spostati di un passo";

  const horizon = countBandSectors(input.shots, "orizzonte");
  if (input.shots.length >= 6 && horizon >= 3 && horizon < 8) {
    return "Dagli angoli, guarda lungo le pareti";
  }
  if (input.shots.length >= 8 && countBandSectors(input.shots, "giu") === 0) {
    return "Copri il pavimento";
  }
  if (!input.sensors && input.shots.length === 0) {
    return "Sensori di orientamento non disponibili: la mappa resterà vuota";
  }
  if (input.shots.length === 0) return "Scatta, poi spostati di un passo";
  return "Bene, tieni un 60–80% di sovrapposizione";
}
