import { getDatasetStatus } from "@/lib/db/dataset";
import { friendlyDatabaseError } from "@/lib/db/pool";
import { withRequestTelemetry } from "@/lib/http";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return withRequestTelemetry(request, "/api/dataset", async () => {
    try {
      return Response.json(await getDatasetStatus());
    } catch (error) {
      return Response.json(
        { error: friendlyDatabaseError(error) },
        { status: 503 }
      );
    }
  });
}
