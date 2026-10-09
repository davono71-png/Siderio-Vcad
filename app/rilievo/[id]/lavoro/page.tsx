import type { Metadata } from "next";
import { WorkScreen } from "@/components/project/WorkScreen";

export const metadata: Metadata = {
  title: "Lavoro · Siderio",
};

export default async function WorkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <WorkScreen projectId={id} />;
}
