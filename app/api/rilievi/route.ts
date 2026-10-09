import { requireAccess } from "@/lib/auth/session";
import { listSurveyCards, storageFailure } from "@/lib/sync/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "cache-control": "no-store" };

export async function GET(request: Request) {
  const denied = requireAccess(request);
  if (denied) return denied;
  try {
    const surveys = await listSurveyCards();
    return Response.json(
      {
        ok: true,
        surveys: surveys.map((item) => ({
          id: item.id,
          name: item.name,
          kind: item.kind,
          updatedAt: item.updatedAt,
          revision: item.revision,
          photos: item.photos,
        })),
      },
      { headers },
    );
  } catch (error) {
    return Response.json({ ok: false, code: storageFailure(error) }, { status: 503, headers });
  }
}
