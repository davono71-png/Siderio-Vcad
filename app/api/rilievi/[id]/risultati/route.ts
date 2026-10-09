import { isUuid } from "@/lib/storage/keys";
import { configError, loadResults } from "@/lib/results/load";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "cache-control": "no-store" };

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!isUuid(id)) {
    return Response.json({ ok: false, code: "bad_id" }, { status: 400, headers });
  }
  try {
    const payload = await loadResults(id);
    return Response.json(payload, { headers });
  } catch (error) {
    const code = configError(error);
    if (code) return Response.json({ ok: false, code }, { status: 503, headers });
    if (error instanceof Error && error.message === "bad_id") {
      return Response.json({ ok: false, code: "bad_id" }, { status: 400, headers });
    }
    return Response.json({ ok: false, code: "unreachable" }, { status: 503, headers });
  }
}
