import { requireAccess } from "@/lib/auth/session";
import { isResultName } from "@/lib/results/files";
import { configError, downloadUrl } from "@/lib/results/load";
import { isUuid } from "@/lib/storage/keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = requireAccess(request);
  if (denied) return denied;
  const { id } = await context.params;
  const name = new URL(request.url).searchParams.get("file") ?? "";
  if (!isUuid(id) || !isResultName(name)) {
    return Response.json({ ok: false, code: "bad_id" }, { status: 400, headers: { "cache-control": "no-store" } });
  }
  try {
    const url = await downloadUrl(id, name);
    if (!url) {
      return Response.json({ ok: false, code: "missing" }, { status: 404, headers: { "cache-control": "no-store" } });
    }
    return Response.redirect(url, 302);
  } catch (error) {
    const code = configError(error) ?? "unreachable";
    return Response.json({ ok: false, code }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
