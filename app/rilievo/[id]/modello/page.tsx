import { redirect } from "next/navigation";

export default async function ModelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/rilievo/${id}/risultati`);
}
