/** Core document model. Keep elements structured — never flatten ink onto photos/CAD. */

/** ballpoint=sfera, fountain=stilografica; technical/free kept for older taccuini. */
export type PenKind = "ballpoint" | "fountain" | "highlighter" | "pencil" | "technical" | "free";
export type DrawTool = PenKind | "eraser" | "select" | "measure";
export type EraserMode = "stroke" | "free";
export type PageFormatId = "free" | "a4-portrait" | "a4-landscape";
export type PagePaper = "blank" | "lined" | "grid";
export type CadFormat = "dxf" | "dwg";

export type Point = {
  x: number;
  y: number;
  /** Pointer pressure 0–1 when available. */
  p?: number;
  t?: number;
};

export type StrokeStyle = {
  tool: PenKind | "eraser";
  color: string;
  width: number;
  opacity: number;
};

export type StrokeElement = {
  type: "stroke";
  id: string;
  style: StrokeStyle;
  points: Point[];
  /** Free-eraser strokes punch holes without deleting source strokes. */
  composite?: "source-over" | "destination-out";
};

export type ImageElement = {
  type: "image";
  id: string;
  assetId: string;
  previewAssetId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  zIndex: number;
  asBackground?: boolean;
};

export type CadLayer = {
  name: string;
  color: string;
  visible: boolean;
};

type CadBase = { id: string; layer: string; color: string };

export type CadPrimitive =
  | (CadBase & {
      kind: "line";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
    })
  | (CadBase & {
      kind: "circle";
      cx: number;
      cy: number;
      r: number;
    })
  | (CadBase & {
      kind: "arc";
      cx: number;
      cy: number;
      r: number;
      start: number;
      end: number;
    })
  | (CadBase & {
      kind: "polyline";
      points: { x: number; y: number }[];
      closed: boolean;
    })
  | (CadBase & {
      kind: "text";
      x: number;
      y: number;
      height: number;
      rotation: number;
      value: string;
    })
  | (CadBase & {
      kind: "hatch";
      solid: boolean;
      loops: { x: number; y: number }[][];
    });

export type LengthUnit = "mm" | "cm" | "m";
export type CadUnitKind = LengthUnit | "custom";
export type QuoteShape = "length" | "radius" | "diameter";

export type CadElement = {
  type: "cad";
  id: string;
  assetId: string;
  fileName: string;
  sourceFormat: CadFormat;
  primitives: CadPrimitive[];
  layers?: CadLayer[];
  /** Campiture (HATCH) spente con un comando. */
  hideHatches?: boolean;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  /** Unità di disegno per millimetro (dal file o scelta a mano). */
  unitsPerMm: number;
  /** Valore letto dal DXF, per ripristinare. */
  sourceUnitsPerMm?: number;
  /** True se $INSUNITS era mm/cm/m/inch. False = disegno puro, scala da impostare. */
  unitsFromFile?: boolean;
  /**
   * Moltiplicatore sulle quote. 1 = come le unità. 100 = disegno 1:100
   * (unità carta). Si usa quando non c'è un riferimento nel file.
   */
  scaleFactor?: number;
  unitKind?: CadUnitKind;
  /**
   * Unità con cui si scrivono le quote. È indipendente da `unitsPerMm`
   * quando il file ha già `$INSUNITS`: mm/cm/m cambiano solo l'etichetta.
   */
  quoteUnit?: LengthUnit;
  locked: true;
};

/**
 * Quota vera: due estremi agganciati a entità DXF, valore dalla scala del
 * disegno, linee e cifra verdi. Si può riscrivere un valore che va sotto,
 * tra parentesi, senza toccare l'originale.
 *
 * Quota inserita: nessun aggancio — solo il testo dell'utente, tutto rosso.
 */
export type MeasureKind = "true" | "inserted";

export type MeasureElement = {
  type: "measure";
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  kind?: MeasureKind;
  /** Lunghezza reale in millimetri. Solo sulle quote vere. */
  mm: number;
  /** Cifra originale (vera) oppure testo inserito. */
  label: string;
  /** Valore riscritto: si mostra sotto, tra parentesi, e non sostituisce `label`. */
  note?: string;
  entityA?: string;
  entityB?: string;
  /** Raggio / diametro se gli estremi stanno su un cerchio o un arco. */
  quoteShape?: QuoteShape;
  /**
   * Scostamento della linea di quota, perpendicolare al tratto misurato.
   * I due estremi restano agganciati; il terzo click lo imposta sopra/sotto.
   */
  off?: number;
};

/**
 * Future element kinds (not in V1): text, arrows, rectangles, ellipses,
 * survey quotes, symbols, PDF backgrounds.
 */
export type PageElement = StrokeElement | ImageElement | CadElement | MeasureElement;

export type SurveyPage = {
  id: string;
  title?: string;
  order: number;
  format: PageFormatId;
  paper: PagePaper;
  width: number;
  height: number;
  elements: PageElement[];
  updatedAt: string;
};

export type PenPrefs = {
  tool: DrawTool;
  penKind: PenKind;
  color: string;
  width: number;
  highlighterWidth: number;
  eraserMode: EraserMode;
  eraserSize: number;
};

/**
 * Collegamento opzionale conservato solo per i file `.srilievo` vecchi.
 * Vcad non parla con la Suite: non si crea e non si mostra.
 */
export type SurveyLink = {
  kind: "commessa" | "offerta";
  /** `public.commesse.id` (bigint). */
  commessaId?: number;
  numeroCommessa?: string;
  /** `public.offers.id` (uuid). */
  offertaId?: string;
  numeroOfferta?: string;
  /** `public.clients.id` (uuid). */
  clienteId?: string;
  /** Denormalizzato: serve a mostrare il nome anche senza rete. */
  cliente?: string;
  linkedAt: string;
};

export type Survey = {
  id: string;
  title: string;
  description?: string;
  /** Testo libero, superato da `link`. Resta per i taccuini creati prima. */
  client?: string;
  offerNo?: string;
  jobNo?: string;
  /** Survey date (editable), ISO date `YYYY-MM-DD`. */
  date: string;
  createdAt: string;
  updatedAt: string;
  coverColor: string;
  thumbnailAssetId?: string;
  pages: SurveyPage[];
  penPrefs: PenPrefs;
  /** `auth.users.id`. Assente = creato prima dell'accesso, da adottare. */
  ownerId?: string;
  link?: SurveyLink;
  /** Modificato dopo l'ultima risalita. */
  dirty?: boolean;
  syncedAt?: string;
  /** Con quale versione della risalita e' stato caricato l'ultima volta. */
  syncedWith?: number;
};

export type AssetKind = "image-original" | "image-preview" | "cad" | "thumbnail";

export type AssetRecord = {
  id: string;
  surveyId: string;
  kind: AssetKind;
  mime: string;
  name: string;
  byteSize: number;
  width?: number;
  height?: number;
  createdAt: string;
};

export type SurveyListItem = {
  id: string;
  title: string;
  description?: string;
  date: string;
  updatedAt: string;
  pageCount: number;
  coverColor: string;
  thumbnailObjectUrl?: string;
};
