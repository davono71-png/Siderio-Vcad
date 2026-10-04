import type { Metadata } from "next";
import { NewProjectScreen } from "@/components/project/NewProjectScreen";

export const metadata: Metadata = {
  title: "Nuovo rilievo · Siderio",
};

export default function NewProjectPage() {
  return <NewProjectScreen />;
}
