import { createServerClient, serializeCookieHeader, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { RESERVED_MESSAGE } from "@/lib/auth/admin";
import { authorizeUser, isSecureRequest, nextCookieOptions } from "@/lib/auth/check";
import { supabasePublicConfig } from "@/lib/auth/config";

type PendingCookie = { name: string; value: string; options: CookieOptions };

export async function openAuth(request: Request) {
  const pending = new Map<string, PendingCookie>();
  let cacheHeaders: Record<string, string> = {};
  const config = supabasePublicConfig();
  const store = await cookies();
  const supabase = config
    ? createServerClient(config.url, config.key, {
        cookieOptions: { secure: isSecureRequest(request), httpOnly: true },
        cookies: {
          getAll() {
            return store.getAll().map(({ name, value }) => ({ name, value }));
          },
          setAll(cookiesToSet, headers) {
            for (const cookie of cookiesToSet) {
              pending.set(cookie.name, cookie);
              store.set(cookie.name, cookie.value, nextCookieOptions(cookie.options));
            }
            cacheHeaders = { ...cacheHeaders, ...headers };
          },
        },
      })
    : null;

  function finish(body: unknown, status: number) {
    const headers = new Headers({ "content-type": "application/json" });
    for (const [key, value] of Object.entries(cacheHeaders)) headers.set(key, value);
    headers.set("cache-control", "no-store");
    for (const cookie of pending.values()) {
      headers.append("set-cookie", serializeCookieHeader(cookie.name, cookie.value, cookie.options));
    }
    return new Response(JSON.stringify(body), { status, headers });
  }

  return { supabase, finish };
}

export async function requireAccess(request: Request): Promise<Response | null> {
  const { supabase, finish } = await openAuth(request);
  if (!supabase) return finish({ ok: false, code: "unconfigured" }, 503);
  const code = await authorizeUser(supabase);
  if (code === "ok") return null;
  if (code === "forbidden") return finish({ ok: false, code, message: RESERVED_MESSAGE }, 403);
  return finish({ ok: false, code: "unauthorized" }, 401);
}
