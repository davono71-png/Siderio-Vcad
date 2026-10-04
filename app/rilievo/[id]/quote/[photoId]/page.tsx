import type { Metadata } from "next";
import { Annotator } from "@/components/measure/Annotator";

export const metadata: Metadata = {
  title: "Punto · Siderio",
};

export default async function AnnotatePage({
  params,
}: {
  params: Promise<{ id: string; photoId: string }>;
}) {
  const { id, photoId } = await params;
  return <Annotator projectId={id} photoId={photoId} />;
}
