import { BUILD_ID } from "@/lib/build-info";
import { serviceWorkerScript } from "@/lib/pwa/worker-script";

export const dynamic = "force-static";

export function GET() {
  return new Response(serviceWorkerScript(BUILD_ID), {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "no-cache, no-store, must-revalidate",
      "service-worker-allowed": "/",
    },
  });
}
