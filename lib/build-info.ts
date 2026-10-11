const MONTHS = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];

export const BUILD_ID = (process.env.NEXT_PUBLIC_BUILD_ID || "local").slice(0, 12);
export const BUILD_DATE = process.env.NEXT_PUBLIC_BUILD_DATE || "";

export function formatBuildDate(iso: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return "";
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) return "";
  return `${Number(match[3])} ${month} ${match[1]}`;
}

/** Short commit plus the commit date, for the footer. */
export function versionLabel() {
  const date = formatBuildDate(BUILD_DATE);
  return date ? `${BUILD_ID} · ${date}` : BUILD_ID;
}
