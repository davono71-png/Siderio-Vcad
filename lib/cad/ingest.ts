import type { CadElement, Survey } from "../models/types";
import { uid } from "../ids";
import { putAsset } from "../db/assets";
import { createAndSaveSurvey, saveSurvey } from "../db/surveys";
import { parseCadFile, type ParsedCad } from "./parse";
import { unitKindFromUnitsPerMm } from "./units";

export function cadFromParsed(
  parsed: ParsedCad,
  assetId: string,
  fileName: string,
): CadElement {
  return {
    type: "cad",
    id: uid(),
    assetId,
    fileName,
    sourceFormat: fileName.toLowerCase().endsWith(".dwg") ? "dwg" : "dxf",
    primitives: parsed.primitives,
    layers: parsed.layers ?? [],
    hideHatches: false,
    bounds: parsed.bounds,
    unitsPerMm: parsed.unitsPerMm,
    sourceUnitsPerMm: parsed.unitsPerMm,
    unitsFromFile: parsed.unitsFromFile,
    scaleFactor: 1,
    unitKind: parsed.unitsFromFile
      ? unitKindFromUnitsPerMm(parsed.unitsPerMm)
      : undefined,
    quoteUnit: "m",
    locked: true,
  };
}

/** Un solo salvataggio: parse prima, poi taccuino già con il disegno. */
export async function createSurveyFromCad(file: File): Promise<Survey> {
  const buffer = await file.arrayBuffer();
  const parsed = parseCadFile(file.name, buffer);
  const title = file.name.replace(/\.[^.]+$/, "") || "Disegno";
  const survey = await createAndSaveSurvey({ title });
  const asset = await putAsset({
    surveyId: survey.id,
    kind: "cad",
    blob: file,
    name: file.name,
    mime: file.type || "application/octet-stream",
  });
  const page = survey.pages[0];
  if (!page) throw new Error("Taccuino senza pagine");
  page.elements.push(cadFromParsed(parsed, asset.id, file.name));
  page.updatedAt = new Date().toISOString();
  await saveSurvey(survey);
  return survey;
}

/** Mette un DXF/DWG sulla prima pagina e salva. Usato dall'editor. */
export async function attachCadFile(survey: Survey, file: File): Promise<Survey> {
  const buffer = await file.arrayBuffer();
  const parsed = parseCadFile(file.name, buffer);
  const asset = await putAsset({
    surveyId: survey.id,
    kind: "cad",
    blob: file,
    name: file.name,
    mime: file.type || "application/octet-stream",
  });
  const page = [...survey.pages].sort((a, b) => a.order - b.order)[0];
  if (!page) throw new Error("Taccuino senza pagine");
  page.elements = page.elements.filter((el) => el.type !== "cad");
  page.elements.push(cadFromParsed(parsed, asset.id, file.name));
  page.updatedAt = new Date().toISOString();
  await saveSurvey(survey);
  return survey;
}
