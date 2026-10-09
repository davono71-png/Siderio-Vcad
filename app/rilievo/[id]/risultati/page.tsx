import type { Metadata } from "next";
import { ResultsScreen } from "@/components/results/ResultsScreen";

export const metadata: Metadata = {
  title: "Risultati · Siderio",
};

export default async function ResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ResultsScreen projectId={id} />;
}
