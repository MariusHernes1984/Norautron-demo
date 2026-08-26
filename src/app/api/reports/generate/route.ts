import { friendlyDatabaseError } from "@/lib/db/pool";
import {
  acquireAiPermit,
  hashClientAddress
} from "@/lib/db/rate-limit";
import { saveReport } from "@/lib/db/reports";
import { logUsage } from "@/lib/db/usage";
import {
  clientAddress,
  jsonError,
  logSafeError,
  readBoundedJson,
  sameOriginError,
  withRequestTelemetry
} from "@/lib/http";
import { DEPLOYMENT } from "@/lib/model";
import {
  hydrateReport,
  reportPipeline
} from "@/lib/reports/pipeline";
import type { TopicFacts } from "@/lib/reports/facts";
import { parseReportSpec } from "@/lib/reports/spec";
import { sseFromEventStream } from "@/lib/stream";
import type {
  ReportDocument,
  ReportSpec
} from "@/lib/types";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 180;

export async function POST(request: NextRequest) {
  return withRequestTelemetry(
    request,
    "/api/reports/generate",
    async ({ requestId }) => {
     const originError = sameOriginError(request);
     if (originError) return originError;

     const body = await readBoundedJson(request, 8_192);
     if (!body.ok) return body.response;
     const parsed = parseReportSpec(body.value);
     if (!parsed.ok) {
       return jsonError("Rapportspesifikasjonen er ugyldig.", 400);
     }

     try {
       const permit = await acquireAiPermit(
         await hashClientAddress(clientAddress(request))
       );
       if (!permit.ok) {
         return jsonError("Bruksgrensen er nådd. Prøv igjen om litt.", 429, {
           "Retry-After": String(permit.retryAfterSeconds)
         });
       }

       const spec = parsed.value as ReportSpec;
       let facts: TopicFacts[] | undefined;
       let datasetVersion: string | undefined;
       return sseFromEventStream<ReportDocument>(
         (signal) =>
           reportPipeline({
             requestId,
             spec,
             release: permit.release,
             signal,
             onPrepared(preparedFacts, version) {
               facts = preparedFacts;
               datasetVersion = version;
             }
           }),
         {
           operation: "report",
           requestId,
           parse(text) {
             if (!facts || !datasetVersion) return null;
             return hydrateReport({ text, spec, facts, datasetVersion });
           },
           errorMessage: "Rapporten kunne ikke tolkes.",
           formatError: friendlyDatabaseError,
           signal: request.signal,
           onClose: permit.release,
           qa(report) {
             return report.qa;
           },
           save(report) {
             return saveReport(report, spec);
           },
           onFinish({ usage, ok }) {
             void logUsage({
               kind: "report",
               deployment: DEPLOYMENT,
               usage: usage?.usage,
               ok
             });
           }
         }
       );
     } catch (error) {
       logSafeError("Report generation failed before streaming", error);
       return jsonError(friendlyDatabaseError(error), 503);
     }
   }
  );
}
