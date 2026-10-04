import { angularDistance, directionFromPose } from "./direction";
import type { CameraDirection, PhotoPose } from "../data/types";

type OrientationEvent = DeviceOrientationEvent & { webkitCompassHeading?: number };

/**
 * Tracks orientation and a coarse step detector between accepted shots.
 * Rotation without a step is the "turning in place" signal: photogrammetry
 * needs parallax, so the UI can ask the operator to take a step.
 */
export class MotionTracker {
  pose: PhotoPose | null = null;
  private listening = false;
  private sawAbsolute = false;
  private headingAtAccept: number | null = null;
  private stepSinceAccept = false;
  private lastStepAt = 0;
  private lastMag = 0;
  private ema = 0;
  private accelPeak = 0;
  sensorsSeen = false;

  requestPermission() {
    const pending: Promise<unknown>[] = [];
    const orientation = DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<PermissionState | "granted" | "denied">;
    };
    const motion = DeviceMotionEvent as unknown as {
      requestPermission?: () => Promise<PermissionState | "granted" | "denied">;
    };
    if (typeof orientation.requestPermission === "function") {
      pending.push(orientation.requestPermission().catch(() => "denied"));
    }
    if (typeof motion.requestPermission === "function") {
      pending.push(motion.requestPermission().catch(() => "denied"));
    }
    return Promise.allSettled(pending);
  }

  start() {
    if (this.listening || typeof window === "undefined") return;
    this.listening = true;
    window.addEventListener("deviceorientationabsolute", this.onOrientation, true);
    window.addEventListener("deviceorientation", this.onOrientation, true);
    window.addEventListener("devicemotion", this.onMotion, true);
  }

  stop() {
    if (!this.listening || typeof window === "undefined") return;
    this.listening = false;
    window.removeEventListener("deviceorientationabsolute", this.onOrientation, true);
    window.removeEventListener("deviceorientation", this.onOrientation, true);
    window.removeEventListener("devicemotion", this.onMotion, true);
  }

  markAccepted(direction: CameraDirection | null) {
    this.headingAtAccept = direction?.headingDeg ?? this.currentHeading();
    this.stepSinceAccept = false;
    this.accelPeak = 0;
  }

  snapshot() {
    const direction = this.pose ? directionFromPose(this.pose) : null;
    const heading = direction?.headingDeg ?? this.currentHeading();
    const yawDeltaDeg =
      heading != null && this.headingAtAccept != null
        ? angularDistance(heading, this.headingAtAccept)
        : null;
    return {
      pose: this.pose,
      direction,
      stepDetected: this.stepSinceAccept,
      yawDeltaDeg,
      accelMagnitude: this.accelPeak || null,
      sensors: this.sensorsSeen,
    };
  }

  private currentHeading() {
    if (!this.pose) return null;
    if (this.pose.compassHeading != null) return this.pose.compassHeading;
    return this.pose.alpha;
  }

  private onOrientation = (event: Event) => {
    const orientation = event as OrientationEvent;
    const absoluteEvent = event.type === "deviceorientationabsolute";
    if (absoluteEvent) this.sawAbsolute = true;
    if (!absoluteEvent && this.sawAbsolute && orientation.webkitCompassHeading == null) return;
    if (orientation.alpha == null && orientation.beta == null && orientation.gamma == null) return;

    this.sensorsSeen = true;
    const compass =
      typeof orientation.webkitCompassHeading === "number" ? orientation.webkitCompassHeading : null;
    let screenAngle: number | null = null;
    if (typeof screen !== "undefined" && screen.orientation) {
      screenAngle = screen.orientation.angle;
    } else {
      const legacy = (window as Window & { orientation?: number }).orientation;
      if (typeof legacy === "number") screenAngle = legacy;
    }

    this.pose = {
      alpha: orientation.alpha,
      beta: orientation.beta,
      gamma: orientation.gamma,
      absolute: orientation.absolute === true || absoluteEvent || compass != null,
      compassHeading: compass ?? orientation.alpha,
      screenAngle,
    };
  };

  private onMotion = (event: DeviceMotionEvent) => {
    const linear = event.acceleration;
    const withG = event.accelerationIncludingGravity;
    let magnitude: number | null = null;
    let stepAt = 2.1;

    if (linear && (linear.x != null || linear.y != null || linear.z != null)) {
      magnitude = Math.hypot(linear.x ?? 0, linear.y ?? 0, linear.z ?? 0);
    } else if (withG && (withG.x != null || withG.y != null || withG.z != null)) {
      const raw = Math.hypot(withG.x ?? 0, withG.y ?? 0, withG.z ?? 0);
      this.ema = this.ema === 0 ? raw : this.ema * 0.85 + raw * 0.15;
      magnitude = Math.abs(raw - this.ema);
      stepAt = 1.15;
    }

    if (magnitude == null) return;
    this.sensorsSeen = true;
    this.accelPeak = Math.max(this.accelPeak * 0.9, magnitude);
    const now = performance.now();
    if (magnitude > stepAt && magnitude >= this.lastMag && now - this.lastStepAt > 280) {
      this.stepSinceAccept = true;
      this.lastStepAt = now;
    }
    this.lastMag = magnitude;
  };
}
