import { isPipelineStage } from "./chat/stages";
import type { SseFinalEvent, SseUsagePayload } from "./stream";
import type { PipelineStage } from "./types";

type Handlers<T> = {
  onDelta?: (delta: string, accumulated: string) => void;
  onUsage?: (usage: SseUsagePayload) => void;
  onStage?: (stage: PipelineStage) => void;
  onDone?: (event: SseFinalEvent<T>) => void;
  onError?: (error: unknown) => void;
  signal?: AbortSignal;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function isUsagePayload(value: unknown): value is SseUsagePayload {
  const tokenUsage = isObject(value) ? value.usage : undefined;
  if (
    !isObject(value) ||
    value.kind !== "usage" ||
    typeof value.deployment !== "string" ||
    !isObject(tokenUsage)
  ) {
    return false;
  }
  return ["inputTokens", "outputTokens", "totalTokens"].every((key) => {
    const tokenCount = tokenUsage[key];
    return (
      typeof tokenCount === "number" &&
      Number.isFinite(tokenCount) &&
      tokenCount >= 0
    );
  });
}

function isFinalEvent<T>(value: unknown): value is SseFinalEvent<T> {
  if (!isObject(value) || typeof value.ok !== "boolean") return false;
  if (value.usage !== undefined && !isUsagePayload(value.usage)) return false;
  return value.ok ? "result" in value : typeof value.error === "string";
}

export async function streamSSE<T>(
  url: string,
  payload: unknown,
  handlers: Handlers<T>
) {
  const reportError = (error: unknown) => {
    if (!handlers.signal?.aborted && !isAbortError(error)) {
      handlers.onError?.(error);
    }
  };

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: handlers.signal
    });
  } catch (error) {
    reportError(error);
    return;
  }

  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const body: unknown = await response.json();
      if (isObject(body) && typeof body.error === "string" && body.error) {
        detail = body.error;
      }
    } catch {
      // Preserve the HTTP error when the response is not JSON.
    }
    reportError(new Error(detail));
    return;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const payload: unknown = await response.json();
      const final: SseFinalEvent<T> = isFinalEvent<T>(payload)
        ? payload
        : { ok: true, result: payload as T };
      if (final.usage) handlers.onUsage?.(final.usage);
      handlers.onDone?.(final);
    } catch (error) {
      reportError(error);
    }
    return;
  }

  if (!response.body) {
    reportError(new Error("Strømmeresponsen manglet innhold."));
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let accumulated = "";
  let sawUsage = false;
  let sawDone = false;
  let eventName = "message";
  let dataLines: string[] = [];

  const dispatch = () => {
    if (!dataLines.length) {
      eventName = "message";
      return false;
    }
    const data = dataLines.join("\n");
    eventName = eventName || "message";
    dataLines = [];

    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      throw new Error(`Ugyldig JSON i SSE-hendelsen "${eventName}".`);
    }

    if (eventName === "delta") {
      if (!isObject(parsed) || typeof parsed.delta !== "string") {
        throw new Error("Ugyldig delta-hendelse fra serveren.");
      }
      if (parsed.delta) {
        accumulated += parsed.delta;
        handlers.onDelta?.(parsed.delta, accumulated);
      }
    } else if (eventName === "usage") {
      if (!isUsagePayload(parsed)) {
        throw new Error("Ugyldig usage-hendelse fra serveren.");
      }
      sawUsage = true;
      handlers.onUsage?.(parsed);
    } else if (eventName === "stage") {
      if (isObject(parsed) && isPipelineStage(parsed.stage)) {
        handlers.onStage?.(parsed.stage);
      }
    } else if (eventName === "done") {
      if (!isFinalEvent<T>(parsed)) {
        throw new Error("Ugyldig done-hendelse fra serveren.");
      }
      if (parsed.usage && !sawUsage) handlers.onUsage?.(parsed.usage);
      sawDone = true;
      handlers.onDone?.(parsed);
    }
    eventName = "message";
    return sawDone;
  };

  const consumeLines = (flush = false) => {
    while (true) {
      const newline = buffer.indexOf("\n");
      if (newline === -1) break;
      let line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (!line) {
        if (dispatch()) return true;
        continue;
      }
      if (line.startsWith(":")) continue;
      const colon = line.indexOf(":");
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? "" : line.slice(colon + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      if (field === "event") eventName = value;
      if (field === "data") dataLines.push(value);
    }

    if (flush) {
      if (buffer) {
        let line = buffer;
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (line.startsWith("data:")) {
          let value = line.slice(5);
          if (value.startsWith(" ")) value = value.slice(1);
          dataLines.push(value);
        } else if (line.startsWith("event:")) {
          eventName = line.slice(6).trimStart();
        }
        buffer = "";
      }
      return dispatch();
    }
    return false;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (consumeLines()) {
        await reader.cancel();
        return;
      }
    }
    buffer += decoder.decode();
    consumeLines(true);
    if (!sawDone && !handlers.signal?.aborted) {
      throw new Error("SSE-strømmen ble avsluttet uten en done-hendelse.");
    }
  } catch (error) {
    reportError(error);
    try {
      await reader.cancel();
    } catch {
      // The signal may already have closed the reader.
    }
  } finally {
    reader.releaseLock();
  }
}
