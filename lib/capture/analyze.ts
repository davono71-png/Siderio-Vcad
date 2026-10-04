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

export type Analysis = {
  laplacian: number;
  difference: number | null;
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
  let difference: number | null = null;
  if (previous) {
    const a = resampleGray(gray, width, height, 48, 36);
    const b = resampleGray(previous.gray, previous.width, previous.height, 48, 36);
    difference = meanAbsDiff(a, b);
  }
  return { laplacian, difference, gray, width, height };
}
