import type { Metadata } from "next";
import { ModelScreen } from "@/components/project/ModelScreen";

export const metadata: Metadata = {
  title: "Modello · Siderio",
};

export default async function ModelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ModelScreen projectId={id} />;
}
