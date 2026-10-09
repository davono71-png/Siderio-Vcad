import { RESERVED_MESSAGE } from "@/lib/auth/admin";
import { authorizeUser } from "@/lib/auth/check";
import { openAuth } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INVALID = "Email o password non validi.";

export async function GET(request: Request) {
  const { supabase, finish } = await openAuth(request);
  if (!supabase) return finish({ ok: false, code: "unconfigured" }, 503);
  const code = await authorizeUser(supabase);
  if (code === "ok") return finish({ ok: true }, 200);
  if (code === "forbidden") return finish({ ok: false, code, message: RESERVED_MESSAGE }, 403);
  return finish({ ok: false, code: "unauthorized" }, 401);
}

export async function POST(request: Request) {
  const { supabase, finish } = await openAuth(request);
  if (!supabase) return finish({ ok: false, code: "unconfigured" }, 503);

  let email = "";
  let password = "";
  try {
    const body = (await request.json()) as { email?: unknown; password?: unknown };
    email = typeof body.email === "string" ? body.email.trim() : "";
    password = typeof body.password === "string" ? body.password : "";
  } catch {
    return finish({ ok: false, code: "bad_json" }, 400);
  }
  if (!email || !password) {
    return finish({ ok: false, code: "bad_credentials", message: INVALID }, 401);
  }

  const signed = await supabase.auth.signInWithPassword({ email, password });
  if (signed.error || !signed.data.user) {
    const authCode = signed.error?.code;
    if (authCode === "invalid_credentials" || authCode === "email_not_confirmed") {
      return finish({ ok: false, code: "bad_credentials", message: INVALID }, 401);
    }
    return finish({ ok: false, code: "auth_unavailable", message: "Siderio Suite non risponde. Riprova tra poco." }, 503);
  }

  const code = await authorizeUser(supabase);
  if (code !== "ok") {
    await supabase.auth.signOut();
    return finish({ ok: false, code: "forbidden", message: RESERVED_MESSAGE }, 403);
  }
  return finish({ ok: true }, 200);
}

export async function DELETE(request: Request) {
  const { supabase, finish } = await openAuth(request);
  if (supabase) await supabase.auth.signOut();
  return finish({ ok: true }, 200);
}
