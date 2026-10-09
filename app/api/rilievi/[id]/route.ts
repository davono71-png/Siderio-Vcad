import { requireAccess } from "@/lib/auth/session";
import { isUuid, MAX_JSON_BYTES } from "@/lib/storage/keys";
import { parseSurveyDocument } from "@/lib/sync/document";
import { commitSurvey, readSurvey, storageFailure, writeSurvey } from "@/lib/sync/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "cache-control": "no-store" };

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = requireAccess(request);
  if (denied) return denied;
  const { id } = await context.params;
  if (!isUuid(id)) return Response.json({ ok: false, code: "bad_id" }, { status: 400, headers });
  try {
    const document = await readSurvey(id);
    if (!document || document.deletedAt) return Response.json({ ok: false, code: "missing" }, { status: 404, headers });
    return Response.json({ ok: true, document }, { headers });
  } catch (error) {
    return Response.json({ ok: false, code: storageFailure(error) }, { status: 503, headers });
  }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = requireAccess(request);
  if (denied) return denied;
  const { id } = await context.params;
  if (!isUuid(id)) return Response.json({ ok: false, code: "bad_id" }, { status: 400, headers });

  const raw = await request.text();
  if (raw.length < 2 || raw.length > MAX_JSON_BYTES) {
    return Response.json({ ok: false, code: "bad_size" }, { status: 400, headers });
  }
  let body: { baseRevision?: unknown; document?: unknown };
  try {
    body = JSON.parse(raw) as { baseRevision?: unknown; document?: unknown };
  } catch {
    return Response.json({ ok: false, code: "bad_json" }, { status: 400, headers });
  }
  const baseRevision = typeof body.baseRevision === "number" && Number.isFinite(body.baseRevision) ? Math.floor(body.baseRevision) : -1;
  const incoming = parseSurveyDocument(body.document, id);
  if (!incoming || baseRevision < 0) return Response.json({ ok: false, code: "bad_document" }, { status: 400, headers });

  try {
    const saved = await commitSurvey(id, baseRevision, incoming);
    if (saved.conflict) {
      return Response.json({ ok: false, code: "conflict", document: saved.document }, { status: 409, headers });
    }
    return Response.json({ ok: true, document: saved.document }, { headers });
  } catch (error) {
    return Response.json({ ok: false, code: storageFailure(error) }, { status: 503, headers });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = requireAccess(request);
  if (denied) return denied;
  const { id } = await context.params;
  if (!isUuid(id)) return Response.json({ ok: false, code: "bad_id" }, { status: 400, headers });
  try {
    const current = await readSurvey(id);
    if (!current || current.deletedAt) return Response.json({ ok: false, code: "missing" }, { status: 404, headers });
    const now = new Date().toISOString();
    const next = {
      ...current,
      deletedAt: now,
      revision: current.revision + 1,
      updatedAt: now,
      exportedAt: now,
    };
    const wrote = await writeSurvey(next);
    if (wrote === "conflict") {
      return Response.json({ ok: false, code: "conflict", document: await readSurvey(id) }, { status: 409, headers });
    }
    return Response.json({ ok: true }, { headers });
  } catch (error) {
    return Response.json({ ok: false, code: storageFailure(error) }, { status: 503, headers });
  }
}
