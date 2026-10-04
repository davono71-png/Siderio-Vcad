import { checkPresign, type PresignInput } from "@/lib/storage/keys";
import { presignObject, StorageConfigError } from "@/lib/storage/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Short-lived PUT/GET URLs for rilievi/<uuid>/… only.
 * There is no user auth yet (Supabase Auth comes later). Inputs are checked
 * so this is not a general write proxy: jpeg or project.json, size cap, 10 min.
 */

const hits = new Map<string, number[]>();

function clientIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

function allowed(ip: string) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((stamp) => now - stamp < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length <= 120;
}

export async function POST(request: Request) {
  if (!allowed(clientIp(request))) {
    return Response.json({ ok: false, code: "rate_limited" }, { status: 429, headers: { "cache-control": "no-store" } });
  }

  let body: PresignInput;
  try {
    body = (await request.json()) as PresignInput;
  } catch {
    return Response.json({ ok: false, code: "bad_json" }, { status: 400, headers: { "cache-control": "no-store" } });
  }

  const check = checkPresign({
    op: body?.op,
    key: typeof body?.key === "string" ? body.key : "",
    contentType: typeof body?.contentType === "string" ? body.contentType : undefined,
    contentLength: typeof body?.contentLength === "number" ? body.contentLength : undefined,
  });
  if (!check.ok) {
    return Response.json({ ok: false, code: check.code }, { status: 400, headers: { "cache-control": "no-store" } });
  }

  try {
    const signed = await presignObject({
      op: body.op === "get" ? "get" : "put",
      key: body.key,
      contentType: body.contentType,
      contentLength: body.contentLength,
    });
    return Response.json(
      { ok: true, url: signed.url, key: body.key, expiresIn: signed.expiresIn },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof StorageConfigError) {
      return Response.json(
        { ok: false, code: error.code },
        { status: 503, headers: { "cache-control": "no-store" } },
      );
    }
    return Response.json({ ok: false, code: "unreachable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
