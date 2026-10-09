import type { CameraDirection, PhotoPose } from "../data/types";

/**
 * Rear-camera look direction in an east / north / up frame.
 * Uses the W3C deviceorientation rotation (ZXY) and the camera axis,
 * which is the back of the phone (−Z in device coordinates).
 */
export function cameraDirection(alpha: number, beta: number, gamma: number): CameraDirection {
  const toRad = Math.PI / 180;
  const x = beta * toRad;
  const y = gamma * toRad;
  const z = alpha * toRad;
  const cX = Math.cos(x);
  const cY = Math.cos(y);
  const cZ = Math.cos(z);
  const sX = Math.sin(x);
  const sY = Math.sin(y);
  const sZ = Math.sin(z);

  const east = -(cY * sZ * sX + cZ * sY);
  const north = -(sZ * sY - cZ * sX * cY);
  const up = -(cX * cY);
  const heading = (Math.atan2(east, north) * 180) / Math.PI;
  const elevation = (Math.atan2(up, Math.hypot(east, north)) * 180) / Math.PI;

  return {
    east,
    north,
    up,
    headingDeg: (heading + 360) % 360,
    elevationDeg: elevation,
  };
}

export function directionFromPose(pose: PhotoPose): CameraDirection | null {
  if (pose.beta == null || pose.gamma == null) return null;
  const direction = cameraDirection(pose.alpha ?? 0, pose.beta, pose.gamma);
  if (pose.absolute && pose.compassHeading != null) {
    return { ...direction, headingDeg: (pose.compassHeading + 360) % 360 };
  }
  return direction;
}

export function angularDistance(a: number, b: number) {
  const delta = Math.abs(a - b) % 360;
  return delta > 180 ? 360 - delta : delta;
}
