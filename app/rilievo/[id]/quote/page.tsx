import type { Metadata } from "next";
import { QuoteScreen } from "@/components/measure/QuoteScreen";

export const metadata: Metadata = {
  title: "Quote · Siderio",
};

export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <QuoteScreen projectId={id} />;
}
