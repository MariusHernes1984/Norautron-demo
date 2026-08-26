import { withRequestTelemetry } from "@/lib/http";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  return withRequestTelemetry(request, "/api/health", () => {
    return Response.json({
      status: "alive",
      service: "norautron-analytics",
      timestamp: new Date().toISOString()
    });
  });
}
