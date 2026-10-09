import { accessCode, accessState, clearCookie, codesMatch, readCookie, sessionCookie, signSession, ACCESS_COOKIE } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "cache-control": "no-store" };

export async function GET(request: Request) {
  const state = accessState(readCookie(request, ACCESS_COOKIE));
  if (state === "ok") return Response.json({ ok: true }, { headers });
  return Response.json({ ok: false, code: state }, { status: state === "unconfigured" ? 503 : 401, headers });
}

export async function POST(request: Request) {
  if (!accessCode()) {
    return Response.json({ ok: false, code: "unconfigured" }, { status: 503, headers });
  }
  let code = "";
  try {
    const body = (await request.json()) as { code?: unknown };
    code = typeof body.code === "string" ? body.code : "";
  } catch {
    return Response.json({ ok: false, code: "bad_json" }, { status: 400, headers });
  }
  if (!codesMatch(code)) {
    return Response.json({ ok: false, code: "bad_code" }, { status: 401, headers });
  }
  return Response.json(
    { ok: true },
    { headers: { ...headers, "set-cookie": sessionCookie(signSession(), request) } },
  );
}

export async function DELETE(request: Request) {
  return Response.json({ ok: true }, { headers: { ...headers, "set-cookie": clearCookie(request) } });
}
