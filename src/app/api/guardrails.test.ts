// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  acquireAiPermit: vi.fn(),
  hashClientAddress: vi.fn(),
  chatPipeline: vi.fn(),
  splitFollowUps: vi.fn(),
  logUsage: vi.fn(),
  hydrateReport: vi.fn(),
  reportPipeline: vi.fn(),
  saveReport: vi.fn()
}));

vi.mock("@/lib/db/rate-limit", () => ({
  acquireAiPermit: mocks.acquireAiPermit,
  hashClientAddress: mocks.hashClientAddress
}));
vi.mock("@/lib/chat/pipeline", () => ({
  chatPipeline: mocks.chatPipeline,
  splitFollowUps: mocks.splitFollowUps
}));
vi.mock("@/lib/reports/pipeline", () => ({
  hydrateReport: mocks.hydrateReport,
  reportPipeline: mocks.reportPipeline
}));
vi.mock("@/lib/db/pool", () => ({
  friendlyDatabaseError: vi.fn(() => "Tjenesten er midlertidig utilgjengelig.")
}));
vi.mock("@/lib/db/reports", () => ({ saveReport: mocks.saveReport }));
vi.mock("@/lib/db/usage", () => ({ logUsage: mocks.logUsage }));
vi.mock("@/lib/model", () => ({ DEPLOYMENT: "test" }));

import { POST as chatPost } from "./chat/route";
import { POST as reportPost } from "./reports/generate/route";

function post(path: string, value: unknown, origin = "https://pilot.example") {
  return new NextRequest(`https://pilot.example${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin
    },
    body: JSON.stringify(value)
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.hashClientAddress.mockResolvedValue("a".repeat(64));
  mocks.acquireAiPermit.mockResolvedValue({
    ok: false,
    retryAfterSeconds: 37
  });
});

describe("AI route guardrails", () => {
  it("rejects cross-origin chat before touching the limiter", async () => {
    const response = await chatPost(
      post(
        "/api/chat",
        { question: "Vis salg", history: [] },
        "https://attacker.example"
      )
    );
    expect(response.status).toBe(403);
    expect(mocks.acquireAiPermit).not.toHaveBeenCalled();
  });

  it("rejects oversized chat bodies and aggregate history", async () => {
    const oversized = await chatPost(
      post("/api/chat", {
        question: "x".repeat(17_000),
        history: []
      })
    );
    expect(oversized.status).toBe(413);

    const history = Array.from({ length: 4 }, (_, index) => ({
      role: index % 2 ? "assistant" : "user",
      content: "x".repeat(1600)
    }));
    const aggregate = await chatPost(
      post("/api/chat", { question: "Vis salg", history })
    );
    expect(aggregate.status).toBe(400);
  });

  it("returns Retry-After when the chat limit is reached", async () => {
    const response = await chatPost(
      post("/api/chat", { question: "Vis salg", history: [] })
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("37");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("streams a validated chat request and releases its permit", async () => {
    const release = vi.fn(async () => undefined);
    mocks.acquireAiPermit.mockResolvedValue({ ok: true, release });
    mocks.splitFollowUps.mockReturnValue({
      answer: "Verifisert svar.",
      followUps: ["Vis per måned?"]
    });
    mocks.chatPipeline.mockImplementation(
      (input: {
        onPrepared: (value: unknown) => void;
      }) =>
        (async function* () {
          input.onPrepared({
            chart: null,
            evidence: {
              sql: "SELECT TOP (500) region FROM analytics.erp_sales",
              tables: ["analytics.erp_sales"],
              rowCount: 2,
              datasetVersion: "dataset-v1",
              generatedAt: "2026-08-26T19:00:00.000Z"
            }
          });
          yield { kind: "stage", stage: "schema" };
          yield { kind: "delta", text: "Verifisert svar." };
        })()
    );

    const response = await chatPost(
      post("/api/chat", { question: "  Vis salg  ", history: [] })
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    expect(body).toContain('event: stage\ndata: {"stage":"schema"}');
    expect(body).toContain('"answer":"Verifisert svar."');
    expect(mocks.chatPipeline).toHaveBeenCalledWith(
      expect.objectContaining({
        question: "Vis salg",
        requestId: expect.any(String),
        signal: expect.any(AbortSignal)
      })
    );
    expect(release).toHaveBeenCalledOnce();
    expect(mocks.logUsage).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "chat", ok: true })
    );
  });

  it("rejects blank history turns before acquiring a permit", async () => {
    const response = await chatPost(
      post("/api/chat", {
        question: "Vis salg",
        history: [{ role: "user", content: "   " }]
      })
    );
    expect(response.status).toBe(400);
    expect(mocks.acquireAiPermit).not.toHaveBeenCalled();
  });

  it("bounds and validates report specifications", async () => {
    const response = await reportPost(
      post("/api/reports/generate", {
        title: "Pilot",
        topics: ["sales", "sales"],
        language: "no",
        audience: "ledelse",
        periodFrom: "2026-09-01",
        periodTo: "2026-08-01",
        includeRisks: true,
        includeActions: true,
        includeMethodology: false,
        brief: ""
      })
    );
    expect(response.status).toBe(400);
    expect(mocks.acquireAiPermit).not.toHaveBeenCalled();
  });

  it("returns Retry-After when the report limit is reached", async () => {
    const response = await reportPost(
      post("/api/reports/generate", {
        topics: ["sales"],
        language: "no",
        audience: "ledelse",
        includeRisks: true,
        includeActions: true,
        includeMethodology: false,
        brief: ""
      })
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("37");
  });

  it("persists a successfully generated report with the bounded spec", async () => {
    const release = vi.fn(async () => undefined);
    const report = {
      title: "Pilot",
      subtitle: "Verifisert",
      executiveSummary: [],
      kpis: [],
      sections: [],
      risks: [],
      actions: [],
      datasetVersion: "dataset-v1",
      modelDeployment: "test",
      createdAt: "2026-08-26T19:00:00.000Z",
      qa: {
        verified: 0,
        total: 0,
        ok: true,
        groundedClaims: 0,
        totalClaims: 0,
        checks: []
      }
    };
    mocks.acquireAiPermit.mockResolvedValue({ ok: true, release });
    mocks.reportPipeline.mockImplementation(
      (input: {
        onPrepared: (facts: unknown[], version: string) => void;
      }) =>
        (async function* () {
          input.onPrepared([], "dataset-v1");
          yield { kind: "delta", text: "{}" };
        })()
    );
    mocks.hydrateReport.mockReturnValue(report);
    mocks.saveReport.mockResolvedValue({ id: 27 });

    const response = await reportPost(
      post("/api/reports/generate", {
        title: "Pilot",
        topics: ["sales"],
        language: "no",
        audience: "ledelse",
        includeRisks: true,
        includeActions: true,
        includeMethodology: false,
        brief: ""
      })
    );
    const body = await response.text();

    expect(body).toContain('"saved":{"id":27}');
    expect(mocks.saveReport).toHaveBeenCalledWith(
      report,
      expect.objectContaining({
        title: "Pilot",
        topics: ["sales"],
        filters: { regions: [], productFamilies: [], factories: [] }
      })
    );
    expect(release).toHaveBeenCalled();
  });
});
