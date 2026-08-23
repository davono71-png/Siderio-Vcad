import type {
  PageFormatId,
  PagePaper,
  PenKind,
  PenPrefs,
  Survey,
  SurveyLink,
  SurveyPage,
} from "./types";
import { uid } from "../ids";

export const INK_COLORS = [
  { id: "black", value: "#1A2332", label: "Nero" },
  { id: "red", value: "#C62828", label: "Rosso" },
  { id: "blue", value: "#1565C0", label: "Blu" },
  { id: "green", value: "#2E7D32", label: "Verde" },
  { id: "orange", value: "#F3752C", label: "Arancione" },
  { id: "yellow", value: "#F9A825", label: "Giallo" },
  { id: "gray", value: "#78909C", label: "Grigio" },
  { id: "white", value: "#FFFFFF", label: "Bianco" },
] as const;

export const TECHNICAL_WIDTHS = [1, 2, 4, 6, 10] as const;
export const HIGHLIGHTER_WIDTHS = [10, 20, 30] as const;
export const ERASER_SIZES = [8, 16, 28, 48] as const;

/** RAL 2008 Bright Red Orange: accento UI al posto del viola RAL 4007. */
export const RAL_2008 = "#F3752C";

export const NOTEBOOK_COLORS = [
  "#F3752C",
  "#E85D04",
  "#D35400",
  "#C2410C",
  "#EA580C",
  "#9A3412",
] as const;

export const PAGE_FORMATS: Record<
  PageFormatId,
  { width: number; height: number; label: string }
> = {
  free: { width: 1600, height: 1200, label: "Pagina libera" },
  "a4-portrait": { width: 1240, height: 1754, label: "A4 verticale" },
  "a4-landscape": { width: 1754, height: 1240, label: "A4 orizzontale" },
};

export const PAGE_PAPERS: { id: PagePaper; label: string }[] = [
  { id: "blank", label: "Bianca" },
  { id: "lined", label: "Righe" },
  { id: "grid", label: "Quadretti" },
];

export const PEN_STYLES: { id: Exclude<PenKind, "technical" | "free">; label: string }[] = [
  { id: "ballpoint", label: "Sfera" },
  { id: "fountain", label: "Stilografica" },
  { id: "pencil", label: "Matita" },
  { id: "highlighter", label: "Evidenziatore" },
];

export const DEFAULT_PEN_PREFS: PenPrefs = {
  tool: "ballpoint",
  penKind: "ballpoint",
  color: "#1A2332",
  width: 2,
  highlighterWidth: 20,
  eraserMode: "stroke",
  eraserSize: 16,
};

export function normalizePenKind(kind: PenKind): Exclude<PenKind, "technical" | "free"> {
  if (kind === "technical") return "ballpoint";
  if (kind === "free") return "fountain";
  return kind;
}

export function defaultWidthFor(kind: PenKind, prefs: PenPrefs): number {
  const k = normalizePenKind(kind);
  if (k === "highlighter") return prefs.highlighterWidth;
  if (k === "pencil") return Math.min(prefs.width, 2);
  return prefs.width;
}

export function createPage(
  order: number,
  format: PageFormatId = "a4-portrait",
  paper: PagePaper = "blank",
  title?: string,
): SurveyPage {
  const size = PAGE_FORMATS[format];
  const now = new Date().toISOString();
  return {
    id: uid(),
    title: title ?? `Pagina ${order + 1}`,
    order,
    format,
    paper,
    width: size.width,
    height: size.height,
    elements: [],
    updatedAt: now,
  };
}

export function createSurvey(input: {
  title: string;
  client?: string;
  offerNo?: string;
  jobNo?: string;
  description?: string;
  date?: string;
  ownerId?: string;
  link?: SurveyLink;
}): Survey {
  const now = new Date().toISOString();
  const date = input.date ?? now.slice(0, 10);
  const color =
    NOTEBOOK_COLORS[Math.floor(Math.random() * NOTEBOOK_COLORS.length)];
  return {
    id: uid(),
    title: input.title.trim() || "Taccuino senza titolo",
    client: input.client?.trim() || undefined,
    offerNo: input.offerNo?.trim() || undefined,
    jobNo: input.jobNo?.trim() || undefined,
    description: input.description?.trim() || undefined,
    date,
    createdAt: now,
    updatedAt: now,
    coverColor: color,
    pages: [createPage(0)],
    penPrefs: { ...DEFAULT_PEN_PREFS },
    ownerId: input.ownerId,
    link: input.link,
    dirty: true,
  };
}
