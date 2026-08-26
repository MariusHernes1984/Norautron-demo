import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { requestId, withRequestTelemetry } from "./http";
import { safeTelemetryAttributes } from "./telemetry";

describe("privacy-safe telemetry", () => {
  it("redacts sensitive structured-log fields", () => {
    expect(
      safeTelemetryAttributes({
        raw_ip: "192.0.2.1",
        chat_text: "complete conversation",
        operation: "chat.answer",
        rows: 12
      })
    ).toEqual({
      raw_ip: "[redacted]",
      chat_text: "[redacted]",
      operation: "chat.answer",
      rows: 12
    });
  });

  it("accepts safe request IDs and replaces invalid ones", () => {
    const accepted = new NextRequest("https://example.test/api/health", {
      headers: { "x-request-id": "edge-01:abc" }
    });
    const rejected = new NextRequest("https://example.test/api/health", {
      headers: { "x-request-id": "user@example.test" }
    });

    expect(requestId(accepted)).toBe("edge-01:abc");
    expect(requestId(rejected)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  it("returns the correlation ID without logging request content", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const request = new NextRequest("https://example.test/api/test", {
      method: "POST",
      headers: { "x-request-id": "test-123" },
      body: JSON.stringify({ question: "private question" })
    });

    const response = await withRequestTelemetry(
      request,
      "/api/test",
      async () => Response.json({ ok: true })
    );

    expect(response.headers.get("x-request-id")).toBe("test-123");
    expect(info.mock.calls.flat().join(" ")).not.toContain("private question");
    info.mockRestore();
  });
});
