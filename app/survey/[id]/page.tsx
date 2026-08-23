import { EditorScreen } from "@/components/editor/EditorScreen";

export default async function SurveyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <EditorScreen surveyId={id} />;
}
