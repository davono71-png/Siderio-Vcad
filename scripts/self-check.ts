import { analyzeRgba, varianceOfLaplacian } from "../lib/capture/analyze";
import { cameraDirection } from "../lib/capture/direction";
import { hintFor, selectFrame } from "../lib/capture/select";
import { orientedSize, orientedToRaw, readJpegInfo } from "../lib/jpeg";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const sharp = new Uint8Array(32 * 32);
for (let i = 0; i < sharp.length; i += 1) sharp[i] = (i % 32) % 2 === 0 ? 0 : 255;
const blur = new Uint8Array(32 * 32).fill(40);
const sharpScore = varianceOfLaplacian(sharp, 32, 32);
const blurScore = varianceOfLaplacian(blur, 32, 32);
assert(sharpScore > blurScore * 10, `atteso nitido > mosso, ${sharpScore} vs ${blurScore}`);

const rgba = new Uint8ClampedArray(16 * 16 * 4);
for (let i = 0; i < 16 * 16; i += 1) {
  const value = i % 3 === 0 ? 255 : 0;
  rgba[i * 4] = value;
  rgba[i * 4 + 1] = value;
  rgba[i * 4 + 2] = value;
  rgba[i * 4 + 3] = 255;
}
const first = analyzeRgba(rgba, 16, 16, null);
const same = analyzeRgba(rgba, 16, 16, first);
assert(same.difference != null && same.difference < 1, "due frame uguali devono risultare simili");

const blurry = selectFrame(2, null, {
  recentLaplacians: [200, 180, 190],
  yawDeltaDeg: null,
  stepDetected: false,
  hasPrevious: false,
});
assert(!blurry.accept && blurry.reason === "mosso", "varianza bassa deve essere scartata");

const similar = selectFrame(120, 3, {
  recentLaplacians: [100, 110, 130],
  yawDeltaDeg: 2,
  stepDetected: false,
  hasPrevious: true,
});
assert(!similar.accept && similar.reason === "simile", "poca differenza deve essere scartata");

const spin = selectFrame(120, 18, {
  recentLaplacians: [100, 110, 130],
  yawDeltaDeg: 40,
  stepDetected: false,
  hasPrevious: true,
});
assert(spin.accept && spin.flag === "rotazione", "rotazione sul posto va segnalata ma tenuta");

const step = selectFrame(120, 18, {
  recentLaplacians: [100, 110, 130],
  yawDeltaDeg: 40,
  stepDetected: true,
  hasPrevious: true,
});
assert(step.accept && step.flag == null, "un passo non è rotazione sul posto");

const flat = cameraDirection(0, 0, 0);
assert(flat.up < -0.9, "telefono a faccia in su: la posteriore guarda il pavimento");
const upright = cameraDirection(0, 90, 0);
assert(Math.abs(upright.up) < 0.15 && upright.north > 0.9, "telefono verticale: sguardo orizzontale verso nord");

assert(orientedSize(4000, 3000, 6).width === 3000, "EXIF 6 scambia i lati");
const raw = orientedToRaw(0, 0, 100, 200, 6);
assert(Math.abs(raw.x - 0) < 1e-6 && Math.abs(raw.y - 200) < 1e-6, "EXIF 6: angolo alto-sinistra");

const jpeg = jpegWithOrientation(6, 8, 4);
const info = readJpegInfo(jpeg);
assert(info.width === 8 && info.height === 4 && info.orientation === 6, `jpeg letto male: ${JSON.stringify(info)}`);

const hint = hintFor({
  decision: { accept: true, reason: null, flag: null, threshold: 1 },
  shots: [
    { headingDeg: 0, elevationDeg: 0 },
    { headingDeg: 20, elevationDeg: 0 },
    { headingDeg: 40, elevationDeg: 0 },
    { headingDeg: 60, elevationDeg: 0 },
  ],
  sensors: true,
});
assert(hint === "Copri il soffitto", hint);

console.log("self-check ok");

function jpegWithOrientation(orientation: number, width: number, height: number) {
  const exif = new Uint8Array([
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08,
    0x00, 0x01,
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, (orientation >> 8) & 0xff, orientation & 0xff, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
  ]);
  const sof = new Uint8Array([0xff, 0xc0, 0x00, 0x0b, 0x08, (height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff, 0x01, 0x01, 0x11, 0x00]);
  const app1Length = exif.length + 2;
  const bytes = new Uint8Array(2 + 4 + exif.length + sof.length);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[2] = 0xff;
  bytes[3] = 0xe1;
  bytes[4] = (app1Length >> 8) & 0xff;
  bytes[5] = app1Length & 0xff;
  bytes.set(exif, 6);
  bytes.set(sof, 6 + exif.length);
  return bytes.buffer;
}
