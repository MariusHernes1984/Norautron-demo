// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelEvent } from "../model";

const mocks = vi.hoisted(() => ({
  collectModelText: vi.fn(),
  streamModelEvents: vi.fn(),
  getActiveDatasetVersion: vi.fn(),
  runGeneratedSql: vi.fn(),
  inferChartFromResult: vi.fn()
}));

vi.mock("../model", () => ({
  collectModelText: mocks.collectModelText,
  streamModelEvents: mocks.streamModelEvents
}));
vi.mock("../db/dataset", () => ({
  getActiveDatasetVersion: mocks.getActiveDatasetVersion
}));
vi.mock("../db/query", () => ({
  runGeneratedSql: mocks.runGeneratedSql
}));
vi.mock("./chart", () => ({
  inferChartFromResult: mocks.inferChartFromResult
}));

import { chatPipeline, splitFollowUps } from "./pipeline";

const rows = [
  { region: "Norge", net_sales_nok: 10 },
  { region: "Sverige", net_sales_nok: 20 }
];

async function collectPipeline(
  overrides: Partial<Parameters<typeof chatPipeline>[0]> = {}
) {
  const release = vi.fn(async () => undefined);
  const onPrepared = vi.fn();
  const events: ModelEvent[] = [];
  for await (const event of chatPipeline({
    requestId: "request-1",
    question: "Vis salg per region",
    history: [],
    release,
    onPrepared,
    ...overrides
  })) {
    events.push(event);
  }
  return { events, release, onPrepared };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getActiveDatasetVersion.mockResolvedValue("dataset-v1");
  mocks.collectModelText.mockResolvedValue({
    text: JSON.stringify({
      sql: "SELECT region, SUM(net_sales_nok) AS net_sales_nok FROM metrics.sales_monthly GROUP BY region",
      intent: "Summer salg per region"
    })
  });
  mocks.runGeneratedSql.mockResolvedValue({
    columns: ["region", "net_sales_nok"],
    rows
  });
  mocks.inferChartFromResult.mockReturnValue({
    type: "bar",
    title: "Salg per region",
    xKey: "region",
    yKeys: ["net_sales_nok"],
    data: rows
  });
  mocks.streamModelEvents.mockImplementation(() =>
    (async function* (): AsyncGenerator<ModelEvent> {
      yield { kind: "delta", text: "Norge har 10 og Sverige har 20." };
      yield {
        kind: "delta",
        text: '<<<FOLLOWUPS>>>["Per måned?","Per segment?","Mot budsjett?"]<<<END_FOLLOWUPS>>>'
      };
    })()
  );
});

describe("chatPipeline", () => {
  it("grounds a staged answer in executed rows and complete evidence", async () => {
    const { events, release, onPrepared } = await collectPipeline();

    expect(
      events
        .filter((event) => event.kind === "stage")
        .map((event) => event.stage)
    ).toEqual(["schema", "sql", "query", "compose"]);
    expect(mocks.runGeneratedSql).toHaveBeenCalledWith(
      expect.stringContaining("TOP (500)"),
      undefined
    );
    expect(onPrepared).toHaveBeenCalledWith({
      chart: expect.objectContaining({ xKey: "region" }),
      evidence: expect.objectContaining({
        sql: expect.stringContaining("metrics.sales_monthly"),
        tables: ["metrics.sales_monthly"],
        rowCount: 2,
        datasetVersion: "dataset-v1",
        generatedAt: expect.any(String)
      })
    });
    expect(mocks.streamModelEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "chat.answer",
        reasoningEffort: "medium",
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: "user",
            content: expect.stringContaining("DATASETTVERSJON:\ndataset-v1")
          })
        ])
      })
    );
    expect(release).toHaveBeenCalledOnce();
  });

  it("repairs an allowlist rejection once before database execution", async () => {
    mocks.collectModelText
      .mockResolvedValueOnce({
        text: '{"sql":"SELECT value FROM dbo.secrets","intent":"bad"}'
      })
      .mockResolvedValueOnce({
        text: '{"sql":"SELECT region, SUM(net_sales_nok) AS net_sales_nok FROM metrics.sales_monthly GROUP BY region","intent":"fixed"}'
      });

    await collectPipeline();

    expect(mocks.collectModelText).toHaveBeenCalledTimes(2);
    expect(mocks.collectModelText.mock.calls[1][0]).toEqual(
      expect.objectContaining({ operation: "chat.sql_repair" })
    );
    expect(mocks.runGeneratedSql).toHaveBeenCalledOnce();
  });

  it("repairs one SQL execution error without retrying operational failures", async () => {
    mocks.runGeneratedSql
      .mockRejectedValueOnce(Object.assign(new Error("syntax"), { code: "EREQUEST" }))
      .mockResolvedValueOnce({
        columns: ["region", "net_sales_nok"],
        rows
      });

    const { events } = await collectPipeline();

    expect(mocks.collectModelText).toHaveBeenCalledTimes(2);
    expect(mocks.runGeneratedSql).toHaveBeenCalledTimes(2);
    expect(
      events
        .filter((event) => event.kind === "stage")
        .map((event) => event.stage)
    ).toEqual(["schema", "sql", "query", "compose"]);

    vi.clearAllMocks();
    mocks.getActiveDatasetVersion.mockResolvedValue("dataset-v1");
    mocks.collectModelText.mockResolvedValue({
      text: '{"sql":"SELECT region FROM metrics.sales_monthly","intent":"ok"}'
    });
    mocks.runGeneratedSql.mockRejectedValue(
      Object.assign(new Error("network"), { code: "ESOCKET" })
    );
    const release = vi.fn(async () => undefined);
    await expect(
      collectPipeline({ release })
    ).rejects.toThrow("network");
    expect(mocks.collectModelText).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });

  it("does not publish evidence if the active dataset changes mid-query", async () => {
    mocks.getActiveDatasetVersion
      .mockResolvedValueOnce("dataset-v1")
      .mockResolvedValueOnce("dataset-v2");
    const release = vi.fn(async () => undefined);
    const onPrepared = vi.fn();

    await expect(
      collectPipeline({ release, onPrepared })
    ).rejects.toThrow("datasetversjon ble endret");
    expect(onPrepared).not.toHaveBeenCalled();
    expect(mocks.streamModelEvents).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
  });
});

describe("splitFollowUps", () => {
  it("returns only three unique, bounded follow-up questions", () => {
    expect(
      splitFollowUps(
        'Svar.<<<FOLLOWUPS>>>[" Neste? ","Neste?","x","En annen?","En tredje?","En fjerde?"]<<<END_FOLLOWUPS>>>ignored'
      )
    ).toEqual({
      answer: "Svar.",
      followUps: ["Neste?", "En annen?", "En tredje?"]
    });
  });

  it("hides an incomplete follow-up block from the answer", () => {
    expect(splitFollowUps("Trygt svar.<<<FOLLOWUPS>>>[")).toEqual({
      answer: "Trygt svar.",
      followUps: []
    });
  });
});
