import type { Metadata } from "next";
import { AcquireScreen } from "@/components/acquire/AcquireScreen";

export const metadata: Metadata = {
  title: "Acquisizione · Siderio",
};

export default async function AcquirePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AcquireScreen projectId={id} />;
}
