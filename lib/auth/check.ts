import type { CookieOptions } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isAdministrator, type AdminProfile } from "@/lib/auth/admin";

export type AccessCode = "ok" | "unconfigured" | "unauthorized" | "forbidden";

export function nextCookieOptions(options: CookieOptions) {
  const sameSite = options.sameSite === true ? "strict" : options.sameSite === false ? "lax" : options.sameSite;
  return {
    ...(options.path ? { path: options.path } : {}),
    ...(typeof options.maxAge === "number" ? { maxAge: options.maxAge } : {}),
    ...(options.expires ? { expires: options.expires } : {}),
    ...(options.domain ? { domain: options.domain } : {}),
    ...(typeof options.secure === "boolean" ? { secure: options.secure } : {}),
    ...(typeof options.httpOnly === "boolean" ? { httpOnly: options.httpOnly } : {}),
    ...(sameSite ? { sameSite } : {}),
  };
}

export function isSecureRequest(request: { url: string; headers: Headers }) {
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (forwarded === "https") return true;
  if (forwarded === "http") return false;
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}

export async function authorizeUser(supabase: SupabaseClient): Promise<Exclude<AccessCode, "unconfigured">> {
  try {
    const { data, error } = await supabase.auth.getUser();
    const user = data.user;
    if (error || !user) return "unauthorized";
    const { data: profile, error: profileError } = await supabase
      .from("profili_utenti")
      .select("id, ruolo, is_master")
      .eq("id", user.id)
      .maybeSingle();
    if (profileError || !isAdministrator(profile as AdminProfile | null)) return "forbidden";
    return "ok";
  } catch {
    return "unauthorized";
  }
}
