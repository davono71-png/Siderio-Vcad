import { accessState, codesMatch, signSession, verifySession } from "../lib/auth/session";
import { analyzeRgba, textureScores, varianceOfLaplacian } from "../lib/capture/analyze";
import { cameraDirection } from "../lib/capture/direction";
import { hintFor, pitchBand, selectFrame, type SelectContext } from "../lib/capture/select";
import { duplicateMeasurement } from "../lib/measure/checks";
import { editMillimetres, parsePointName, pointNameFromLetter, withLetter, withNextSuffix } from "../lib/measure/entry";
import { wallSolids } from "../lib/results/scene";
import { parseSurveyDocument, type SurveyDocument } from "../lib/sync/document";
import { mergeDocuments } from "../lib/sync/merge";
import { commitSurvey, readSurvey } from "../lib/sync/store";
import { checkPresign, photoObjectKey } from "../lib/storage/keys";
import { orientedSize, orientedToRaw, readJpegInfo } from "../lib/jpeg";
import type { Measurement } from "../lib/data/types";

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

const steady: SelectContext = {
  recentLaplacians: [200, 180, 190],
  yawDeltaDeg: null,
  stepDetected: false,
  hasPrevious: false,
  gyroDegPerSec: null,
  recentAccel: null,
};

const blurry = selectFrame(
  { laplacian: 2, difference: null, cornersPerK: 4, gradient: 12 },
  steady,
);
assert(!blurry.accept && blurry.reason === "mosso", "stesso inquadratura molto più morbida, senza sensori, è mossa");

const wall = selectFrame(
  { laplacian: 12, difference: 40, cornersPerK: 0.2, gradient: 3 },
  {
    ...steady,
    hasPrevious: true,
    yawDeltaDeg: 12,
    stepDetected: true,
    gyroDegPerSec: 3,
    recentAccel: 0.2,
  },
);
assert(wall.accept && wall.reason == null && wall.warnings.includes("texture"), "parete liscia e ferma va tenuta con avviso");

const shaken = selectFrame(
  { laplacian: 8, difference: 18, cornersPerK: 0.4, gradient: 3 },
  {
    ...steady,
    hasPrevious: true,
    yawDeltaDeg: 6,
    gyroDegPerSec: 90,
    recentAccel: 0.4,
  },
);
assert(!shaken.accept && shaken.reason === "mosso", "gyro alto e nitidezza crollata è mossa");

const similar = selectFrame(
  { laplacian: 120, difference: 3, cornersPerK: 8, gradient: 20 },
  {
    recentLaplacians: [100, 110, 130],
    yawDeltaDeg: 2,
    stepDetected: false,
    hasPrevious: true,
    gyroDegPerSec: 1,
    recentAccel: 0.1,
  },
);
assert(!similar.accept && similar.reason === "simile", "poca differenza deve essere scartata");

const spin = selectFrame(
  { laplacian: 120, difference: 18, cornersPerK: 8, gradient: 20 },
  {
    recentLaplacians: [100, 110, 130],
    yawDeltaDeg: 25,
    stepDetected: false,
    hasPrevious: true,
    gyroDegPerSec: 2,
    recentAccel: 0.2,
  },
);
assert(spin.accept && spin.warnings.includes("rotazione"), "rotazione sul posto va segnalata ma tenuta");

const wide = selectFrame(
  { laplacian: 120, difference: 22, cornersPerK: 8, gradient: 20 },
  {
    recentLaplacians: [100, 110, 130],
    yawDeltaDeg: 40,
    stepDetected: true,
    hasPrevious: true,
    gyroDegPerSec: 2,
    recentAccel: 0.2,
  },
);
assert(wide.accept && wide.warnings.includes("sovrapposizione") && !wide.warnings.includes("rotazione"), "troppo yaw avvisa, un passo non è rotazione");

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
  decision: { accept: true, reason: null, warnings: [], threshold: 1 },
  shots: [
    { headingDeg: 0, elevationDeg: 0 },
    { headingDeg: 20, elevationDeg: 0 },
    { headingDeg: 40, elevationDeg: 0 },
    { headingDeg: 60, elevationDeg: 0 },
  ],
  sensors: true,
});
assert(hint.includes("soffitto"), hint);
assert(pitchBand(35) === "su" && pitchBand(0) === "orizzonte" && pitchBand(-40) === "giu", "fasce di pitch");

const plain = new Uint8Array(64 * 64).fill(128);
const checks = new Uint8Array(64 * 64);
for (let y = 0; y < 64; y += 1) {
  for (let x = 0; x < 64; x += 1) {
    checks[y * 64 + x] = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0 ? 0 : 255;
  }
}
const flatTexture = textureScores(plain, 64, 64);
const busyTexture = textureScores(checks, 64, 64);
assert(busyTexture.cornersPerK > flatTexture.cornersPerK + 5, `texture ${busyTexture.cornersPerK} vs ${flatTexture.cornersPerK}`);
assert(busyTexture.gradient > flatTexture.gradient + 20, `gradiente ${busyTexture.gradient} vs ${flatTexture.gradient}`);

const pair: Measurement = {
  id: "1",
  projectId: "p",
  pointA: "a",
  pointB: "b",
  distanceMm: 625,
  note: "",
  createdAt: "",
};
assert(duplicateMeasurement([pair], "b", "a")?.id === "1", "coppia di punti duplicata");
assert(duplicateMeasurement([pair], "a", "c") == null, "coppia diversa");

assert(editMillimetres("", "9") === "9", "prima cifra");
assert(editMillimetres("0", "5") === "5", "niente zero iniziale");
assert(editMillimetres("", "comma") === "0,", "virgola iniziale");
assert(editMillimetres("930", "comma") === "930,", "virgola");
assert(editMillimetres("930,", "5") === "930,5", "decimale");
assert(editMillimetres("930,5", "1") === "930,5", "un solo decimale");
assert(editMillimetres("930,5", "comma") === "930,5", "una sola virgola");
assert(editMillimetres("930", "back") === "93", "backspace");
assert(editMillimetres("12", "clear") === "", "azzera");
assert(editMillimetres("123456", "7") === "123456", "sei cifre intere");
assert(pointNameFromLetter("b", 0) === "B", "lettera");
assert(pointNameFromLetter("A", 2) === "A2", "suffisso");
assert(withLetter("A2", "A") === "A2", "stessa lettera tiene il numero");
assert(withLetter("A2", "B") === "B", "altra lettera senza numero");
assert(withNextSuffix("C") === "C1", "più aggiunge 1");
assert(withNextSuffix("C1") === "C2", "più incrementa");
const parsed = parsePointName("a12");
assert(parsed?.letter === "A" && parsed.suffix === 12, "nome con numero");

const key = photoObjectKey("11111111-1111-4111-8111-111111111111", 3, "22222222-2222-4222-8222-222222222222");
assert(checkPresign({ op: "put", key, contentType: "image/jpeg", contentLength: 1000 }).ok, key);
assert(!checkPresign({ op: "put", key: "rilievi/altro.jpg", contentType: "image/jpeg", contentLength: 1000 }).ok, "chiave libera rifiutata");
assert(!checkPresign({ op: "put", key, contentType: "text/plain", contentLength: 1000 }).ok, "tipo rifiutato");

const office = wallSolids({
  mode: "facciata",
  planes: [
    {
      role: "background",
      step: "walls",
      widthMm: 7846.3,
      heightMm: 2884.9,
      thicknessMm: 150,
      originMm: [0, 0, 0],
      axisU: [1, 0, 0],
      axisV: [0, 1, 0],
      normal: [0, 0, 1],
    },
    {
      role: "ritorno",
      step: "walls",
      widthMm: 2466.9,
      heightMm: 2884.9,
      thicknessMm: 150,
      originMm: [8071.6, 0, 160.4],
      axisU: [0, 0, 1],
      axisV: [0, 1, 0],
      normal: [-1, 0, 0],
    },
  ],
  openings: [{ kind: "door", x0: 2853.2, x1: 3962.8, y0: 0, y1: 2064.1, widthMm: 1109.6, heightMm: 2064.1 }],
});
assert(office.length === 2, "parete e ritorno");
assert(Math.abs(office[0].width - 7.8463) < 0.001, "lunghezza in metri");
assert(office[0].holes.length === 1, "porta ritagliata");
assert(office[0].holes[0].v0 > 0 && office[0].holes[0].v0 < 0.01, "la porta non tocca il bordo della mesh");
assert(office[1].holes.length === 0, "il ritorno non ha aperture");

const phone = surveyDoc({
  revision: 1,
  points: [surveyPoint("p1", "A", "2026-10-09T10:00:00.000Z", [{ photoId: "f1", x: 10, y: 20, rawX: 10, rawY: 20 }])],
  measurements: [],
});
const desk = surveyDoc({
  revision: 1,
  points: [surveyPoint("p2", "B", "2026-10-09T10:05:00.000Z", [{ photoId: "f1", x: 30, y: 40, rawX: 30, rawY: 40 }])],
  measurements: [surveyMeasure("m1", "p1", "p2", 930, "2026-10-09T10:06:00.000Z")],
});
const merged = mergeDocuments(phone, desk);
assert(merged.points.map((point) => point.id).sort().join() === "p1,p2", "due dispositivi tengono entrambi i punti");
assert(merged.measurements.length === 1 && merged.measurements[0]?.distanceMm === 930, "la quota del computer resta");
assert(!merged.points.some((point) => "deletedAt" in point), "i punti vivi non portano il tombstone");

const renamed = surveyDoc({
  points: [surveyPoint("p1", "A1", "2026-10-09T11:00:00.000Z", [{ photoId: "f1", x: 10, y: 20, rawX: 10, rawY: 20 }])],
});
const observed = surveyDoc({
  points: [surveyPoint("p1", "A", "2026-10-09T10:30:00.000Z", [{ photoId: "f2", x: 4, y: 5, rawX: 4, rawY: 5 }])],
});
const bothViews = mergeDocuments(renamed, observed);
const kept = bothViews.points[0];
assert(kept?.label === "A1", "il nome più recente vince");
assert(kept?.observations.length === 2, "le osservazioni su foto diverse restano entrambe");

const deleted = mergeDocuments(phone, {
  ...phone,
  points: [],
  tombstones: { photos: [], points: [{ id: "p1", deletedAt: "2026-10-09T12:00:00.000Z" }], measurements: [] },
});
assert(deleted.points.length === 0 && deleted.tombstones.points[0]?.id === "p1", "un tombstone più recente toglie il punto");

const resurrected = mergeDocuments(deleted, surveyDoc({
  points: [surveyPoint("p1", "A", "2026-10-09T13:00:00.000Z", [{ photoId: "f1", x: 1, y: 1, rawX: 1, rawY: 1 }])],
}));
assert(resurrected.points.length === 1 && resurrected.tombstones.points.length === 0, "una modifica successiva ripristina il punto");

const legacy = parseSurveyDocument({
  version: 2,
  project: { id: "8ad293ef-50fe-4329-a7dd-8e3eb0380b28", name: "Ufficio", kind: "facciata", updatedAt: "2026-10-01T00:00:00.000Z", createdAt: "2026-10-01T00:00:00.000Z" },
  points: [{ id: "p9", label: "A", observations: [{ photoId: "f1", x: 2, y: 3, rawX: 2, rawY: 3 }] }],
  measurements: [{ id: "m9", pointA: "p9", pointB: "p9", distanceMm: 1000, createdAt: "2026-10-01T00:00:00.000Z" }],
});
assert(legacy?.revision === 0 && legacy.points[0]?.updatedAt === "2026-10-01T00:00:00.000Z", "un project.json vecchio riceve revisione 0 e la data del rilievo");

const previousCode = process.env.APP_ACCESS_CODE;
const previousSecret = process.env.APP_SESSION_SECRET;
process.env.APP_ACCESS_CODE = "segreto-test";
delete process.env.APP_SESSION_SECRET;
assert(accessState(undefined) === "unauthorized", "senza cookie il rilievo è chiuso");
assert(!codesMatch("altro"), "un codice diverso non entra");
assert(codesMatch("segreto-test"), "il codice giusto entra");
const token = signSession();
assert(verifySession(token), "il cookie firmato è valido");
delete process.env.APP_ACCESS_CODE;
assert(accessState(token) === "unconfigured", "senza APP_ACCESS_CODE si chiude");
if (previousCode == null) delete process.env.APP_ACCESS_CODE;
else process.env.APP_ACCESS_CODE = previousCode;
if (previousSecret == null) delete process.env.APP_SESSION_SECRET;
else process.env.APP_SESSION_SECRET = previousSecret;

process.env.SIDERO_SYNC_MEMORY = "1";
void (async () => {
  const savedFirst = await commitSurvey(phone.project.id, 0, phone);
  const savedSecond = await commitSurvey(phone.project.id, 0, desk);
  assert(!savedFirst.conflict && savedFirst.document.revision === 1, "il primo salvataggio prende la revisione 1");
  assert(savedSecond.conflict && savedSecond.document?.revision === 1, "la stessa revisione va in conflitto");
  if (!savedSecond.conflict || !savedSecond.document) throw new Error("conflitto atteso");
  const retried = mergeDocuments(desk, savedSecond.document);
  const third = await commitSurvey(phone.project.id, savedSecond.document.revision, retried);
  assert(!third.conflict, "dopo il merge il salvataggio riprova");
  const stored = await readSurvey(phone.project.id);
  assert(stored?.points.length === 2 && stored.measurements.some((item) => item.id === "m1"), "il conflitto unisce punti e quota");
  delete process.env.SIDERO_SYNC_MEMORY;
  console.log("self-check ok");
})();

function surveyPoint(
  id: string,
  label: string,
  updatedAt: string,
  observations: SurveyDocument["points"][number]["observations"],
): SurveyDocument["points"][number] {
  return { id, label, updatedAt, observations };
}

function surveyMeasure(id: string, pointA: string, pointB: string, distanceMm: number, updatedAt: string): SurveyDocument["measurements"][number] {
  return { id, pointA, pointB, labelA: null, labelB: null, distanceMm, note: "", createdAt: updatedAt, updatedAt };
}

function surveyDoc(partial: Partial<SurveyDocument> & { points?: SurveyDocument["points"]; measurements?: SurveyDocument["measurements"] }): SurveyDocument {
  return {
    version: 2,
    app: "Siderio Vcad",
    exportedAt: "2026-10-09T10:00:00.000Z",
    coordinateSpace: "test",
    revision: partial.revision ?? 0,
    updatedAt: "2026-10-09T10:00:00.000Z",
    deletedAt: null,
    photos: partial.photos ?? [],
    points: partial.points ?? [],
    measurements: partial.measurements ?? [],
    tombstones: partial.tombstones ?? { photos: [], points: [], measurements: [] },
    project: partial.project ?? {
      id: "8ad293ef-50fe-4329-a7dd-8e3eb0380b28",
      name: "Ufficio",
      kind: "facciata",
      notes: "",
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-09T10:00:00.000Z",
      job: { status: "non_inviato", message: "", progress: null, updatedAt: "2026-10-09T10:00:00.000Z" },
      scaleChecklist: { lunghezza: false, larghezza: false, altezza: false },
    },
  };
}

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
