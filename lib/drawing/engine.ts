import type {
  CadElement,
  DrawTool,
  ImageElement,
  MeasureElement,
  PageElement,
  PenKind,
  PenPrefs,
  Point,
  StrokeElement,
  SurveyPage,
} from "../models/types";
import { uid } from "../ids";
import { defaultWidthFor, RAL_2008 } from "../models/defaults";
import { QUOTA_INSERITA, QUOTA_VERA } from "../cad/colors";
import {
  buildTrueQuote,
  formatTrueLabel,
  insertedMeasureFields,
  isTrueMeasure,
  rewriteMeasure,
} from "../cad/quote";
import { snapCad } from "../cad/snap";
import { parseUserLength, calibrateUnitsPerMm, rescaleTrueMeasure, UNIT_PRESETS, type LengthUnit } from "../cad/units";
import {
  distToPolyline,
  distToSegment,
  offsetMeasureLine,
  pointInRotatedRect,
  signedPerpOffset,
} from "./geometry";
import { PageHistory } from "./history";
import {
  drawCad,
  drawPaperBackground,
  drawStrokeOn,
} from "./render";
import { simplifyStroke } from "./smooth";

export type Viewport = { scale: number; x: number; y: number };

export type EngineListener = () => void;

type PointerRec = { id: number; x: number; y: number; type: string };

export class DrawingEngine {
  page: SurveyPage;
  prefs: PenPrefs;
  viewport: Viewport = { scale: 1, x: 0, y: 0 };
  dpr = 1;
  selectedId: string | null = null;
  images = new Map<string, CanvasImageSource>();
  history = new PageHistory();
  private listeners = new Set<EngineListener>();
  private pointers = new Map<number, PointerRec>();
  private drawing: StrokeElement | null = null;
  private measureStart: (Point & { entityId?: string }) | null = null;
  private measurePreview: (Point & { entityId?: string }) | null = null;
  /** Due estremi scelti: il mouse posiziona la linea, il prossimo click la fissa. */
  pendingOffset: {
    a: Point & { entityId?: string };
    b: Point & { entityId?: string };
    off: number;
  } | null = null;
  pendingMeasure: { a: Point; b: Point; off?: number } | null = null;
  printMode = false;
  private printStart: Point | null = null;
  private printPreview: Point | null = null;
  pendingPrint: { a: Point; b: Point } | null = null;
  scaleMode = false;
  private scaleStart: Point | null = null;
  private scalePreview: Point | null = null;
  pendingScale: { a: Point; b: Point } | null = null;
  private pan:
    | { x: number; y: number; vx: number; vy: number }
    | null = null;
  private pinch:
    | { dist: number; scale: number; cx: number; cy: number; vx: number; vy: number }
    | null = null;
  private drag:
    | {
        id: string;
        mode: "move" | "resize" | "rotate";
        start: Point;
        orig: ImageElement;
      }
    | null = null;
  private lastQuotaOff: number | null = null;
  dirtyFull = true;
  dirtyInk = true;
  viewW = 1;
  viewH = 1;
  private host: HTMLElement | null = null;
  private histories = new Map<string, PageHistory>();
  private holdTimer = 0;
  private lastInk: Point | null = null;
  private straightStroke = false;

  constructor(page: SurveyPage, prefs: PenPrefs) {
    this.page = page;
    this.prefs = prefs;
  }

  onChange(fn: EngineListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn();
  }

  setPage(page: SurveyPage) {
    this.histories.set(this.page.id, this.history);
    this.page = page;
    this.selectedId = null;
    this.clearMeasureDraft();
    this.history = this.histories.get(page.id) ?? new PageHistory();
    this.dirtyFull = true;
    this.dirtyInk = true;
    this.emit();
  }

  setPrefs(prefs: PenPrefs) {
    if (prefs.tool !== this.prefs.tool) this.clearMeasureDraft();
    this.prefs = prefs;
  }

  fitToView(viewW = this.viewW, viewH = this.viewH) {
    this.viewW = viewW;
    this.viewH = viewH;
    if (viewW < 8 || viewH < 8) return;
    // A4 is wider than a phone screen at matching height: fill the viewport
    // vertically so the white sheet covers the display from the start.
    const s = viewH / this.page.height;
    this.viewport.scale = Math.max(0.05, s);
    this.viewport.x = (viewW - this.page.width * this.viewport.scale) / 2;
    this.viewport.y = 0;
    this.dirtyFull = true;
    this.emit();
  }

  setZoom(scale: number, viewW = this.viewW, viewH = this.viewH) {
    this.zoomAt(viewW / 2, viewH / 2, scale / this.viewport.scale);
  }

  zoomAt(screenX: number, screenY: number, factor: number) {
    const pagePt = this.screenToPage(screenX, screenY);
    this.viewport.scale = Math.max(0.08, Math.min(8, this.viewport.scale * factor));
    this.viewport.x = screenX - pagePt.x * this.viewport.scale;
    this.viewport.y = screenY - pagePt.y * this.viewport.scale;
    this.dirtyFull = true;
    this.emit();
  }

  private loc(e: PointerEvent): Point {
    const r = this.host?.getBoundingClientRect();
    if (!r) return { x: e.offsetX, y: e.offsetY };
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  screenToPage(x: number, y: number): Point {
    return {
      x: (x - this.viewport.x) / this.viewport.scale,
      y: (y - this.viewport.y) / this.viewport.scale,
    };
  }

  pageToScreen(x: number, y: number): Point {
    return {
      x: x * this.viewport.scale + this.viewport.x,
      y: y * this.viewport.scale + this.viewport.y,
    };
  }

  private cad(): CadElement | undefined {
    const cad = this.page.elements.find((e): e is CadElement => e.type === "cad");
    if (!cad) return undefined;
    if (!cad.layers) cad.layers = [];
    if (cad.hideHatches == null) cad.hideHatches = false;
    if (cad.scaleFactor == null || cad.scaleFactor <= 0) cad.scaleFactor = 1;
    if (cad.sourceUnitsPerMm == null) cad.sourceUnitsPerMm = cad.unitsPerMm;
    if (cad.unitsFromFile == null) cad.unitsFromFile = false;
    if (!cad.quoteUnit) cad.quoteUnit = "m";
    cad.primitives.forEach((p, i) => {
      if (!p.id) p.id = `legacy-${i}`;
    });
    return cad;
  }

  toggleLayer(name: string) {
    const cad = this.cad();
    if (!cad) return;
    const layers = cad.layers ?? (cad.layers = []);
    const layer = layers.find((l) => l.name === name);
    if (!layer) return;
    layer.visible = !layer.visible;
    this.dirtyFull = true;
    this.touchPage();
    this.emit();
  }

  toggleHatches() {
    const cad = this.cad();
    if (!cad) return;
    cad.hideHatches = !cad.hideHatches;
    this.dirtyFull = true;
    this.touchPage();
    this.emit();
  }

  setPrintMode(on: boolean) {
    this.printMode = on;
    this.printStart = null;
    this.printPreview = null;
    this.pendingPrint = null;
    if (on) {
      this.scaleMode = false;
      this.selectedId = null;
    }
    this.emit();
  }

  setScaleMode(on: boolean) {
    this.scaleMode = on;
    this.scaleStart = null;
    this.scalePreview = null;
    this.pendingScale = null;
    if (on) {
      this.printMode = false;
      this.selectedId = null;
    }
    this.emit();
  }

  setCadUnitKind(kind: "mm" | "cm" | "m") {
    const cad = this.cad();
    const preset = UNIT_PRESETS.find((p) => p.id === kind);
    if (!cad || !preset) return;
    cad.quoteUnit = kind;
    if (cad.unitsFromFile) {
      this.relabelTrueMeasures();
      this.dirtyInk = true;
      this.touchPage();
      this.emit();
      return;
    }
    this.applyCadScale({
      unitsPerMm: preset.unitsPerMm,
      unitKind: kind,
      scaleFactor: 1,
    });
  }

  setCadScaleFactor(factor: number) {
    if (!(factor > 0)) return;
    this.applyCadScale({ scaleFactor: factor });
  }

  resetCadScaleFromFile() {
    const cad = this.cad();
    if (!cad) return;
    const unitsPerMm = cad.sourceUnitsPerMm ?? cad.unitsPerMm;
    this.applyCadScale({
      unitsPerMm,
      scaleFactor: 1,
      unitKind: cad.unitsFromFile
        ? UNIT_PRESETS.find((p) => Math.abs(p.unitsPerMm - unitsPerMm) < 1e-6)?.id ?? "custom"
        : "custom",
    });
  }

  private applyCadScale(
    patch: Partial<Pick<CadElement, "unitsPerMm" | "scaleFactor" | "unitKind">>,
  ) {
    const cad = this.cad();
    if (!cad) return;
    Object.assign(cad, patch);
    this.rescaleTrueMeasures();
    this.dirtyFull = true;
    this.touchPage();
    this.emit();
  }

  private rescaleTrueMeasures() {
    const cad = this.cad();
    if (!cad) return;
    this.page.elements = this.page.elements.map((el) =>
      el.type === "measure"
        ? rescaleTrueMeasure(el, cad, this.page.width, this.page.height)
        : el,
    );
  }

  confirmPendingScale(raw: string, unit: LengthUnit = "m") {
    const pending = this.pendingScale;
    const cad = this.cad();
    if (!pending || !cad) return;
    this.pendingScale = null;
    this.scaleMode = false;
    const knownMm = parseUserLength(raw, unit);
    if (!knownMm) {
      this.emit();
      return;
    }
    const pageDist = Math.hypot(pending.b.x - pending.a.x, pending.b.y - pending.a.y);
    const unitsPerMm = calibrateUnitsPerMm(
      pageDist,
      knownMm,
      cad,
      this.page.width,
      this.page.height,
    );
    this.applyCadScale({ unitsPerMm, scaleFactor: 1, unitKind: "custom" });
  }

  cancelPendingScale() {
    this.pendingScale = null;
    this.scaleMode = false;
    this.scaleStart = null;
    this.scalePreview = null;
    this.emit();
  }

  private relabelTrueMeasures() {
    const cad = this.cad();
    if (!cad) return;
    const unit = cad.quoteUnit ?? "m";
    this.page.elements = this.page.elements.map((el) =>
      el.type === "measure" && isTrueMeasure(el)
        ? { ...el, label: formatTrueLabel(el.mm, unit, el.quoteShape ?? "length") }
        : el,
    );
  }

  private defaultQuotaOff(): number {
    return 28 / Math.max(this.viewport.scale, 0.001);
  }

  private rememberedQuotaOff(): number {
    return this.lastQuotaOff ?? this.defaultQuotaOff();
  }

  private clearMeasureDraft() {
    this.measureStart = null;
    this.measurePreview = null;
    this.pendingOffset = null;
  }

  private offsetAt(a: Point, b: Point, cursor: Point): number {
    return signedPerpOffset(a.x, a.y, b.x, b.y, cursor.x, cursor.y);
  }

  private finishPendingOffset(off: number) {
    const rec = this.pendingOffset;
    if (!rec) return;
    this.pendingOffset = null;
    this.lastQuotaOff = off;
    this.measureStart = null;
    this.measurePreview = null;
    if (rec.a.entityId && rec.b.entityId) this.addTrueMeasure(rec.a, rec.b, off);
    else this.pendingMeasure = { a: rec.a, b: rec.b, off };
  }

  private snapAt(pagePt: Point) {
    const cad = this.cad();
    if (!cad) return null;
    return snapCad(pagePt.x, pagePt.y, cad, {
      x: 0,
      y: 0,
      width: this.page.width,
      height: this.page.height,
    }, 18 / this.viewport.scale);
  }

  private pickSnap(pagePt: Point): Point & { entityId?: string } {
    const snapped = this.snapAt(pagePt);
    return snapped
      ? { x: snapped.x, y: snapped.y, entityId: snapped.entityId }
      : { ...pagePt };
  }

  private canInk(e: PointerEvent): boolean {
    if (e.pointerType === "pen") return true;
    // S Pen on some Android Chrome builds arrives as mouse, not pen.
    if (e.pointerType === "mouse") return true;
    return false;
  }

  pointerDown(e: PointerEvent, el: HTMLElement) {
    this.host = el;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* capture can fail if the pointer already ended */
    }
    const pos = this.loc(e);
    const rec: PointerRec = {
      id: e.pointerId,
      x: pos.x,
      y: pos.y,
      type: e.pointerType,
    };
    this.pointers.set(e.pointerId, rec);

    if (e.pointerType === "touch") {
      this.drawing = null;
      this.measureStart = null;
      const touches = [...this.pointers.values()].filter((p) => p.type === "touch");
      if (touches.length >= 2) {
        this.pan = null;
        const a = touches[0];
        const b = touches[1];
        this.pinch = {
          dist: Math.hypot(a.x - b.x, a.y - b.y),
          scale: this.viewport.scale,
          cx: (a.x + b.x) / 2,
          cy: (a.y + b.y) / 2,
          vx: this.viewport.x,
          vy: this.viewport.y,
        };
        return;
      }
      if (!this.printMode && !this.scaleMode) {
        this.pinch = null;
        this.pan = {
          x: pos.x,
          y: pos.y,
          vx: this.viewport.x,
          vy: this.viewport.y,
        };
        return;
      }
    }

    if (!this.canInk(e) && !this.printMode && !this.scaleMode) return;

    const pagePt = this.screenToPage(pos.x, pos.y);
    const tool = this.prefs.tool;

    if (e.button === 2) {
      if (tool === "measure" && !this.pendingMeasure) {
        if (this.pendingOffset) this.finishPendingOffset(this.rememberedQuotaOff());
        else this.clearMeasureDraft();
        this.emit();
      }
      return;
    }

    if (this.printMode) {
      this.printStart = pagePt;
      this.printPreview = pagePt;
      this.emit();
      return;
    }

    if (this.scaleMode) {
      const snapped = this.snapAt(pagePt);
      this.scaleStart = snapped ? { x: snapped.x, y: snapped.y } : { ...pagePt };
      this.scalePreview = this.scaleStart;
      this.emit();
      return;
    }

    if (tool === "select" || this.hitHandle(pagePt)) {
      const handle = this.hitHandle(pagePt);
      const img = handle
        ? (this.page.elements.find((elmt) => elmt.id === this.selectedId) as
            | ImageElement
            | undefined)
        : this.hitImage(pagePt);
      if (img) {
        this.selectedId = img.id;
        this.drag = {
          id: img.id,
          mode: handle ?? "move",
          start: pagePt,
          orig: { ...img },
        };
        this.emit();
        return;
      }
      const quota = this.hitMeasure(pagePt);
      this.selectedId = quota ? quota.id : null;
      this.emit();
      return;
    }

    if (tool === "measure") {
      if (this.pendingMeasure) return;
      if (this.pendingOffset) {
        this.finishPendingOffset(this.offsetAt(this.pendingOffset.a, this.pendingOffset.b, pagePt));
        this.emit();
        return;
      }
      const pt = this.pickSnap(pagePt);
      if (!this.measureStart) {
        this.measureStart = pt;
        this.measurePreview = pt;
      } else {
        this.measurePreview = pt;
      }
      this.emit();
      return;
    }

    if (tool === "eraser" && this.prefs.eraserMode === "stroke") {
      const stroke = this.hitStroke(pagePt);
      if (stroke) this.removeElement(stroke.id, "Cancella tratto");
      return;
    }

    this.selectedId = null;
    const kind: PenKind | "eraser" =
      tool === "eraser" ? "eraser" : this.prefs.penKind;
    const width =
      tool === "eraser"
        ? this.prefs.eraserSize
        : defaultWidthFor(this.prefs.penKind, this.prefs);
    const nkind = kind === "eraser" ? "eraser" : kind;
    const opacity =
      nkind === "highlighter" ? 0.35 : nkind === "pencil" ? 0.55 : 1;
    this.drawing = {
      type: "stroke",
      id: uid(),
      style: {
        tool: kind === "eraser" ? "eraser" : this.prefs.penKind,
        color: kind === "eraser" ? "#000000" : this.prefs.color,
        width,
        opacity,
      },
      points: [{ ...pagePt, p: e.pressure, t: e.timeStamp }],
      composite: kind === "eraser" ? "destination-out" : "source-over",
    };
    this.straightStroke = false;
    this.lastInk = { ...pagePt };
    if (tool !== "eraser") this.armHoldStraighten();
  }

  pointerMove(e: PointerEvent) {
    const rec = this.pointers.get(e.pointerId);
    const pos = this.loc(e);
    if (rec) {
      rec.x = pos.x;
      rec.y = pos.y;
    }

    if (this.prefs.tool === "measure" && this.pendingOffset && !this.pan && !this.pinch) {
      const pagePt = this.screenToPage(pos.x, pos.y);
      this.pendingOffset.off = this.offsetAt(
        this.pendingOffset.a,
        this.pendingOffset.b,
        pagePt,
      );
      this.emit();
      if (!rec) return;
    }

    if (
      this.prefs.tool === "measure" &&
      this.measureStart &&
      !this.pendingOffset &&
      !this.pan &&
      !this.pinch
    ) {
      const pagePt = this.screenToPage(pos.x, pos.y);
      this.measurePreview = this.pickSnap(pagePt);
      this.emit();
      if (!rec) return;
    }

    if (!rec) return;

    if (this.pan && !this.pinch) {
      this.viewport.x = this.pan.vx + (pos.x - this.pan.x);
      this.viewport.y = this.pan.vy + (pos.y - this.pan.y);
      this.dirtyFull = true;
      this.emit();
      return;
    }

    if (this.pinch) {
      const touches = [...this.pointers.values()].filter((p) => p.type === "touch");
      if (touches.length >= 2) {
        const a = touches[0];
        const b = touches[1];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const cx = (a.x + b.x) / 2;
        const cy = (a.y + b.y) / 2;
        const factor = dist / Math.max(this.pinch.dist, 1);
        const nextScale = Math.max(0.08, Math.min(8, this.pinch.scale * factor));
        const pagePt = {
          x: (this.pinch.cx - this.pinch.vx) / this.pinch.scale,
          y: (this.pinch.cy - this.pinch.vy) / this.pinch.scale,
        };
        this.viewport.scale = nextScale;
        this.viewport.x = cx - pagePt.x * nextScale + (cx - this.pinch.cx);
        this.viewport.y = cy - pagePt.y * nextScale + (cy - this.pinch.cy);
        this.dirtyFull = true;
        this.emit();
      }
      return;
    }

    const pagePt = this.screenToPage(pos.x, pos.y);

    if (this.printStart) {
      this.printPreview = pagePt;
      this.emit();
      return;
    }

    if (this.scaleStart) {
      const snapped = this.snapAt(pagePt);
      this.scalePreview = snapped ? { x: snapped.x, y: snapped.y } : { ...pagePt };
      this.emit();
      return;
    }

    if (this.drag) {
      const img = this.page.elements.find(
        (el): el is ImageElement => el.type === "image" && el.id === this.drag!.id,
      );
      if (!img) return;
      const dx = pagePt.x - this.drag.start.x;
      const dy = pagePt.y - this.drag.start.y;
      if (this.drag.mode === "move") {
        img.x = this.drag.orig.x + dx;
        img.y = this.drag.orig.y + dy;
      } else if (this.drag.mode === "resize") {
        img.width = Math.max(40, this.drag.orig.width + dx);
        img.height = Math.max(40, this.drag.orig.height + dy);
      } else if (this.drag.mode === "rotate") {
        const cx = img.x + img.width / 2;
        const cy = img.y + img.height / 2;
        img.rotation = (Math.atan2(pagePt.y - cy, pagePt.x - cx) * 180) / Math.PI;
      }
      this.dirtyFull = true;
      this.emit();
      return;
    }

    if (this.drawing) {
      const events =
        typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [e];
      const lastEv = events[events.length - 1] ?? e;
      const pagePt = this.screenToPage(
        this.host
          ? lastEv.clientX - this.host.getBoundingClientRect().left
          : lastEv.offsetX,
        this.host
          ? lastEv.clientY - this.host.getBoundingClientRect().top
          : lastEv.offsetY,
      );

      if (this.straightStroke) {
        const start = this.drawing.points[0];
        this.drawing.points = [
          start,
          { ...pagePt, p: lastEv.pressure, t: lastEv.timeStamp },
        ];
        this.emit();
        return;
      }

      for (const ev of events) {
        const pt = this.screenToPage(
          this.host
            ? ev.clientX - this.host.getBoundingClientRect().left
            : ev.offsetX,
          this.host
            ? ev.clientY - this.host.getBoundingClientRect().top
            : ev.offsetY,
        );
        this.drawing.points.push({
          ...pt,
          p: ev.pressure,
          t: ev.timeStamp,
        });
      }
      if (this.drawing.style.tool !== "eraser") {
        const stillPx = 8 / Math.max(this.viewport.scale, 0.01);
        const prev = this.lastInk;
        if (!prev || Math.hypot(pagePt.x - prev.x, pagePt.y - prev.y) > stillPx) {
          this.lastInk = { ...pagePt };
          this.armHoldStraighten();
        }
      }
      this.emit();
    }
  }

  pointerUp(e: PointerEvent) {
    this.pointers.delete(e.pointerId);
    if (this.pan && this.pointers.size < 1) {
      this.pan = null;
    }
    if (this.pinch && this.pointers.size < 2) {
      this.pinch = null;
      this.pan = null;
      this.dirtyFull = true;
      this.emit();
      return;
    }

    if (this.printStart && this.printPreview) {
      const a = this.printStart;
      const b = this.printPreview;
      this.printStart = null;
      this.printPreview = null;
      if (Math.hypot(b.x - a.x, b.y - a.y) > 8) {
        this.pendingPrint = { a, b };
        this.printMode = false;
      }
      this.emit();
      return;
    }

    if (this.scaleStart && this.scalePreview) {
      const a = this.scaleStart;
      const b = this.scalePreview;
      this.scaleStart = null;
      this.scalePreview = null;
      if (Math.hypot(b.x - a.x, b.y - a.y) > 4) {
        this.pendingScale = { a, b };
        this.scaleMode = false;
      }
      this.emit();
      return;
    }

    if (this.drag) {
      const orig = this.drag.orig;
      const img = this.page.elements.find(
        (el): el is ImageElement => el.type === "image" && el.id === this.drag!.id,
      );
      this.drag = null;
      if (img) {
        const next = { ...img };
        this.history.push({
          label: "Trasforma foto",
          undo: () => {
            Object.assign(img, orig);
            this.dirtyFull = true;
            this.emit();
          },
          redo: () => {
            Object.assign(img, next);
            this.dirtyFull = true;
            this.emit();
          },
        });
      }
      this.touchPage();
      this.emit();
      return;
    }

    if (this.measureStart && this.measurePreview && e.button !== 2 && !this.pendingOffset) {
      const a = this.measureStart;
      const b = this.measurePreview;
      if (Math.hypot(b.x - a.x, b.y - a.y) <= 4) {
        this.emit();
        return;
      }
      this.pendingOffset = { a, b, off: this.rememberedQuotaOff() };
      this.measureStart = null;
      this.measurePreview = null;
      this.emit();
      return;
    }

    if (this.drawing) {
      this.clearHoldStraighten();
      const stroke = this.drawing;
      this.drawing = null;
      this.straightStroke = false;
      this.lastInk = null;
      stroke.points = simplifyStroke(stroke.points);
      if (stroke.points.length === 1) {
        const p = stroke.points[0];
        stroke.points.push({ x: p.x + 0.2, y: p.y, p: p.p });
      }
      this.addElement(stroke, stroke.points.length === 2 ? "Linea" : "Tratto");
    }
  }

  pointerCancel(e: PointerEvent) {
    this.clearHoldStraighten();
    this.pointers.delete(e.pointerId);
    this.drawing = null;
    this.straightStroke = false;
    this.lastInk = null;
    this.pinch = null;
    this.pan = null;
    this.drag = null;
    this.printStart = null;
    this.printPreview = null;
    this.scaleStart = null;
    this.scalePreview = null;
    this.emit();
  }

  private armHoldStraighten() {
    this.clearHoldStraighten();
    this.holdTimer = window.setTimeout(() => this.rectifyLiveStroke(), 1000);
  }

  private clearHoldStraighten() {
    if (this.holdTimer) {
      window.clearTimeout(this.holdTimer);
      this.holdTimer = 0;
    }
  }

  private rectifyLiveStroke() {
    this.holdTimer = 0;
    const stroke = this.drawing;
    if (!stroke || stroke.style.tool === "eraser" || stroke.points.length < 2) return;
    const start = stroke.points[0];
    const end = stroke.points[stroke.points.length - 1];
    if (Math.hypot(end.x - start.x, end.y - start.y) < 4) return;
    stroke.points = [start, { ...end }];
    this.straightStroke = true;
    this.emit();
  }

  confirmPendingMeasure(raw: string) {
    const pending = this.pendingMeasure;
    if (!pending) return;
    this.pendingMeasure = null;
    const label = raw.trim();
    if (!label) {
      this.emit();
      return;
    }
    const el: MeasureElement = {
      type: "measure",
      id: uid(),
      x1: pending.a.x,
      y1: pending.a.y,
      x2: pending.b.x,
      y2: pending.b.y,
      ...insertedMeasureFields(label),
      off: pending.off ?? this.defaultQuotaOff(),
    };
    this.addElement(el, "Quota inserita");
  }

  private addTrueMeasure(
    a: Point & { entityId?: string },
    b: Point & { entityId?: string },
    off = this.defaultQuotaOff(),
  ) {
    const cad = this.cad();
    if (!cad) return;
    const el: MeasureElement = {
      type: "measure",
      id: uid(),
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      ...buildTrueQuote(a, b, cad, this.page.width, this.page.height),
      off,
    };
    this.addElement(el, "Quota");
  }

  cancelPendingMeasure() {
    this.pendingMeasure = null;
    this.emit();
  }

  addElement(el: PageElement, label: string) {
    this.page.elements.push(el);
    this.history.push({
      label,
      undo: () => {
        this.page.elements = this.page.elements.filter((e) => e.id !== el.id);
        this.dirtyFull = true;
        this.emit();
      },
      redo: () => {
        this.page.elements.push(el);
        this.dirtyFull = true;
        this.emit();
      },
    });
    this.dirtyInk = el.type === "stroke";
    this.dirtyFull = el.type !== "stroke";
    this.touchPage();
    this.emit();
  }

  removeElement(id: string, label = "Elimina") {
    const idx = this.page.elements.findIndex((e) => e.id === id);
    if (idx < 0) return;
    const el = this.page.elements[idx];
    this.page.elements.splice(idx, 1);
    this.history.push({
      label,
      undo: () => {
        this.page.elements.splice(idx, 0, el);
        this.dirtyFull = true;
        this.emit();
      },
      redo: () => {
        this.page.elements = this.page.elements.filter((e) => e.id !== id);
        this.dirtyFull = true;
        this.emit();
      },
    });
    this.dirtyFull = true;
    this.touchPage();
    this.emit();
  }

  undo() {
    if (this.history.undo()) {
      this.dirtyFull = true;
      this.touchPage();
      this.emit();
    }
  }

  redo() {
    if (this.history.redo()) {
      this.dirtyFull = true;
      this.touchPage();
      this.emit();
    }
  }

  bringImage(id: string, dir: "front" | "back") {
    const el = this.page.elements.find(
      (e): e is ImageElement => e.type === "image" && e.id === id,
    );
    if (!el) return;
    const prev = el.zIndex;
    el.zIndex = dir === "front" ? prev + 1 : prev - 1;
    this.history.push({
      label: "Ordine foto",
      undo: () => {
        el.zIndex = prev;
        this.dirtyFull = true;
        this.emit();
      },
      redo: () => {
        el.zIndex = dir === "front" ? prev + 1 : prev - 1;
        this.dirtyFull = true;
        this.emit();
      },
    });
    this.dirtyFull = true;
    this.touchPage();
    this.emit();
  }

  setImageBackground(id: string, asBackground: boolean) {
    const el = this.page.elements.find(
      (e): e is ImageElement => e.type === "image" && e.id === id,
    );
    if (!el) return;
    const prev = { asBackground: el.asBackground, x: el.x, y: el.y, width: el.width, height: el.height };
    el.asBackground = asBackground;
    if (asBackground) {
      el.x = 0;
      el.y = 0;
      el.width = this.page.width;
      el.height = this.page.height;
      el.rotation = 0;
    }
    const next = { asBackground: el.asBackground, x: el.x, y: el.y, width: el.width, height: el.height };
    this.history.push({
      label: "Sfondo foto",
      undo: () => {
        Object.assign(el, prev);
        this.dirtyFull = true;
        this.emit();
      },
      redo: () => {
        Object.assign(el, next);
        this.dirtyFull = true;
        this.emit();
      },
    });
    this.dirtyFull = true;
    this.touchPage();
    this.emit();
  }

  private touchPage() {
    this.page.updatedAt = new Date().toISOString();
  }

  private hitStroke(p: Point): StrokeElement | undefined {
    const strokes = this.page.elements.filter(
      (e): e is StrokeElement => e.type === "stroke" && e.composite !== "destination-out",
    );
    for (let i = strokes.length - 1; i >= 0; i--) {
      const s = strokes[i];
      if (distToPolyline(p, s.points) <= s.style.width / 2 + 10) return s;
    }
    return undefined;
  }

  private hitImage(p: Point): ImageElement | undefined {
    const images = this.page.elements
      .filter((e): e is ImageElement => e.type === "image")
      .sort((a, b) => b.zIndex - a.zIndex);
    return images.find((img) => pointInRotatedRect(p, img));
  }

  private hitMeasure(p: Point): MeasureElement | undefined {
    const soglia = 16 / this.viewport.scale;
    return this.page.elements
      .filter((e): e is MeasureElement => e.type === "measure")
      .find((m) => {
        const line = offsetMeasureLine(m.x1, m.y1, m.x2, m.y2, m.off ?? 0);
        const mid = { x: (line.a.x + line.b.x) / 2, y: (line.a.y + line.b.y) / 2 };
        return (
          distToSegment(p, line.a, line.b) < soglia ||
          distToSegment(p, { x: m.x1, y: m.y1 }, line.a) < soglia ||
          distToSegment(p, { x: m.x2, y: m.y2 }, line.b) < soglia ||
          Math.hypot(p.x - mid.x, p.y - mid.y) < 22 / this.viewport.scale
        );
      });
  }

  /** Cosa e' selezionato adesso: serve alla barra di modifica. */
  selectedElement(): ImageElement | MeasureElement | null {
    if (!this.selectedId) return null;
    const el = this.page.elements.find((e) => e.id === this.selectedId);
    if (!el) return null;
    return el.type === "image" || el.type === "measure" ? el : null;
  }

  /** Toglie la selezione senza cambiare strumento: e' la via d'uscita. */
  clearSelection() {
    if (!this.selectedId) return;
    this.selectedId = null;
    this.emit();
  }

  deleteSelected() {
    const el = this.selectedElement();
    if (!el) return;
    this.selectedId = null;
    this.removeElement(el.id, el.type === "image" ? "Elimina foto" : "Elimina quota");
  }

  /**
   * Corregge il valore di una quota gia' tracciata. I due punti non si
   * toccano: si sbaglia a digitare il numero, non a indicare cosa si misura.
   */
  editSelectedMeasure(raw: string) {
    const el = this.selectedElement();
    if (!el || el.type !== "measure") return;
    const label = raw.trim();
    if (!label) return;
    const idx = this.page.elements.findIndex((e) => e.id === el.id);
    if (idx < 0) return;
    const prima = { ...el };
    const dopo = rewriteMeasure(el, label);
    this.page.elements[idx] = dopo;
    this.history.push({
      label: "Modifica quota",
      undo: () => {
        const i = this.page.elements.findIndex((e) => e.id === el.id);
        if (i >= 0) this.page.elements[i] = prima;
        this.dirtyFull = true;
        this.emit();
      },
      redo: () => {
        const i = this.page.elements.findIndex((e) => e.id === el.id);
        if (i >= 0) this.page.elements[i] = dopo;
        this.dirtyFull = true;
        this.emit();
      },
    });
    this.dirtyFull = true;
    this.touchPage();
    this.emit();
  }

  private hitHandle(p: Point): "resize" | "rotate" | null {
    if (!this.selectedId) return null;
    const img = this.page.elements.find(
      (e): e is ImageElement => e.type === "image" && e.id === this.selectedId,
    );
    if (!img) return null;
    const br = { x: img.x + img.width, y: img.y + img.height };
    const rot = { x: img.x + img.width / 2, y: img.y - 28 };
    if (Math.hypot(p.x - br.x, p.y - br.y) < 18) return "resize";
    if (Math.hypot(p.x - rot.x, p.y - rot.y) < 18) return "rotate";
    return null;
  }

  get isLive(): boolean {
    return !!(
      this.drawing ||
      this.pinch ||
      this.pan ||
      this.drag ||
      this.pendingOffset ||
      this.measureStart ||
      this.printStart ||
      this.scaleStart
    );
  }

  currentStroke(): StrokeElement | null {
    return this.drawing;
  }

  measurePreviewPoints(): {
    a: Point & { entityId?: string };
    b: Point & { entityId?: string };
  } | null {
    if (this.pendingOffset) {
      return { a: this.pendingOffset.a, b: this.pendingOffset.b };
    }
    if (this.measureStart && this.measurePreview) {
      return { a: this.measureStart, b: this.measurePreview };
    }
    if (this.pendingMeasure) return this.pendingMeasure;
    return null;
  }

  get quoting(): "idle" | "points" | "offset" {
    if (this.pendingOffset) return "offset";
    if (this.measureStart) return "points";
    return "idle";
  }

  private applyView(ctx: CanvasRenderingContext2D) {
    const d = this.dpr;
    ctx.setTransform(
      this.viewport.scale * d,
      0,
      0,
      this.viewport.scale * d,
      this.viewport.x * d,
      this.viewport.y * d,
    );
  }

  renderBase(ctx: CanvasRenderingContext2D) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    this.applyView(ctx);
    drawPaperBackground(ctx, this.page);

    const cad = this.cad();
    if (cad) {
      drawCad(ctx, cad, {
        x: 0,
        y: 0,
        width: this.page.width,
        height: this.page.height,
      });
    }

    const images = this.page.elements
      .filter((e): e is ImageElement => e.type === "image")
      .sort((a, b) => {
        const ab = a.asBackground ? -1000 : a.zIndex;
        const bb = b.asBackground ? -1000 : b.zIndex;
        return ab - bb;
      });
    for (const img of images) {
      const bmp = this.images.get(img.previewAssetId ?? img.assetId) ?? this.images.get(img.assetId);
      if (!bmp) continue;
      ctx.save();
      ctx.translate(img.x + img.width / 2, img.y + img.height / 2);
      ctx.rotate((img.rotation * Math.PI) / 180);
      ctx.drawImage(bmp, -img.width / 2, -img.height / 2, img.width, img.height);
      ctx.restore();
    }
  }

  /**
   * Dal vivo l'inchiostro sta su una canvas sua e va ripulito a ogni passata.
   * Nell'export invece condivide la canvas con lo sfondo: cancellare lì
   * significa buttare via la carta e tutte le foto appena disegnate — ed è
   * esattamente quello che succedeva a miniature, PDF e anteprime per la
   * Suite, che uscivano con il solo tratto su fondo trasparente.
   */
  renderInk(ctx: CanvasRenderingContext2D, pulisci = true) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (pulisci) ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    this.applyView(ctx);
    for (const el of this.page.elements) {
      if (el.type !== "stroke") continue;
      drawStrokeOn(
        ctx,
        el.points,
        el.style,
        el.composite ?? "source-over",
      );
    }
    for (const el of this.page.elements) {
      if (el.type !== "measure") continue;
      this.drawMeasure(ctx, el);
    }
  }

  renderOverlay(ctx: CanvasRenderingContext2D) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    this.applyView(ctx);
    if (this.drawing) {
      drawStrokeOn(
        ctx,
        this.drawing.points,
        this.drawing.style,
        this.drawing.composite ?? "source-over",
      );
    }
    const preview = this.measurePreviewPoints();
    if (preview) {
      const cad = this.cad();
      const snapped = !!(
        this.measureStart?.entityId && this.measurePreview?.entityId && cad
      );
      const quote = snapped && cad
        ? buildTrueQuote(preview.a, preview.b, cad, this.page.width, this.page.height)
        : null;
      this.drawMeasure(ctx, {
        type: "measure",
        id: "preview",
        x1: preview.a.x,
        y1: preview.a.y,
        x2: preview.b.x,
        y2: preview.b.y,
        kind: snapped ? "true" : "inserted",
        mm: quote?.mm ?? 0,
        label: quote?.label ?? "",
        quoteShape: quote?.quoteShape,
        off: this.pendingOffset?.off ?? this.pendingMeasure?.off ?? this.defaultQuotaOff(),
      });
    }
    if (this.printStart && this.printPreview) {
      this.drawPrintRect(ctx, this.printStart, this.printPreview);
    } else if (this.pendingPrint) {
      this.drawPrintRect(ctx, this.pendingPrint.a, this.pendingPrint.b);
    }
    if (this.scaleStart && this.scalePreview) {
      this.drawMeasure(ctx, {
        type: "measure",
        id: "scale-preview",
        x1: this.scaleStart.x,
        y1: this.scaleStart.y,
        x2: this.scalePreview.x,
        y2: this.scalePreview.y,
        kind: "true",
        mm: 0,
        label: "scala",
      });
    } else if (this.pendingScale) {
      this.drawMeasure(ctx, {
        type: "measure",
        id: "scale-pending",
        x1: this.pendingScale.a.x,
        y1: this.pendingScale.a.y,
        x2: this.pendingScale.b.x,
        y2: this.pendingScale.b.y,
        kind: "true",
        mm: 0,
        label: "scala",
      });
    }
    if (this.selectedId) {
      const quota = this.page.elements.find(
        (e): e is MeasureElement => e.type === "measure" && e.id === this.selectedId,
      );
      if (quota) {
        const line = offsetMeasureLine(quota.x1, quota.y1, quota.x2, quota.y2, quota.off ?? 0);
        ctx.save();
        ctx.strokeStyle = RAL_2008;
        ctx.lineWidth = 6 / this.viewport.scale;
        ctx.globalAlpha = 0.25;
        ctx.beginPath();
        ctx.moveTo(line.a.x, line.a.y);
        ctx.lineTo(line.b.x, line.b.y);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = RAL_2008;
        const r = 6 / this.viewport.scale;
        for (const pt of [
          { x: quota.x1, y: quota.y1 },
          { x: quota.x2, y: quota.y2 },
        ]) {
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
      const img = this.page.elements.find(
        (e): e is ImageElement => e.type === "image" && e.id === this.selectedId,
      );
      if (img) {
        ctx.save();
        ctx.strokeStyle = RAL_2008;
        ctx.lineWidth = 2 / this.viewport.scale;
        ctx.setLineDash([8 / this.viewport.scale, 6 / this.viewport.scale]);
        ctx.strokeRect(img.x, img.y, img.width, img.height);
        ctx.setLineDash([]);
        ctx.fillStyle = RAL_2008;
        const hs = 8 / this.viewport.scale;
        ctx.fillRect(img.x + img.width - hs, img.y + img.height - hs, hs * 2, hs * 2);
        ctx.beginPath();
        ctx.arc(img.x + img.width / 2, img.y - 28, hs, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  }

  private measureKind(el: MeasureElement): "true" | "inserted" {
    return isTrueMeasure(el) ? "true" : "inserted";
  }

  private drawPrintRect(ctx: CanvasRenderingContext2D, a: Point, b: Point) {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const w = Math.abs(b.x - a.x);
    const h = Math.abs(b.y - a.y);
    ctx.save();
    ctx.strokeStyle = RAL_2008;
    ctx.fillStyle = "rgba(243, 117, 44, 0.12)";
    ctx.lineWidth = 2 / this.viewport.scale;
    ctx.setLineDash([10 / this.viewport.scale, 6 / this.viewport.scale]);
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
  }

  clearPendingPrint() {
    this.pendingPrint = null;
    this.printMode = false;
    this.emit();
  }

  private drawMeasure(ctx: CanvasRenderingContext2D, el: MeasureElement) {
    const vera = this.measureKind(el) === "true";
    const color = vera ? QUOTA_VERA : QUOTA_INSERITA;
    const line = offsetMeasureLine(el.x1, el.y1, el.x2, el.y2, el.off ?? 0);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.4 / this.viewport.scale;
    ctx.beginPath();
    ctx.moveTo(el.x1, el.y1);
    ctx.lineTo(line.a.x, line.a.y);
    ctx.moveTo(el.x2, el.y2);
    ctx.lineTo(line.b.x, line.b.y);
    ctx.stroke();
    ctx.lineWidth = 2 / this.viewport.scale;
    ctx.beginPath();
    ctx.moveTo(line.a.x, line.a.y);
    ctx.lineTo(line.b.x, line.b.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(el.x1, el.y1, 4 / this.viewport.scale, 0, Math.PI * 2);
    ctx.arc(el.x2, el.y2, 4 / this.viewport.scale, 0, Math.PI * 2);
    ctx.fill();
    const mx = (line.a.x + line.b.x) / 2;
    const my = (line.a.y + line.b.y) / 2;
    const font = `${14 / this.viewport.scale}px sans-serif`;
    ctx.font = font;
    const lines: { text: string; color: string }[] = [];
    if (vera) {
      lines.push({
        text:
          el.label ||
          formatTrueLabel(el.mm, this.cad()?.quoteUnit ?? "m", el.quoteShape ?? "length"),
        color: QUOTA_VERA,
      });
      if (el.note) lines.push({ text: `(${el.note})`, color: QUOTA_INSERITA });
    } else if (el.label) {
      lines.push({ text: el.label, color: QUOTA_INSERITA });
    }
    const pad = 5 / this.viewport.scale;
    const lineH = 16 / this.viewport.scale;
    const widths = lines.map((l) => ctx.measureText(l.text).width);
    const boxW = Math.max(0, ...widths);
    if (lines.length) {
      ctx.fillStyle = "#FFFBF5";
      ctx.fillRect(
        mx - boxW / 2 - pad,
        my - lineH * lines.length + 4 / this.viewport.scale,
        boxW + pad * 2,
        lineH * lines.length + pad,
      );
      lines.forEach((l, i) => {
        ctx.fillStyle = l.color;
        ctx.fillText(
          l.text,
          mx - (widths[i] ?? 0) / 2,
          my - lineH * (lines.length - 1 - i),
        );
      });
    }
    ctx.restore();
  }

  renderExportCanvas(scale = 2): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(this.page.width * scale);
    canvas.height = Math.round(this.page.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D non disponibile");
    const prev = { ...this.viewport };
    const prevDpr = this.dpr;
    this.dpr = 1;
    this.viewport = { scale, x: 0, y: 0 };
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, canvas.width, canvas.height);
    ctx.clip();
    this.renderBase(ctx);
    this.renderInk(ctx, false);
    ctx.restore();
    this.viewport = prev;
    this.dpr = prevDpr;
    return canvas;
  }

  setTool(tool: DrawTool) {
    this.prefs.tool = tool;
    if (tool !== "select") this.selectedId = null;
    if (tool !== "measure") this.clearMeasureDraft();
    this.emit();
  }
}

export type DrawToolType = DrawTool;
