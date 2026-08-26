// @vitest-environment node

import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clientAddress,
  isSameOrigin,
  logSafeError,
  readBoundedJson,
  requestId
} from "./http";

function request(
  body: string,
  headers: Record<string, string> = {}
) {
  return new NextRequest("https://pilot.example/api/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://pilot.example",
      ...headers
    },
    body
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("anonymous HTTP guardrails", () => {
  it("requires the state-changing request origin to match exactly", () => {
    expect(isSameOrigin(request("{}"))).toBe(true);
    expect(
      isSameOrigin(request("{}", { origin: "https://attacker.example" }))
    ).toBe(false);
    expect(isSameOrigin(request("{}", { origin: "null" }))).toBe(false);
    expect(
      isSameOrigin(
        request("{}", {
          "sec-fetch-site": "cross-site"
        })
      )
    ).toBe(false);
  });

  it("reads valid JSON without trusting content length", async () => {
    const result = await readBoundedJson(request('{"question":"hei"}'), 64);
    expect(result).toEqual({
      ok: true,
      value: { question: "hei" }
    });
  });

  it("rejects declared and streamed bodies over the byte budget", async () => {
    const declared = await readBoundedJson(
      request("{}", { "content-length": "65" }),
      64
    );
    expect(declared.ok).toBe(false);
    if (!declared.ok) expect(declared.response.status).toBe(413);

    const streamed = await readBoundedJson(request(`"${"x".repeat(64)}"`), 64);
    expect(streamed.ok).toBe(false);
    if (!streamed.ok) expect(streamed.response.status).toBe(413);
  });

  it("normalizes proxy addresses and rejects non-IP identifiers", () => {
    expect(
      clientAddress(
        request("{}", { "x-forwarded-for": "203.0.113.7:443, 10.0.0.1" })
      )
    ).toBe("203.0.113.7");
    expect(
      clientAddress(
        request("{}", { "x-forwarded-for": "spoofed-client-name" })
      )
    ).toBe("unknown");
  });

  it("does not log raw error messages, prompts, or addresses", () => {
    const error = Object.assign(
      new Error("full prompt from 203.0.113.7"),
      { code: "MODEL_FAILED" }
    );
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    logSafeError("Chat failed", error);
    const logged = JSON.stringify(spy.mock.calls);
    expect(logged).toContain("MODEL_FAILED");
    expect(logged).not.toContain("full prompt");
    expect(logged).not.toContain("203.0.113.7");
  });

  it("does not trust user-controlled text as a logged request ID", () => {
    const supplied = "full.prompt.203.0.113.7";
    const generated = requestId(request("{}", { "x-request-id": supplied }));
    expect(generated).not.toBe(supplied);
    expect(generated).toMatch(/^[a-f0-9-]{36}$/);
  });
});
