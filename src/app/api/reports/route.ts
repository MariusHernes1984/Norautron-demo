import { getReport, listReports } from "@/lib/db/reports";
import { friendlyDatabaseError } from "@/lib/db/pool";
import { withRequestTelemetry } from "@/lib/http";
import { type NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(value: unknown, init?: ResponseInit) {
  const response = Response.json(value, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export function parsePositiveReportId(value: string) {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

export async function GET(request: NextRequest) {
  return withRequestTelemetry(request, "/api/reports", async () => {
    try {
      const rawId = request.nextUrl.searchParams.get("id");
      if (rawId === null) return json(await listReports());
      const id = parsePositiveReportId(rawId);
      if (id === null) {
        return json({ error: "Ugyldig rapport-ID." }, { status: 400 });
      }
      const report = await getReport(id);
      return report
        ? json(report)
        : json({ error: "Rapporten finnes ikke." }, { status: 404 });
    } catch (error) {
      return json(
        { error: friendlyDatabaseError(error) },
        { status: 503 }
      );
    }
  });
}
