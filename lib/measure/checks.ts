import type { CameraDirection, Measurement, NotablePoint, PhotoMeta } from "../data/types";

export function samePointPair(measurement: Measurement, pointA: string, pointB: string) {
  return (
    (measurement.pointA === pointA && measurement.pointB === pointB) ||
    (measurement.pointA === pointB && measurement.pointB === pointA)
  );
}

export function duplicateMeasurement(measurements: Measurement[], pointA: string, pointB: string) {
  return measurements.find((item) => samePointPair(item, pointA, pointB)) ?? null;
}

function lookAngleDeg(a: CameraDirection, b: CameraDirection) {
  const dot = a.east * b.east + a.north * b.north + a.up * b.up;
  const clamped = Math.min(1, Math.max(-1, dot));
  return (Math.acos(clamped) * 180) / Math.PI;
}

export type CloseView = { angleDeg: number };

/** Pairs of observations whose cameras look less than `minDeg` apart. */
export function closeViews(point: NotablePoint, photos: Map<string, PhotoMeta>, minDeg = 15): CloseView[] {
  const directions: CameraDirection[] = [];
  for (const observation of point.observations) {
    const direction = photos.get(observation.photoId)?.direction;
    if (direction) directions.push(direction);
  }
  const close: CloseView[] = [];
  for (let i = 0; i < directions.length; i += 1) {
    for (let j = i + 1; j < directions.length; j += 1) {
      const angleDeg = lookAngleDeg(directions[i], directions[j]);
      if (angleDeg < minDeg) close.push({ angleDeg });
    }
  }
  return close;
}
