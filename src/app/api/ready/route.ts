import { getDatasetStatus } from "@/lib/db/dataset";
import { friendlyDatabaseError } from "@/lib/db/pool";
import { withRequestTelemetry } from "@/lib/http";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return withRequestTelemetry(request, "/api/ready", async () => {
    try {
      const dataset = await getDatasetStatus();
      return Response.json(
        { status: dataset.ready ? "ready" : "waiting", dataset },
        { status: dataset.ready ? 200 : 503 }
      );
    } catch (error) {
      return Response.json(
        { status: "unavailable", error: friendlyDatabaseError(error) },
        { status: 503 }
      );
    }
  });
}
