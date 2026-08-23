const DATE_FMT = new Intl.DateTimeFormat("it-IT", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const DATE_TIME_FMT = new Intl.DateTimeFormat("it-IT", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return DATE_FMT.format(d);
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return DATE_TIME_FMT.format(d);
}

export function formatPageCount(n: number): string {
  return n === 1 ? "1 pagina" : `${n} pagine`;
}

export function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function formatLength(mm: number, unit: "mm" | "cm" | "m" = "m"): string {
  if (unit === "m") return `${(mm / 1000).toFixed(2)} m`;
  if (unit === "cm") return `${(mm / 10).toFixed(1)} cm`;
  return `${mm.toFixed(0)} mm`;
}

export function formatMm(mm: number): string {
  if (mm >= 1000) return formatLength(mm, "m");
  if (mm >= 10) return formatLength(mm, "cm");
  return formatLength(mm, "mm");
}
