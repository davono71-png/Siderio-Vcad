import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { RESERVED_MESSAGE } from "@/lib/auth/admin";
import { supabasePublicConfig } from "@/lib/auth/config";
import { authorizeUser, isSecureRequest, nextCookieOptions } from "@/lib/auth/check";

type PendingCookie = { name: string; value: string; options: CookieOptions };

export async function proxy(request: NextRequest) {
  const config = supabasePublicConfig();
  if (!config) {
    return NextResponse.json(
      { ok: false, code: "unconfigured" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  const pending = new Map<string, PendingCookie>();
  let cacheHeaders: Record<string, string> = {};
  const supabase = createServerClient(config.url, config.key, {
    cookieOptions: { secure: isSecureRequest(request), httpOnly: true },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const cookie of cookiesToSet) {
          request.cookies.set(cookie.name, cookie.value);
          pending.set(cookie.name, cookie);
        }
        cacheHeaders = { ...cacheHeaders, ...headers };
      },
    },
  });

  const code = await authorizeUser(supabase);
  const response =
    code === "ok"
      ? NextResponse.next({ request })
      : NextResponse.json(
          {
            ok: false,
            code,
            ...(code === "forbidden" ? { message: RESERVED_MESSAGE } : {}),
          },
          { status: code === "forbidden" ? 403 : 401 },
        );

  for (const cookie of pending.values()) {
    response.cookies.set(cookie.name, cookie.value, nextCookieOptions(cookie.options));
  }
  for (const [key, value] of Object.entries(cacheHeaders)) response.headers.set(key, value);
  response.headers.set("cache-control", "no-store");
  return response;
}

export const config = {
  matcher: ["/api/rilievi", "/api/rilievi/:path*", "/api/storage/presign"],
};
