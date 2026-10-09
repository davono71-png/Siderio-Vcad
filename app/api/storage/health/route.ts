import { checkBucket } from "@/lib/storage/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Presence and reachability of R2. Never returns env values. */
export async function GET() {
  const result = await checkBucket();
  return Response.json(
    { ok: result.ok, code: result.code },
    { status: result.ok ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
