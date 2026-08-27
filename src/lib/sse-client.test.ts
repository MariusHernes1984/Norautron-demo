import { afterEach, describe, expect, it, vi } from "vitest";
import { streamSSE } from "./sse-client";

const usage = {
  kind: "usage" as const,
  deployment: "gpt-5.6-terra",
  usage: { inputTokens: 7, outputTokens: 3, totalTokens: 10 }
};

function responseFromChunks(chunks: string[]) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
        controller.close();
      }
    }),
    { headers: { "Content-Type": "text/event-stream" } }
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("streamSSE", () => {
  it("parses split CRLF frames without duplicating final usage", async () => {
    const body = [
      'event: stage\r\ndata: {"stage":"schema"}\r\n\r\n',
      'event: delta\r\ndata: {"delta":"Hei"}\r\n\r\n',
      `event: usage\r\ndata: ${JSON.stringify(usage)}\r\n\r\n`,
      `event: done\r\ndata: ${JSON.stringify({
        ok: true,
        result: { answer: "Hei" },
        usage
      })}`
    ].join("");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        responseFromChunks([
          body.slice(0, 9),
          body.slice(9, 53),
          body.slice(53, 111),
          body.slice(111)
        ])
      )
    );
    const onDelta = vi.fn();
    const onStage = vi.fn();
    const onUsage = vi.fn();
    const onDone = vi.fn();

    await streamSSE<{ answer: string }>("/api/chat", {}, {
      onDelta,
      onStage,
      onUsage,
      onDone
    });

    expect(onStage).toHaveBeenCalledWith("schema");
    expect(onDelta).toHaveBeenCalledWith("Hei", "Hei");
    expect(onUsage).toHaveBeenCalledOnce();
    expect(onUsage).toHaveBeenCalledWith(usage);
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("reports malformed events and streams that end without done", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          responseFromChunks(['event: usage\ndata: {"kind":"usage"}\n\n'])
        )
        .mockResolvedValueOnce(
          responseFromChunks(['event: delta\ndata: {"delta":"Hei"}\n\n'])
        )
    );
    const malformed = vi.fn();
    const incomplete = vi.fn();

    await streamSSE("/api/chat", {}, { onError: malformed });
    await streamSSE("/api/chat", {}, { onError: incomplete });

    expect(malformed).toHaveBeenCalledOnce();
    expect(incomplete).toHaveBeenCalledOnce();
    expect(String(incomplete.mock.calls[0][0])).toContain("done-hendelse");
  });

  it("does not report an intentional abort as an error", async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new DOMException("Aborted", "AbortError"))
    );
    const onError = vi.fn();

    await streamSSE("/api/chat", {}, {
      signal: controller.signal,
      onError
    });

    expect(onError).not.toHaveBeenCalled();
  });
});
