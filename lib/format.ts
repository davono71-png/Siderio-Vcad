import type { ProjectKind } from "./data/types";

export function formatWhen(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("it-IT", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatMm(value: number) {
  return `${new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0 }).format(value)} mm`;
}

export function kindLabel(kind: ProjectKind) {
  return kind === "facciata" ? "Facciata" : "Stanza";
}

export function nextPointLabel(used: string[]) {
  const taken = new Set(used.map((label) => label.toUpperCase()));
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  for (const letter of alphabet) {
    if (!taken.has(letter)) return letter;
  }
  for (let n = 2; n < 40; n += 1) {
    for (const letter of alphabet) {
      const label = `${letter}${n}`;
      if (!taken.has(label)) return label;
    }
  }
  return `P${used.length + 1}`;
}

export function safeFileName(name: string) {
  const cleaned = name
    .trim()
    .replace(/[^\p{L}\p{N}_-]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned || "rilievo";
}

export function sequenceName(index: number) {
  return `${String(index).padStart(3, "0")}.jpg`;
}
