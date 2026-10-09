/** Lightweight blur / change scores on a downscaled RGBA frame. */

export function rgbaToGray(rgba: Uint8ClampedArray, width: number, height: number) {
  const gray = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < gray.length; i += 1, p += 4) {
    gray[i] = (rgba[p] * 77 + rgba[p + 1] * 150 + rgba[p + 2] * 29) >> 8;
  }
  return gray;
}

/** Variance of the 4-neighbour Laplacian. Higher means sharper edges. */
export function varianceOfLaplacian(gray: Uint8Array, width: number, height: number) {
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const v = gray[i - width] + gray[i - 1] + gray[i + 1] + gray[i + width] - 4 * gray[i];
      sum += v;
      sumSq += v * v;
      n += 1;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

export function resampleGray(
  src: Uint8Array,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
) {
  const dst = new Uint8Array(dw * dh);
  for (let y = 0; y < dh; y += 1) {
    const sy = Math.min(sh - 1, Math.floor(((y + 0.5) * sh) / dh));
    const row = sy * sw;
    for (let x = 0; x < dw; x += 1) {
      const sx = Math.min(sw - 1, Math.floor(((x + 0.5) * sw) / dw));
      dst[y * dw + x] = src[row + sx];
    }
  }
  return dst;
}

export function meanAbsDiff(a: Uint8Array, b: Uint8Array) {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i += 1) sum += Math.abs(a[i] - b[i]);
  return sum / n;
}

const FAST_CIRCLE: ReadonlyArray<readonly [number, number]> = [
  [0, -3],
  [1, -3],
  [2, -2],
  [3, -1],
  [3, 0],
  [3, 1],
  [2, 2],
  [1, 3],
  [0, 3],
  [-1, 3],
  [-2, 2],
  [-3, 1],
  [-3, 0],
  [-3, -1],
  [-2, -2],
  [-1, -3],
];

export type TextureScore = {
  /** FAST corners per 1000 sampled pixels (segment of 8 on the radius-3 circle). */
  cornersPerK: number;
  /** Mean |dx| + |dy| on the same samples. */
  gradient: number;
};

/**
 * Texture on a downscaled gray frame.
 * A painted wall is sharp but has almost no corners; motion blur also drops
 * the Laplacian, so the selector needs this second score.
 */
export function textureScores(gray: Uint8Array, width: number, height: number): TextureScore {
  const threshold = 20;
  const stride = 2;
  let gradientSum = 0;
  let samples = 0;
  let corners = 0;

  for (let y = 3; y < height - 3; y += stride) {
    for (let x = 3; x < width - 3; x += stride) {
      const i = y * width + x;
      const center = gray[i];
      gradientSum += Math.abs(gray[i + 1] - gray[i - 1]) + Math.abs(gray[i + width] - gray[i - width]);
      samples += 1;
      if (isFastCorner(gray, width, x, y, center, threshold)) corners += 1;
    }
  }

  return {
    cornersPerK: samples === 0 ? 0 : (corners / samples) * 1000,
    gradient: samples === 0 ? 0 : gradientSum / samples,
  };
}

function isFastCorner(
  gray: Uint8Array,
  width: number,
  x: number,
  y: number,
  center: number,
  threshold: number,
) {
  let brighter = 0;
  let darker = 0;
  const circle = new Uint8Array(16);
  for (let k = 0; k < 16; k += 1) {
    const offset = FAST_CIRCLE[k];
    const value = gray[(y + offset[1]) * width + (x + offset[0])];
    circle[k] = value;
    if (value >= center + threshold) brighter += 1;
    else if (value <= center - threshold) darker += 1;
  }
  if (brighter < 8 && darker < 8) return false;

  let runBright = 0;
  let runDark = 0;
  let best = 0;
  for (let k = 0; k < 32; k += 1) {
    const value = circle[k % 16];
    if (value >= center + threshold) {
      runBright += 1;
      runDark = 0;
      if (runBright > best) best = runBright;
    } else if (value <= center - threshold) {
      runDark += 1;
      runBright = 0;
      if (runDark > best) best = runDark;
    } else {
      runBright = 0;
      runDark = 0;
    }
    if (best >= 8) return true;
  }
  return false;
}

export type Analysis = {
  laplacian: number;
  difference: number | null;
  cornersPerK: number;
  gradient: number;
  gray: Uint8Array;
  width: number;
  height: number;
};

export function analyzeRgba(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  previous: { gray: Uint8Array; width: number; height: number } | null,
): Analysis {
  const gray = rgbaToGray(rgba, width, height);
  const laplacian = varianceOfLaplacian(gray, width, height);
  const texture = textureScores(gray, width, height);
  let difference: number | null = null;
  if (previous) {
    const a = resampleGray(gray, width, height, 48, 36);
    const b = resampleGray(previous.gray, previous.width, previous.height, 48, 36);
    difference = meanAbsDiff(a, b);
  }
  return {
    laplacian,
    difference,
    cornersPerK: texture.cornersPerK,
    gradient: texture.gradient,
    gray,
    width,
    height,
  };
}
