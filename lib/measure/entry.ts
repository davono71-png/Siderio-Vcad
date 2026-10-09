/** Millimetre buffer edited by the in-app keypad. Italian decimal comma, one fractional digit. */

const MAX_WHOLE = 6;

export function editMillimetres(value: string, key: "back" | "clear" | "comma" | string) {
  if (key === "back") return value.slice(0, -1);
  if (key === "clear") return "";
  if (key === "comma") {
    if (value.includes(",")) return value;
    return `${value || "0"},`;
  }
  if (!/^\d$/.test(key)) return value;
  const [whole, fraction] = value.split(",");
  if (fraction !== undefined) {
    if (fraction.length >= 1) return value;
    return value + key;
  }
  if (whole.length >= MAX_WHOLE) return value;
  if (whole === "0") return key;
  return value + key;
}

export function parsePointName(value: string) {
  const match = /^([A-Za-z])(\d{0,2})$/.exec(value.trim());
  if (!match) return null;
  const suffix = match[2] ? Number(match[2]) : 0;
  if (suffix > 39) return null;
  return { letter: match[1].toUpperCase(), suffix };
}

export function pointNameFromLetter(letter: string, suffix: number) {
  const clean = letter.toUpperCase().slice(0, 1);
  if (!/^[A-Z]$/.test(clean)) return "";
  if (suffix <= 0) return clean;
  return `${clean}${Math.min(39, suffix)}`;
}

/** Tapping A–Z keeps a suffix only when the same letter is already selected. */
export function withLetter(current: string, letter: string) {
  const parsed = parsePointName(current);
  const suffix = parsed?.letter === letter.toUpperCase() ? parsed.suffix : 0;
  return pointNameFromLetter(letter, suffix);
}

/** The + chip: A → A1 → A2, capped so names stay short. */
export function withNextSuffix(current: string) {
  const parsed = parsePointName(current);
  if (parsed) return pointNameFromLetter(parsed.letter, parsed.suffix + 1);
  const initial = current.trim().charAt(0).toUpperCase();
  const letter = /^[A-Z]$/.test(initial) ? initial : "A";
  return pointNameFromLetter(letter, 1);
}
