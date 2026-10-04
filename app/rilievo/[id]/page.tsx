import type { Metadata } from "next";
import { ProjectScreen } from "@/components/project/ProjectScreen";

export const metadata: Metadata = {
  title: "Rilievo · Siderio",
};

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProjectScreen projectId={id} />;
}
