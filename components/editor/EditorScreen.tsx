"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DrawingSurface } from "./DrawingSurface";
import { PageDock } from "./PageDock";
import { ToolCard } from "./ToolCard";
import { CameraSheet } from "./CameraSheet";
import { PageSettings } from "./PageSettings";
import { CadDock } from "./CadDock";
import { MoreMenu } from "./MoreMenu";
import { MeasurePad } from "./MeasurePad";
import { SelectionBar } from "./SelectionBar";
import { ConfirmDialog, Dialog, Field } from "../ui/Dialog";
import { FloatCard } from "../ui/FloatCard";
import { DrawingEngine } from "@/lib/drawing/engine";
import {
  createPage,
  DEFAULT_PEN_PREFS,
  PAGE_FORMATS,
  normalizePenKind,
} from "@/lib/models/defaults";
import type {
  CadElement,
  ImageElement,
  PageFormatId,
  PagePaper,
  PenPrefs,
  Survey,
  SurveyPage,
} from "@/lib/models/types";
import {
  deleteSurvey,
  duplicateSurvey,
  getSurvey,
  loadPenPrefs,
  savePenPrefs,
  saveSurvey,
} from "@/lib/db/surveys";
import { putAsset } from "@/lib/db/assets";
import { ingestImageFile } from "@/lib/media/image";
import { hydratePageImages } from "@/lib/media/hydrate";
import { parseCadFile, CadParseError } from "@/lib/cad/parse";
import { cadFromParsed } from "@/lib/cad/ingest";
import { uid } from "@/lib/ids";
import { exportSurveyPdf } from "@/lib/export/pdf";
import { exportWindowPdf } from "@/lib/export/window-pdf";
import { exportSurveyImages } from "@/lib/export/images";
import { exportProject } from "@/lib/export/project";
import { downloadBlob, fileSlug } from "@/lib/export/download";
import { updateSurveyThumbnail } from "@/lib/export/thumbnail";
import { IconBack, IconFit, IconRedo, IconSave, IconUndo, IconZoomIn } from "../brand/Icons";

const SAVE_MS = 800;

export function EditorScreen({ surveyId }: { surveyId: string }) {
  const router = useRouter();
  const [survey, setSurvey] = useState<Survey | null>(null);
  const [pageId, setPageId] = useState<string | null>(null);
  const [engine, setEngine] = useState<DrawingEngine | null>(null);
  const [prefs, setPrefs] = useState<PenPrefs>(DEFAULT_PEN_PREFS);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [tick, setTick] = useState(0);
  const shellRef = useRef<HTMLDivElement>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [pageOpen, setPageOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameTitle, setRenameTitle] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const cadRef = useRef<HTMLInputElement>(null);
  const surveyRef = useRef<Survey | null>(null);
  const saveTimer = useRef<number>(0);
  const engineRef = useRef<DrawingEngine | null>(null);
  const quotingRef = useRef<"idle" | "points" | "offset">("idle");

  const page = survey?.pages.find((p) => p.id === pageId) ?? survey?.pages[0] ?? null;

  const flushSave = useCallback(async () => {
    const s = surveyRef.current;
    if (!s) return;
    setSaveState("saving");
    s.penPrefs = engineRef.current?.prefs ?? s.penPrefs;
    await saveSurvey(s);
    await savePenPrefs(s.penPrefs);
    try {
      await updateSurveyThumbnail(s);
    } catch {
      /* thumbnail is best-effort */
    }
    setSaveState("saved");
  }, []);

  const scheduleSave = useCallback(() => {
    setSaveState("saving");
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void flushSave();
    }, SAVE_MS);
  }, [flushSave]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const loaded = await getSurvey(surveyId);
      if (cancelled) return;
      if (!loaded) {
        setError("Taccuino non trovato");
        return;
      }
      if (!loaded.penPrefs) loaded.penPrefs = { ...DEFAULT_PEN_PREFS };
      const storedPrefs = await loadPenPrefs();
      if (storedPrefs) loaded.penPrefs = { ...loaded.penPrefs, ...storedPrefs };
      loaded.penPrefs.penKind = normalizePenKind(loaded.penPrefs.penKind);
      if (loaded.penPrefs.tool !== "eraser" && loaded.penPrefs.tool !== "select" && loaded.penPrefs.tool !== "measure") {
        loaded.penPrefs.tool = loaded.penPrefs.penKind;
      }
      const first = [...(loaded.pages ?? [])].sort((a, b) => a.order - b.order)[0];
      if (!first) {
        setError("Taccuino senza pagine");
        return;
      }
      const eng = new DrawingEngine(first, loaded.penPrefs);
      engineRef.current = eng;
      surveyRef.current = loaded;
      setPrefs(loaded.penPrefs);
      setPageId(first.id);
      setSurvey(loaded);
      setEngine(eng);
      await hydratePageImages(eng, first);
    })().catch((e) => setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [surveyId]);

  useEffect(() => {
    if (!engine) return;
    return engine.onChange(() => {
      // Mentre la mano lavora non si ridisegna: il foglio è una canvas e si
      // aggiorna da sola. Alla barra basta un attributo, che costa nulla.
      if (shellRef.current) shellRef.current.dataset.live = engine.isLive ? "1" : "0";
      const quoting = engine.quoting;
      if (!engine.isLive || quoting !== quotingRef.current) {
        quotingRef.current = quoting;
        setTick((n) => n + 1);
        if (!engine.isLive) scheduleSave();
      }
    });
  }, [engine, scheduleSave]);

  useEffect(() => {
    if (!engine?.pendingPrint || !page) return;
    const rect = engine.pendingPrint;
    engine.clearPendingPrint();
    void (async () => {
      setBusy("Esporto il riquadro…");
      try {
        await flushSave();
        const blob = await exportWindowPdf(page, rect.a, rect.b);
        downloadBlob(blob, `${fileSlug(surveyRef.current?.title ?? "riquadro")}-riquadro.pdf`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Stampa riquadro non riuscita");
      } finally {
        setBusy(null);
      }
    })();
  }, [engine, engine?.pendingPrint, page, flushSave, tick]);

  useEffect(() => {
    const onHide = () => {
      window.clearTimeout(saveTimer.current);
      void flushSave();
    };
    const onVis = () => {
      if (document.visibilityState === "hidden") onHide();
    };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVis);
      window.clearTimeout(saveTimer.current);
    };
  }, [flushSave]);

  async function editBackground(id: string) {
    await selectPage(id);
    setPageOpen(true);
  }

  function bumpSurvey() {
    const s = surveyRef.current;
    if (!s) return;
    setSurvey({ ...s, pages: [...s.pages] });
    scheduleSave();
  }

  function updatePrefs(patch: Partial<PenPrefs>) {
    const next = { ...prefs, ...patch };
    if (patch.penKind) {
      next.penKind = normalizePenKind(patch.penKind);
      if (next.tool !== "eraser" && next.tool !== "select" && next.tool !== "measure") {
        next.tool = next.penKind;
      }
    }
    if (patch.tool === "highlighter") next.penKind = "highlighter";
    setPrefs(next);
    engine?.setPrefs(next);
    if (surveyRef.current) surveyRef.current.penPrefs = next;
    void savePenPrefs(next);
  }

  async function selectPage(id: string) {
    if (!surveyRef.current || !engine) return;
    await flushSave();
    const next = surveyRef.current.pages.find((p) => p.id === id);
    if (!next) return;
    setPageId(id);
    engine.setPage(next);
    await hydratePageImages(engine, next);
    engine.fitToView();
  }

  function addPage() {
    const s = surveyRef.current;
    if (!s || !page) return;
    const created = createPage(s.pages.length, page.format, page.paper);
    s.pages.push(created);
    bumpSurvey();
    void selectPage(created.id);
  }

  function duplicatePage(id: string) {
    const s = surveyRef.current;
    if (!s) return;
    const src = s.pages.find((p) => p.id === id);
    if (!src) return;
    const copy: SurveyPage = structuredClone(src);
    copy.id = uid();
    copy.title = `${src.title ?? "Pagina"} (copia)`;
    copy.order = s.pages.length;
    copy.elements = copy.elements.map((el) => ({ ...el, id: uid() }));
    s.pages.push(copy);
    bumpSurvey();
    void selectPage(copy.id);
  }

  function deletePage(id: string) {
    const s = surveyRef.current;
    if (!s || s.pages.length < 2) {
      setError("Serve almeno una pagina.");
      return;
    }
    if (!window.confirm("Eliminare questa pagina?")) return;
    s.pages = s.pages.filter((p) => p.id !== id);
    s.pages.forEach((p, i) => {
      p.order = i;
    });
    bumpSurvey();
    const next = s.pages[0];
    void selectPage(next.id);
  }

  function patchPage(patch: { title?: string; format?: PageFormatId; paper?: PagePaper }) {
    if (!page || !engine) return;
    if (patch.title != null) page.title = patch.title;
    if (patch.paper) page.paper = patch.paper;
    if (patch.format) {
      page.format = patch.format;
      page.width = PAGE_FORMATS[patch.format].width;
      page.height = PAGE_FORMATS[patch.format].height;
      engine.fitToView();
    }
    page.updatedAt = new Date().toISOString();
    engine.dirtyFull = true;
    engine.emit();
    bumpSurvey();
  }

  async function addPhoto(blob: Blob, asBackground: boolean) {
    const s = surveyRef.current;
    if (!s || !page || !engine) return;
    setCameraOpen(false);
    setBusy("Salvo la fotografia…");
    try {
      const ingested = await ingestImageFile(blob);
      const original = await putAsset({
        surveyId: s.id,
        kind: "image-original",
        blob: ingested.original,
        name: "foto.jpg",
        mime: ingested.original.type,
        width: ingested.width,
        height: ingested.height,
      });
      const preview = await putAsset({
        surveyId: s.id,
        kind: "image-preview",
        blob: ingested.preview,
        name: "foto-preview.jpg",
        mime: "image/jpeg",
        width: ingested.previewWidth,
        height: ingested.previewHeight,
      });
      const maxW = page.width * 0.78;
      const maxH = page.height * 0.78;
      const scale = Math.min(maxW / ingested.width, maxH / ingested.height, 1);
      const w = ingested.width * scale;
      const h = ingested.height * scale;
      const el: ImageElement = {
        type: "image",
        id: uid(),
        assetId: original.id,
        previewAssetId: preview.id,
        x: (page.width - w) / 2,
        y: (page.height - h) / 2,
        width: w,
        height: h,
        rotation: 0,
        zIndex: 1,
        asBackground: false,
      };
      engine.addElement(el, "Fotografia");
      await hydratePageImages(engine, page);
      if (asBackground) engine.setImageBackground(el.id, true);
      engine.setTool("select");
      setPrefs((p) => ({ ...p, tool: "select" }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Foto non inserita");
    } finally {
      setBusy(null);
    }
  }

  async function addCad(file: File) {
    const s = surveyRef.current;
    if (!s || !page || !engine) return;
    setBusy("Apro il disegno CAD…");
    try {
      const buffer = await file.arrayBuffer();
      const asset = await putAsset({
        surveyId: s.id,
        kind: "cad",
        blob: file,
        name: file.name,
        mime: file.type || "application/octet-stream",
      });
      let parsed;
      try {
        parsed = parseCadFile(file.name, buffer);
      } catch (e) {
        parsed = {
          primitives: [],
          layers: [],
          bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
          unitsPerMm: 1,
          unitsFromFile: false,
        };
        setError(
          e instanceof CadParseError
            ? e.message
            : "DWG binario non letto. Esporta come DXF ASCII per visualizzare geometrie e quote. Il file originale è comunque allegato.",
        );
      }
      const existing = page.elements.find((el) => el.type === "cad");
      if (existing) engine.removeElement(existing.id);
      engine.addElement(cadFromParsed(parsed, asset.id, file.name), "CAD");
      engine.dirtyFull = true;
      engine.emit();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import CAD non riuscito");
    } finally {
      setBusy(null);
    }
  }

  const selectedImage = engine?.selectedId
    ? (page?.elements.find(
        (el): el is ImageElement => el.type === "image" && el.id === engine.selectedId,
      ) ?? null)
    : null;

  const cadLabel = page?.elements.find((el) => el.type === "cad") as CadElement | undefined;

  if (error && !engine) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6">
        <p className="text-danger">{error}</p>
        <Link href="/" className="btn-primary">
          Torna ai taccuini
        </Link>
      </div>
    );
  }

  if (!survey || !page || !engine) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-ink/55">
        Apertura taccuino…
      </div>
    );
  }

  return (
    <div ref={shellRef} className="editor-shell" data-rev={tick} data-save={saveState}>
      <div className="editor-stage">
        <DrawingSurface engine={engine} />

        <div className="chrome-top">
          <button type="button" className="pill-save" onClick={() => void flushSave()}>
            <IconSave className="h-4 w-4" />
            {saveState === "saving" ? "Salvo…" : "Salva"}
          </button>
          <div className="pill-meta">
            <strong>{survey.title}</strong>
            <span>
              pag. {indicePagina(survey, page)} · {saveState === "saved" ? "sul PC" : "locale"}
            </span>
          </div>
          <button type="button" className="pill" onClick={() => setMoreOpen(true)}>
            Progetto
          </button>
          <Link href="/" className="pill" aria-label="Esci">
            <IconBack className="h-4 w-4" />
            Esci
          </Link>
        </div>

        <FloatCard id="tools" title="Strumenti" defaultPos={{ x: 16, y: 72 }} width={248}>
          <ToolCard
            tool={prefs.tool}
            prefs={prefs}
            onPen={() => {
              const kind = normalizePenKind(prefs.penKind);
              updatePrefs({ tool: kind, penKind: kind });
            }}
            onEraser={() => updatePrefs({ tool: "eraser" })}
            onMeasure={() => updatePrefs({ tool: "measure" })}
            onSelect={() => updatePrefs({ tool: "select" })}
            onCamera={() => setCameraOpen(true)}
            onPrefs={updatePrefs}
          />
        </FloatCard>

        <FloatCard id="cad" title="Disegno CAD" defaultPos={{ x: 16, y: 72 }} width={268} anchor="right">
          <CadDock
            cad={cadLabel}
            printMode={!!engine.printMode}
            scaleMode={!!engine.scaleMode}
            onToggleLayer={(name) => {
              engine.toggleLayer(name);
              bumpSurvey();
            }}
            onToggleHatches={() => {
              engine.toggleHatches();
              bumpSurvey();
            }}
            onPrintWindow={() => engine.setPrintMode(true)}
            onCalibrate={() => engine.setScaleMode(true)}
            onUnitKind={(kind) => {
              engine.setCadUnitKind(kind);
              bumpSurvey();
            }}
            onScaleFactor={(factor) => {
              engine.setCadScaleFactor(factor);
              bumpSurvey();
            }}
            onResetScale={() => {
              engine.resetCadScaleFromFile();
              bumpSurvey();
            }}
            onImportCad={() => cadRef.current?.click()}
          />
        </FloatCard>

        <FloatCard id="pages" title="Pagine" defaultPos={{ x: 16, y: 520 }} width={104}>
          <PageDock
            pages={survey.pages}
            currentId={page.id}
            onSelect={(id) => void selectPage(id)}
            onAdd={addPage}
            onEditBackground={(id) => void editBackground(id)}
          />
        </FloatCard>

        <div className="chrome-bottom">
          <button
            type="button"
            className="round-btn"
            disabled={!engine.history.canUndo}
            onClick={() => engine.undo()}
            title="Annulla"
          >
            <IconUndo className="h-5 w-5" />
          </button>
          <button
            type="button"
            className="round-btn"
            disabled={!engine.history.canRedo}
            onClick={() => engine.redo()}
            title="Ripeti"
          >
            <IconRedo className="h-5 w-5" />
          </button>
          <button type="button" className="round-btn" onClick={() => engine.fitToView()} title="Adatta">
            <IconFit className="h-5 w-5" />
          </button>
          <button type="button" className="round-btn" onClick={() => engine.setZoom(1)} title="100%">
            <IconZoomIn className="h-5 w-5" />
          </button>
          <button type="button" className="round-btn" onClick={() => imageRef.current?.click()} title="Immagine">
            Foto
          </button>
        </div>

        {selectedImage ? (
          <div className="image-float">
            <button type="button" onClick={() => engine.bringImage(selectedImage.id, "back")}>
              Indietro
            </button>
            <button type="button" onClick={() => engine.bringImage(selectedImage.id, "front")}>
              Avanti
            </button>
            <button
              type="button"
              onClick={() => engine.setImageBackground(selectedImage.id, !selectedImage.asBackground)}
            >
              {selectedImage.asBackground ? "Togli sfondo" : "Sfondo"}
            </button>
            <button
              type="button"
              className="text-red-200"
              onClick={() => engine.removeElement(selectedImage.id, "Elimina foto")}
            >
              Elimina
            </button>
          </div>
        ) : null}
        {error ? (
          <div className="toast toast-warn">
            {error}{" "}
            <button type="button" className="underline" onClick={() => setError(null)}>
              chiudi
            </button>
          </div>
        ) : null}
        {busy ? <div className="toast">{busy}</div> : null}
        {engine.printMode ? (
          <div className="hint-pill">Traccia il riquadro da stampare</div>
        ) : null}
        {engine.scaleMode ? (
          <div className="hint-pill">Due estremi, poi la misura vera</div>
        ) : null}
        {prefs.tool === "measure" && engine.quoting === "points" ? (
          <div className="hint-pill">Secondo estremo</div>
        ) : null}
        {prefs.tool === "measure" && engine.quoting === "offset" ? (
          <div className="hint-pill">Click sopra/sotto · tasto destro: prossima</div>
        ) : null}
        {engine.pendingScale ? (
          <MeasurePad
            caption="Lunghezza vera di questo tratto"
            withLengthUnit
            onConfirm={(value, unit) => {
              engine.confirmPendingScale(value, unit ?? "m");
              bumpSurvey();
            }}
            onCancel={() => engine.cancelPendingScale()}
          />
        ) : engine.pendingMeasure ? (
          <MeasurePad
            freeText
            onConfirm={(value) => engine.confirmPendingMeasure(value)}
            onCancel={() => engine.cancelPendingMeasure()}
          />
        ) : (
          <SelectionBar engine={engine} />
        )}
      </div>

      <input
        ref={imageRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void addPhoto(f, false);
          e.target.value = "";
        }}
      />
      <input
        ref={cadRef}
        type="file"
        accept=".dxf,.dwg,image/vnd.dxf,application/dxf,application/acad,application/x-dxf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void addCad(f);
          e.target.value = "";
        }}
      />

      <CameraSheet
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={(blob, asBg) => void addPhoto(blob, asBg)}
      />
      <PageSettings
        open={pageOpen}
        page={page}
        onClose={() => setPageOpen(false)}
        onChange={patchPage}
        onDuplicate={() => {
          if (page) duplicatePage(page.id);
          setPageOpen(false);
        }}
        onDelete={() => {
          if (page) deletePage(page.id);
          setPageOpen(false);
        }}
      />
      <MoreMenu
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        onRename={() => {
          setMoreOpen(false);
          setRenameTitle(survey.title);
          setRenameOpen(true);
        }}
        onDuplicate={async () => {
          setMoreOpen(false);
          const copy = await duplicateSurvey(survey.id);
          if (copy) router.push(`/survey/${copy.id}`);
        }}
        onExportPdf={async () => {
          setMoreOpen(false);
          setBusy("Esporto PDF…");
          try {
            await flushSave();
            const blob = await exportSurveyPdf(surveyRef.current!);
            downloadBlob(blob, `${fileSlug(survey.title)}.pdf`);
          } catch (e) {
            setError(e instanceof Error ? e.message : "PDF non creato");
          } finally {
            setBusy(null);
          }
        }}
        onExportImages={async () => {
          setMoreOpen(false);
          setBusy("Esporto immagini…");
          try {
            await flushSave();
            const blob = await exportSurveyImages(surveyRef.current!, "png");
            downloadBlob(blob, `${fileSlug(survey.title)}-pagine.zip`);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Export immagini non riuscito");
          } finally {
            setBusy(null);
          }
        }}
        onExportProject={async () => {
          setMoreOpen(false);
          setBusy("Esporto progetto…");
          try {
            await flushSave();
            const blob = await exportProject(surveyRef.current!);
            downloadBlob(blob, `${fileSlug(survey.title)}.srilievo`);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Export progetto non riuscito");
          } finally {
            setBusy(null);
          }
        }}
        onDelete={() => {
          setMoreOpen(false);
          setDeleteOpen(true);
        }}
      />

      <Dialog open={renameOpen} title="Rinomina taccuino" onClose={() => setRenameOpen(false)}>
        <Field label="Titolo">
          <input
            className="input"
            value={renameTitle}
            onChange={(e) => setRenameTitle(e.target.value)}
          />
        </Field>
        <button
          type="button"
          className="btn-primary mt-3 w-full"
          onClick={() => {
            if (surveyRef.current) surveyRef.current.title = renameTitle.trim() || surveyRef.current.title;
            setRenameOpen(false);
            bumpSurvey();
          }}
        >
          Salva
        </button>
      </Dialog>

      <ConfirmDialog
        open={deleteOpen}
        title="Eliminare il taccuino?"
        body="Il taccuino verrà rimosso da questo dispositivo. Esporta prima il progetto se ti serve."
        onClose={() => setDeleteOpen(false)}
        onConfirm={async () => {
          await deleteSurvey(survey.id);
          router.push("/");
        }}
      />
    </div>
  );
}

function indicePagina(survey: Survey | null, page: SurveyPage | null): string {
  if (!survey || !page) return "—";
  const ordinate = [...survey.pages].sort((a, b) => a.order - b.order);
  return `${ordinate.findIndex((p) => p.id === page.id) + 1} di ${ordinate.length}`;
}
