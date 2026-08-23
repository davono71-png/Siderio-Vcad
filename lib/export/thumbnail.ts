import type { Survey } from "../models/types";
import { putAsset } from "../db/assets";
import { saveSurvey } from "../db/surveys";
import { pageToCanvas } from "./page-canvas";
import { canvasToJpeg } from "../media/image";

export async function updateSurveyThumbnail(survey: Survey): Promise<void> {
  const first = [...survey.pages].sort((a, b) => a.order - b.order)[0];
  if (!first) return;
  const canvas = await pageToCanvas(first, 0.22);
  const blob = await canvasToJpeg(canvas, 0.7);
  const asset = await putAsset({
    id: survey.thumbnailAssetId,
    surveyId: survey.id,
    kind: "thumbnail",
    blob,
    name: "thumb.jpg",
    mime: "image/jpeg",
  });
  survey.thumbnailAssetId = asset.id;
  await saveSurvey(survey);
}
