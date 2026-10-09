import { requireAccess } from "@/lib/auth/session";
import { isUuid } from "@/lib/storage/keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "cache-control": "no-store" };
const JOB_ID = /^[A-Za-z0-9_-]{6,80}$/;

function engineEnv() {
  const key = process.env.RUNPOD_API_KEY?.trim() ?? "";
  const endpoint = process.env.RUNPOD_ENDPOINT_ID?.trim() ?? "";
  if (!key || !endpoint) return null;
  return { key, endpoint };
}

function runpodUrl(endpoint: string, jobId?: string) {
  const base = `https://api.runpod.ai/v2/${encodeURIComponent(endpoint)}`;
  return jobId ? `${base}/status/${encodeURIComponent(jobId)}` : `${base}/run`;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await requireAccess(request);
  if (denied) return denied;
  const { id } = await context.params;
  if (!isUuid(id)) return Response.json({ ok: false, code: "bad_id" }, { status: 400, headers });
  const env = engineEnv();
  if (!env) return Response.json({ ok: false, code: "missing_env" }, { status: 503, headers });

  let mode: "stanza" | "facciata" = "facciata";
  try {
    const body = (await request.json()) as { mode?: string };
    if (body?.mode === "stanza" || body?.mode === "facciata") mode = body.mode;
  } catch {
    /* An empty body still sends the rilievo, using the facade mode. */
  }

  try {
    const response = await fetch(runpodUrl(env.endpoint), {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ input: { projectId: id, options: { mode } } }),
    });
    const payload = (await response.json().catch(() => null)) as { id?: string; status?: string; error?: string } | null;
    if (!response.ok || !payload?.id) {
      return Response.json({ ok: false, code: "engine_rejected" }, { status: 502, headers });
    }
    return Response.json({ ok: true, jobId: payload.id, status: payload.status ?? "IN_QUEUE" }, { headers });
  } catch {
    return Response.json({ ok: false, code: "unreachable" }, { status: 502, headers });
  }
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await requireAccess(request);
  if (denied) return denied;
  const { id } = await context.params;
  const jobId = new URL(request.url).searchParams.get("jobId") ?? "";
  if (!isUuid(id) || !JOB_ID.test(jobId)) {
    return Response.json({ ok: false, code: "bad_id" }, { status: 400, headers });
  }
  const env = engineEnv();
  if (!env) return Response.json({ ok: false, code: "missing_env" }, { status: 503, headers });
  try {
    const response = await fetch(runpodUrl(env.endpoint, jobId), {
      headers: { authorization: `Bearer ${env.key}` },
    });
    const payload = (await response.json().catch(() => null)) as { status?: string; error?: string } | null;
    if (!response.ok || !payload?.status) {
      return Response.json({ ok: false, code: "engine_rejected" }, { status: 502, headers });
    }
    return Response.json({ ok: true, jobId, status: payload.status }, { headers });
  } catch {
    return Response.json({ ok: false, code: "unreachable" }, { status: 502, headers });
  }
}
