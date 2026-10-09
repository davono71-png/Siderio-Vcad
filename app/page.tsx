import type { Metadata } from "next";
import { HomeScreen } from "@/components/home/HomeScreen";

export const metadata: Metadata = {
  title: "Rilievi · Siderio",
};

export default function Home() {
  return <HomeScreen />;
}
