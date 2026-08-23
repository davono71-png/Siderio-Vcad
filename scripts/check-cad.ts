import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDxf } from "../lib/cad/parse";
import {
  calibrateUnitsPerMm,
  pageDistToMm,
  parseScaleFactor,
  parseUserLength,
  rescaleTrueMeasure,
  suggestUnitKind,
} from "../lib/cad/units";
import { cadSnapPoints, snapCad } from "../lib/cad/snap";
import { visiblePrimitives } from "../lib/cad/visible";
import {
  buildTrueQuote,
  insertedMeasureFields,
  isTrueMeasure,
  measureKindFromEnds,
  rewriteMeasure,
  trueMeasureFields,
} from "../lib/cad/quote";
import { formatLength, formatMm } from "../lib/format";
import { signedPerpOffset } from "../lib/drawing/geometry";
import type { CadElement, MeasureElement } from "../lib/models/types";
import { createPage, DEFAULT_PEN_PREFS } from "../lib/models/defaults";
import { DrawingEngine } from "../lib/drawing/engine";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const text = readFileSync(join(root, "public/samples/piano-terra.dxf"), "utf8");
const parsed = parseDxf(text);

const fail: string[] = [];
function assert(cond: unknown, msg: string) {
  if (!cond) fail.push(msg);
}

const names = new Set(parsed.layers.map((l) => l.name));
for (const n of ["MURI", "PILASTRO", "INTERNI", "QUOTE", "CAMPITURA", "INFISSI"]) {
  assert(names.has(n), `manca layer ${n}`);
}

const kinds = parsed.primitives.reduce<Record<string, number>>((acc, p) => {
  acc[p.kind] = (acc[p.kind] ?? 0) + 1;
  return acc;
}, {});

assert((kinds.line ?? 0) >= 6, `attese >= 6 linee (muri + 2 porte), trovate ${kinds.line ?? 0}`);
assert((kinds.circle ?? 0) === 1, `cerchio pilastro: ${kinds.circle ?? 0}`);
assert((kinds.hatch ?? 0) === 1, `hatch campitura: ${kinds.hatch ?? 0}`);
assert((kinds.polyline ?? 0) >= 1, `polilinea interni: ${kinds.polyline ?? 0}`);
assert(Math.abs(parsed.unitsPerMm - 1) < 1e-6, `unità mm, unitsPerMm=${parsed.unitsPerMm}`);
assert(parsed.unitsFromFile, "piano-terra deve avere $INSUNITS");

const cad: CadElement = {
  type: "cad",
  id: "t",
  assetId: "a",
  fileName: "piano-terra.dxf",
  sourceFormat: "dxf",
  primitives: parsed.primitives,
  layers: parsed.layers,
  hideHatches: false,
  bounds: parsed.bounds,
  unitsPerMm: parsed.unitsPerMm,
  unitsFromFile: parsed.unitsFromFile,
  quoteUnit: "m",
  locked: true,
};

const box = { x: 0, y: 0, width: 1240, height: 1754 };
const snaps = cadSnapPoints(cad, box);
assert(snaps.length > 0, "nessun punto di aggancio");
assert(
  snaps.every((s) => s.entityId),
  "snap senza entityId",
);

const muro = parsed.primitives.find(
  (p) => p.kind === "line" && p.layer === "MURI" && p.x1 === 0 && p.y1 === 0 && p.x2 === 10000,
);
assert(muro && muro.kind === "line", "muro 10m non trovato");
if (muro && muro.kind === "line") {
  const ends = snaps.filter((s) => s.entityId === muro.id && s.kind === "end");
  assert(ends.length >= 2, `snap estremi muro: ${ends.length}`);
  if (ends.length >= 2) {
    const pageDist = Math.hypot(ends[1].x - ends[0].x, ends[1].y - ends[0].y);
    const mm = pageDistToMm(pageDist, cad, box.width, box.height);
    assert(Math.abs(mm - 10000) < 1, `quota automatica sul muro 10m: ${mm} mm`);
  }
}

cad.hideHatches = true;
const snapsHidden = cadSnapPoints(cad, box);
assert(
  !snapsHidden.some((s) =>
    parsed.primitives.find((p) => p.id === s.entityId && p.kind === "hatch"),
  ),
  "hatch ancora negli snap con campiture spente",
);
assert(
  !visiblePrimitives(cad).some((p) => p.kind === "hatch"),
  "hatch ancora visibile con campiture spente",
);
cad.hideHatches = false;

const muriLayer = cad.layers?.find((l) => l.name === "MURI");
assert(muriLayer, "layer MURI assente");
if (muriLayer) muriLayer.visible = false;
assert(
  !visiblePrimitives(cad).some((p) => p.layer === "MURI"),
  "layer MURI spento ancora visibile",
);
assert(
  !cadSnapPoints(cad, box).some((s) =>
    parsed.primitives.find((p) => p.id === s.entityId && p.layer === "MURI"),
  ),
  "layer MURI spento ancora negli snap",
);
if (muriLayer) muriLayer.visible = true;

const circle = parsed.primitives.find((p) => p.kind === "circle");
assert(circle && circle.kind === "circle" && Math.abs(circle.r - 300) < 1e-6, "pilastro r=300");
if (circle && circle.kind === "circle") {
  const csnaps = snaps.filter((s) => s.entityId === circle.id);
  assert(csnaps.some((s) => s.kind === "center"), "manca snap centro cerchio");
  assert(csnaps.filter((s) => s.kind === "quad").length === 4, `quadranti: ${csnaps.filter((s) => s.kind === "quad").length}`);
  const centro = csnaps.find((s) => s.kind === "center");
  const quad = csnaps.find((s) => s.kind === "quad");
  if (centro && quad) {
    const raggio = buildTrueQuote(centro, quad, cad, box.width, box.height);
    assert(raggio.quoteShape === "radius", `atteso raggio, trovato ${raggio.quoteShape}`);
    assert(Math.abs(raggio.mm - 300) < 1, `raggio pilastro: ${raggio.mm} mm`);
    assert(raggio.label.startsWith("R "), `etichetta raggio: ${raggio.label}`);
  }
  const quads = csnaps.filter((s) => s.kind === "quad");
  if (quads.length >= 2) {
    let far = quads[1];
    let best = 0;
    for (const q of quads) {
      const d = Math.hypot(q.x - quads[0].x, q.y - quads[0].y);
      if (d > best) {
        best = d;
        far = q;
      }
    }
    const dia = buildTrueQuote(quads[0], far, cad, box.width, box.height);
    assert(dia.quoteShape === "diameter", `atteso diametro, trovato ${dia.quoteShape}`);
    assert(Math.abs(dia.mm - 600) < 1, `diametro pilastro: ${dia.mm} mm`);
    assert(dia.label.includes("Ø") || dia.label.includes("ø"), `etichetta diametro: ${dia.label}`);
  }
  const outside = {
    x: centro ? centro.x + 55 : 0,
    y: centro ? centro.y + 55 : 0,
  };
  const rim = snapCad(outside.x, outside.y, cad, box, 50);
  assert(rim && rim.kind === "rim" && rim.entityId === circle.id, `snap bordo cerchio: ${rim?.kind}`);
}

cad.quoteUnit = "cm";
if (muro && muro.kind === "line") {
  const ends = snaps.filter((s) => s.entityId === muro.id && s.kind === "end");
  if (ends.length >= 2) {
    const mm = pageDistToMm(
      Math.hypot(ends[1].x - ends[0].x, ends[1].y - ends[0].y),
      cad,
      box.width,
      box.height,
    );
    assert(Math.abs(mm - 10000) < 1, `quoteUnit non deve cambiare i mm: ${mm}`);
    const inCm = rescaleTrueMeasure(
      {
        type: "measure",
        id: "qcm",
        x1: ends[0].x,
        y1: ends[0].y,
        x2: ends[1].x,
        y2: ends[1].y,
        kind: "true",
        mm: 10000,
        label: formatMm(10000),
        entityA: muro.id,
        entityB: muro.id,
      },
      cad,
      box.width,
      box.height,
    );
    assert(inCm.label === "1000.0 cm", `etichetta in cm: ${inCm.label}`);
    assert(Math.abs(inCm.mm - 10000) < 1, `mm invariati con quoteUnit cm: ${inCm.mm}`);
  }
}
cad.quoteUnit = "m";

assert(measureKindFromEnds() === "inserted", "senza CAD/snap la quota non è vera");
assert(measureKindFromEnds("e1") === "inserted", "un solo aggancio non è quota vera");
assert(measureKindFromEnds("e1", "e2") === "true", "due agganci devono essere quota vera");

const vera: MeasureElement = {
  type: "measure",
  id: "q1",
  x1: 0,
  y1: 0,
  x2: 1,
  y2: 0,
  ...trueMeasureFields(10000, "e1", "e2"),
};
assert(isTrueMeasure(vera), "quota vera non riconosciuta");
assert(vera.label === formatMm(10000), `label automatica: ${vera.label}`);
assert(formatLength(10000, "m") === "10.00 m", "formatLength m");
assert(formatLength(10000, "cm") === "1000.0 cm", "formatLength cm");
assert(formatLength(10000, "mm") === "10000 mm", "formatLength mm");
const riscritta = rewriteMeasure(vera, "9,80");
assert(riscritta.label === vera.label, "riscrittura ha sostituito l'originale");
assert(riscritta.note === "9,80", `nota attesa 9,80, trovata ${riscritta.note}`);

const inserita: MeasureElement = {
  type: "measure",
  id: "q2",
  x1: 0,
  y1: 0,
  x2: 1,
  y2: 0,
  ...insertedMeasureFields("12,4"),
};
assert(!isTrueMeasure(inserita), "quota inserita trattata come vera");
const inserita2 = rewriteMeasure(inserita, "muro");
assert(inserita2.label === "muro", "testo inserito non aggiornato");
assert(!inserita2.note, "quota inserita non deve avere nota sotto");

assert(parseScaleFactor("1:100") === 100, "1:100");
assert(parseScaleFactor("2,5") === 2.5, "fattore 2,5");
assert(parseUserLength("8,5", "m") === 8500, "8,5 m in mm");

if (muro && muro.kind === "line") {
  const ends = snaps.filter((s) => s.entityId === muro.id && s.kind === "end");
  if (ends.length >= 2) {
    const pageDist = Math.hypot(ends[1].x - ends[0].x, ends[1].y - ends[0].y);
    cad.scaleFactor = 2;
    const doubled = pageDistToMm(pageDist, cad, box.width, box.height);
    assert(Math.abs(doubled - 20000) < 1, `fattore 2 sul muro 10m: ${doubled}`);
    const known = parseUserLength("8", "m")!;
    const calibrated = calibrateUnitsPerMm(pageDist, known, cad, box.width, box.height);
    cad.unitsPerMm = calibrated;
    cad.scaleFactor = 1;
    const after = pageDistToMm(pageDist, cad, box.width, box.height);
    assert(Math.abs(after - 8000) < 1, `calibrazione 8m: ${after}`);
    const q = rescaleTrueMeasure(
      {
        type: "measure",
        id: "qx",
        x1: ends[0].x,
        y1: ends[0].y,
        x2: ends[1].x,
        y2: ends[1].y,
        kind: "true",
        mm: 10000,
        label: formatMm(10000),
        note: "9,80",
      },
      cad,
      box.width,
      box.height,
    );
    assert(Math.abs(q.mm - 8000) < 1, `quota ricalcolata: ${q.mm}`);
    assert(q.note === "9,80", "nota persa al ricalcolo scala");
    cad.unitsPerMm = parsed.unitsPerMm;
    cad.scaleFactor = 1;
  }
}

const naked = parseDxf(
  text.replace("9\n$INSUNITS\n70\n4\n", "").replace("9\r\n$INSUNITS\r\n70\r\n4\r\n", ""),
);
assert(!naked.unitsFromFile, "senza $INSUNITS deve chiedere la scala");
assert(suggestUnitKind({ minX: 0, minY: 0, maxX: 12, maxY: 8 }) === "m", "casa in metri");

assert(Math.abs(signedPerpOffset(0, 0, 10, 0, 5, 4) - 4) < 1e-9, "scostamento sopra il tratto");
assert(Math.abs(signedPerpOffset(0, 0, 10, 0, 5, -3) + 3) < 1e-9, "scostamento sotto il tratto");
assert(Math.abs(signedPerpOffset(0, 0, 0, 10, -2, 5) - 2) < 1e-9, "scostamento a sinistra");

{
  if (!(globalThis as { window?: unknown }).window) {
    (globalThis as { window?: unknown }).window = globalThis;
  }

  const page = createPage(0, "a4-portrait", "blank");
  page.elements.push(cad);
  const engine = new DrawingEngine(page, { ...DEFAULT_PEN_PREFS, tool: "measure" });
  engine.viewport = { scale: 1, x: 0, y: 0 };
  engine.viewW = page.width;
  engine.viewH = page.height;
  const host = {
    setPointerCapture() {},
    releasePointerCapture() {},
    getBoundingClientRect() {
      return {
        left: 0,
        top: 0,
        width: page.width,
        height: page.height,
        right: page.width,
        bottom: page.height,
        x: 0,
        y: 0,
        toJSON() {},
      };
    },
  } as unknown as HTMLElement;

  const click = (x: number, y: number, button = 0) => {
    const ev = {
      pointerId: 1,
      pointerType: "mouse",
      button,
      buttons: button === 0 ? 1 : 2,
      pressure: 0.5,
      timeStamp: 1,
      clientX: x,
      clientY: y,
      offsetX: x,
      offsetY: y,
    } as unknown as PointerEvent;
    engine.pointerDown(ev, host);
    engine.pointerUp(ev);
  };

  const wallEnds = snaps.filter((s) => s.entityId === muro?.id && s.kind === "end");
  assert(wallEnds.length >= 2, "muro 10m senza due estremi di snap");
  if (wallEnds.length >= 2) {
    click(wallEnds[0].x, wallEnds[0].y);
    assert(engine.quoting === "points", `dopo il primo click: ${engine.quoting}`);
    click(wallEnds[1].x, wallEnds[1].y);
    assert(engine.quoting === "offset", `dopo il secondo click: ${engine.quoting}`);
    assert(
      page.elements.filter((e) => e.type === "measure").length === 0,
      "la quota non deve chiudersi al secondo click",
    );
    const midX = (wallEnds[0].x + wallEnds[1].x) / 2;
    const midY = (wallEnds[0].y + wallEnds[1].y) / 2;
    click(midX, midY - 48);
    assert(engine.quoting === "idle", `dopo il terzo click: ${engine.quoting}`);
    const q1 = page.elements.find((e): e is MeasureElement => e.type === "measure");
    assert(q1 && isTrueMeasure(q1), "terzo click deve chiudere una quota vera");
    assert(Math.abs((q1?.off ?? 0) - -48) < 1, `scostamento dal terzo click: ${q1?.off}`);
  }

  const altro = parsed.primitives.find(
    (p) => p.kind === "line" && p.layer === "MURI" && p.id !== muro?.id,
  );
  const otherEnds = snaps.filter((s) => s.entityId === altro?.id && s.kind === "end");
  if (otherEnds.length >= 2) {
    click(otherEnds[0].x, otherEnds[0].y);
    click(otherEnds[1].x, otherEnds[1].y);
    assert(engine.quoting === "offset", "seconda quota: manca lo scostamento");
    click(otherEnds[1].x, otherEnds[1].y, 2);
    assert(engine.quoting === "idle", `tasto destro non ha chiuso: ${engine.quoting}`);
    const quotes = page.elements.filter((e): e is MeasureElement => e.type === "measure");
    assert(quotes.length === 2, `attese 2 quote, trovate ${quotes.length}`);
    assert(quotes.every((q) => isTrueMeasure(q)), "quota dal tasto destro non è vera");
    assert(!engine.pendingMeasure, "tasto destro su snap non deve aprire il testo");
  }
}

if (fail.length) {
  console.error("CAD check FALLITO:\n- " + fail.join("\n- "));
  console.error("kinds", kinds, "layers", [...names]);
  process.exit(1);
}
console.log("CAD check ok", kinds, "layers", parsed.layers.length, "snaps", snaps.length);
