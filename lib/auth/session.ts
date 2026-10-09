import { createHash, createHmac, timingSafeEqual } from "crypto";

export const ACCESS_COOKIE = "siderio_access";
const MAX_AGE_SECONDS = 60 * 24 * 60 * 60;

export type AccessState = "ok" | "unconfigured" | "unauthorized";

export function accessCode() {
  return process.env.APP_ACCESS_CODE?.trim() ?? "";
}

function sessionSecret() {
  const explicit = process.env.APP_SESSION_SECRET?.trim() ?? "";
  if (explicit) return explicit;
  const code = accessCode();
  if (!code) return "";
  return createHash("sha256").update(`siderio-session:${code}`).digest("hex");
}

export function codesMatch(input: string) {
  const expected = accessCode();
  const given = input.trim();
  const left = Buffer.from(given);
  const right = Buffer.from(expected);
  if (!expected || left.length !== right.length) {
    timingSafeEqual(right, right);
    return false;
  }
  return timingSafeEqual(left, right);
}

export function signSession(now = Date.now()) {
  const secret = sessionSecret();
  if (!secret) throw new Error("unconfigured");
  const payload = Buffer.from(JSON.stringify({ exp: now + MAX_AGE_SECONDS * 1000 })).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifySession(token: string | undefined | null, now = Date.now()) {
  const secret = sessionSecret();
  if (!secret || !token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return false;
  try {
    const body = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: unknown };
    return typeof body.exp === "number" && body.exp > now;
  } catch {
    return false;
  }
}

export function accessState(token: string | undefined | null, now = Date.now()): AccessState {
  if (!accessCode()) return "unconfigured";
  return verifySession(token, now) ? "ok" : "unauthorized";
}

export function readCookie(request: Request, name: string) {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    if (trimmed.slice(0, eq) === name) return decodeURIComponent(trimmed.slice(eq + 1));
  }
  return undefined;
}

export function requireAccess(request: Request): Response | null {
  const state = accessState(readCookie(request, ACCESS_COOKIE));
  if (state === "ok") return null;
  return Response.json(
    { ok: false, code: state },
    { status: state === "unconfigured" ? 503 : 401, headers: { "cache-control": "no-store" } },
  );
}

export function sessionCookie(token: string, request: Request) {
  const forwarded = request.headers.get("x-forwarded-proto");
  const secure = forwarded === "https" || new URL(request.url).protocol === "https:";
  const parts = [
    `${ACCESS_COOKIE}=${encodeURIComponent(token)}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${MAX_AGE_SECONDS}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearCookie(request: Request) {
  const forwarded = request.headers.get("x-forwarded-proto");
  const secure = forwarded === "https" || new URL(request.url).protocol === "https:";
  const parts = [`${ACCESS_COOKIE}=`, "HttpOnly", "Path=/", "SameSite=Lax", "Max-Age=0"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}
