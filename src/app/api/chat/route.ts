import { chatPipeline, splitFollowUps } from "@/lib/chat/pipeline";
import { friendlyDatabaseError } from "@/lib/db/pool";
import {
  acquireAiPermit,
  hashClientAddress
} from "@/lib/db/rate-limit";
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
import { sseFromEventStream } from "@/lib/stream";
import type { ChatAnswer, ChatEvidence } from "@/lib/types";
import { type NextRequest } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const maxDuration = 120;

const turnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(2000)
}).strict();

const requestSchema = z.object({
  question: z.string().trim().min(2).max(1200),
  history: z.array(turnSchema).max(8).default([])
}).strict().refine(
  (value) =>
    value.history.reduce((total, turn) => total + turn.content.length, 0) <=
    6000,
  { message: "Samtalehistorikken er for lang.", path: ["history"] }
);

export async function POST(request: NextRequest) {
  return withRequestTelemetry(request, "/api/chat", async ({ requestId }) => {
    const originError = sameOriginError(request);
    if (originError) return originError;

    const body = await readBoundedJson(request, 16_384);
    if (!body.ok) return body.response;
    const parsed = requestSchema.safeParse(body.value);
    if (!parsed.success) {
      return jsonError("Spørsmålet eller samtalehistorikken er ugyldig.", 400);
    }

    try {
      const ipHash = await hashClientAddress(clientAddress(request));
      const permit = await acquireAiPermit(ipHash);
      if (!permit.ok) {
        return jsonError("Bruksgrensen er nådd. Prøv igjen om litt.", 429, {
          "Retry-After": String(permit.retryAfterSeconds)
        });
      }

      let prepared:
        | { chart: ChatAnswer["chart"]; evidence: ChatEvidence }
        | undefined;
      return sseFromEventStream<ChatAnswer>(
        (signal) =>
          chatPipeline({
            requestId,
            question: parsed.data.question,
            history: parsed.data.history,
            release: permit.release,
            signal,
            onPrepared(value) {
              prepared = value;
            }
          }),
        {
          operation: "chat",
          requestId,
          parse(full) {
            if (!prepared) return null;
            const content = splitFollowUps(full);
            if (!content.answer) return null;
            return {
              answer: content.answer,
              chart: prepared.chart,
              evidence: prepared.evidence,
              followUps: content.followUps
            };
          },
          errorMessage: "Analysen kunne ikke tolkes.",
          formatError: friendlyDatabaseError,
          signal: request.signal,
          onClose: permit.release,
          onFinish({ usage, ok }) {
            void logUsage({
              kind: "chat",
              deployment: DEPLOYMENT,
              usage: usage?.usage,
              ok
            });
          }
        }
      );
    } catch (error) {
      logSafeError("Chat request failed before streaming", error);
      return jsonError(friendlyDatabaseError(error), 503);
    }
  });
}
