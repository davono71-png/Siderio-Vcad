import { NextResponse, type NextRequest } from "next/server";
import { accessState } from "@/lib/auth/session";

export function proxy(request: NextRequest) {
  const state = accessState(request.cookies.get("siderio_access")?.value);
  if (state === "ok") return NextResponse.next();
  return NextResponse.json(
    { ok: false, code: state },
    { status: state === "unconfigured" ? 503 : 401, headers: { "cache-control": "no-store" } },
  );
}

export const config = {
  matcher: ["/api/rilievi", "/api/rilievi/:path*", "/api/storage/presign"],
};
