// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import type { ModelEvent } from "./model";
import { sseFromEventStream } from "./stream";

const usage: Extract<ModelEvent, { kind: "usage" }> = {
  kind: "usage",
  deployment: "gpt-5.6-terra",
  usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 }
};

describe("SSE guardrails", () => {
  it("relays stages, deltas, usage and a final result", async () => {
    async function* events(): AsyncGenerator<ModelEvent> {
      yield { kind: "stage", stage: "schema" };
      yield { kind: "delta", text: "Hei" };
      yield usage;
    }
    const onFinish = vi.fn();
    const response = sseFromEventStream(events(), {
      operation: "chat",
      requestId: "test-request",
      parse: (text) => ({ answer: text }),
      errorMessage: "Kunne ikke tolke.",
      onFinish
    });
    const body = await response.text();

    expect(body).toContain('event: stage\ndata: {"stage":"schema"}');
    expect(body).toContain('event: delta\ndata: {"delta":"Hei"}');
    expect(body).toContain(`event: usage\ndata: ${JSON.stringify(usage)}`);
    expect(body).toContain('"ok":true');
    expect(body).toContain('"result":{"answer":"Hei"}');
    expect(onFinish).toHaveBeenCalledWith({ usage, ok: true });
  });

  it("delivers results when optional QA and persistence hooks fail", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    async function* events(): AsyncGenerator<ModelEvent> {
      yield { kind: "delta", text: "result" };
    }
    const response = sseFromEventStream(events(), {
      operation: "report",
      requestId: "test-request",
      parse: (text) => ({ text }),
      errorMessage: "Kunne ikke tolke.",
      qa: () => {
        throw new Error("qa failed");
      },
      save: async () => {
        throw new Error("save failed");
      }
    });

    expect(await response.text()).toContain(
      '"ok":true,"result":{"text":"result"}'
    );
    log.mockRestore();
  });

  it("returns configured safe errors instead of exception messages", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const closed = vi.fn(async () => undefined);
    async function* events(): AsyncGenerator<ModelEvent> {
      throw new Error("provider response containing the full prompt");
    }

    const response = sseFromEventStream(events(), {
      operation: "chat",
      requestId: "test-request",
      parse: () => null,
      errorMessage: "Analysen feilet trygt.",
      onClose: closed
    });
    const body = await response.text();

    expect(body).toContain("Analysen feilet trygt.");
    expect(body).not.toContain("full prompt");
    expect(JSON.stringify(log.mock.calls)).not.toContain("full prompt");
    expect(closed).toHaveBeenCalledOnce();
    log.mockRestore();
  });

  it("runs cleanup when the request disconnects", async () => {
    const abort = new AbortController();
    const released = vi.fn(async () => undefined);
    const closed = vi.fn(async () => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    async function* events(): AsyncGenerator<ModelEvent> {
      try {
        yield { kind: "delta", text: "started" };
        await new Promise<never>((_resolve, reject) => {
          abort.signal.addEventListener(
            "abort",
            () => reject(new Error("disconnected")),
            { once: true }
          );
        });
      } finally {
        await released();
      }
    }

    const response = sseFromEventStream(events(), {
      operation: "chat",
      requestId: "test-request",
      parse: () => null,
      errorMessage: "safe",
      signal: abort.signal,
      onClose: closed
    });
    const reader = response.body!.getReader();
    await reader.read();
    abort.abort();
    await vi.waitFor(() => {
      expect(released).toHaveBeenCalledOnce();
      expect(closed).toHaveBeenCalledOnce();
    });
    expect((await reader.read()).done).toBe(true);
  });

  it("aborts a stream factory when the response body is cancelled", async () => {
    let sourceSignal: AbortSignal | undefined;
    let finalized = false;
    const response = sseFromEventStream(
      (signal) =>
        (async function* (): AsyncGenerator<ModelEvent> {
          sourceSignal = signal;
          try {
            yield { kind: "stage", stage: "schema" };
            await new Promise<void>((_resolve, reject) => {
              signal.addEventListener("abort", () => reject(signal.reason), {
                once: true
              });
            });
          } finally {
            finalized = true;
          }
        })(),
      {
        operation: "chat",
        requestId: "test-request",
        parse: () => null,
        errorMessage: "Kunne ikke tolke."
      }
    );

    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    await vi.waitFor(() => {
      expect(sourceSignal?.aborted).toBe(true);
      expect(finalized).toBe(true);
    });
  });
});
