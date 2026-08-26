import type { ModelEvent } from "./model";
import type { PipelineStage } from "./types";
import { logSafeError } from "./http";
import { logEvent, recordPipelineStage } from "./telemetry";

export type SseUsagePayload = Extract<ModelEvent, { kind: "usage" }>;
export type SseFinalEvent<T> =
  | {
      ok: true;
      result: T;
      usage?: SseUsagePayload;
      qa?: unknown;
      saved?: unknown;
    }
  | { ok: false; error: string; usage?: SseUsagePayload };

type StreamOptions<T> = {
  operation: "chat" | "report";
  requestId: string;
  parse: (full: string) => T | null;
  errorMessage: string;
  formatError?: (error: unknown) => string;
  onFinish?: (info: { usage?: SseUsagePayload; ok: boolean }) => void;
  qa?: (result: T) => unknown;
  save?: (result: T) => Promise<unknown>;
  signal?: AbortSignal;
  onClose?: () => Promise<void>;
};

type EventStreamSource =
  | AsyncIterable<ModelEvent>
  | ((signal: AbortSignal) => AsyncIterable<ModelEvent>);

function frame(event: string, payload: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

export function sseFromEventStream<T>(
  source: EventStreamSource,
  options: StreamOptions<T>
) {
  const encoder = new TextEncoder();
  const cancellation = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([options.signal, cancellation.signal])
    : cancellation.signal;
  const stream = typeof source === "function" ? source(signal) : source;
  let cancelled = false;
  let bodyCancelled = false;
  const producer = stream as Partial<AsyncGenerator<ModelEvent>>;
  const cancelProducer = () => {
    if (cancelled) return;
    cancelled = true;
    cancellation.abort();
    void producer.return?.(undefined)?.catch(() => undefined);
  };

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, payload: unknown) => {
        if (!cancelled) controller.enqueue(encoder.encode(frame(event, payload)));
      };
      let buffered = "";
      let usage: SseUsagePayload | undefined;
      let finalOk = false;
      let activeStage:
        | { name: PipelineStage; startedAt: number }
        | undefined;
      signal.addEventListener("abort", cancelProducer, { once: true });
      if (signal.aborted) cancelProducer();

      try {
        for await (const event of stream) {
          if (cancelled) break;
          if (event.kind === "delta") {
            buffered += event.text;
            send("delta", { delta: event.text });
          } else if (event.kind === "usage") {
            usage = event;
            send("usage", event);
          } else {
            if (activeStage) {
              recordPipelineStage(
                options.operation,
                activeStage.name,
                "success",
                performance.now() - activeStage.startedAt,
                options.requestId
              );
            }
            activeStage = { name: event.stage, startedAt: performance.now() };
            logEvent("info", "pipeline_stage_started", {
              request_id: options.requestId,
              operation: options.operation,
              stage: event.stage
            });
            send("stage", { stage: event.stage });
          }
        }
        if (cancelled) return;

        const result = options.parse(buffered);
        if (result === null) {
          send("done", {
            ok: false,
            error: options.errorMessage,
            usage
          } satisfies SseFinalEvent<T>);
          return;
        }

        let qa: unknown;
        try {
          qa = options.qa?.(result);
        } catch (error) {
          logSafeError("SSE QA hook failed; result will still be delivered", error);
        }
        let saved: unknown;
        try {
          saved = options.save ? await options.save(result) : undefined;
        } catch (error) {
          logSafeError(
            "SSE persistence hook failed; result will still be delivered",
            error
          );
        }
        if (cancelled) return;
        finalOk = true;
        send("done", {
          ok: true,
          result,
          usage,
          ...(qa !== undefined ? { qa } : {}),
          ...(saved !== undefined ? { saved } : {})
        } satisfies SseFinalEvent<T>);
      } catch (error) {
        logSafeError("SSE pipeline failed", error);
        let errorMessage = options.errorMessage;
        try {
          errorMessage = options.formatError?.(error) ?? errorMessage;
        } catch (formatError) {
          logSafeError("SSE error formatter failed", formatError);
        }
        send("done", {
          ok: false,
          error: errorMessage,
          usage
        } satisfies SseFinalEvent<T>);
      } finally {
        if (activeStage) {
          recordPipelineStage(
            options.operation,
            activeStage.name,
            finalOk ? "success" : "failure",
            performance.now() - activeStage.startedAt,
            options.requestId
          );
        }
        logEvent(finalOk || cancelled ? "info" : "error", "sse_pipeline_completed", {
          request_id: options.requestId,
          operation: options.operation,
          outcome: finalOk ? "success" : cancelled ? "cancelled" : "failure",
          input_tokens: usage?.usage.inputTokens,
          output_tokens: usage?.usage.outputTokens,
          total_tokens: usage?.usage.totalTokens
        });
        try {
          options.onFinish?.({ usage, ok: finalOk });
        } catch (error) {
          logSafeError("SSE completion hook failed", error);
        }
        try {
          await options.onClose?.();
        } catch (error) {
          logSafeError("SSE cleanup failed", error);
        }
        signal.removeEventListener("abort", cancelProducer);
        if (!bodyCancelled) controller.close();
      }
    },
    cancel() {
      bodyCancelled = true;
      cancelProducer();
    }
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    }
  });
}

export type { PipelineStage };
