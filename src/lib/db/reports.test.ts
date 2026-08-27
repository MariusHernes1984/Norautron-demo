// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReportDocument, ReportSpec } from "../types";

const mocks = vi.hoisted(() => ({
  executeSql: vi.fn(),
  queryRows: vi.fn()
}));

vi.mock("./query", () => ({
  executeSql: mocks.executeSql,
  queryRows: mocks.queryRows
}));

import { getReport, listReports, saveReport } from "./reports";

const spec: ReportSpec = {
  title: "Styrepakke",
  topics: ["sales"],
  language: "no",
  audience: "ledelse",
  filters: { regions: [], productFamilies: [], factories: [] },
  includeRisks: true,
  includeActions: true,
  includeMethodology: false,
  brief: ""
};

const report: ReportDocument = {
  title: "Styrepakke",
  subtitle: "Verifisert rapport",
  executiveSummary: [],
  kpis: [],
  sections: [],
  risks: [],
  actions: [],
  datasetVersion: "dataset-v1",
  modelDeployment: "gpt-test",
  createdAt: "2026-08-26T10:00:00.000Z",
  qa: {
    verified: 0,
    total: 0,
    ok: true,
    groundedClaims: 0,
    totalClaims: 0,
    checks: []
  }
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("report persistence", () => {
  it("saves versioned report JSON, bounded spec and metadata", async () => {
    mocks.executeSql.mockResolvedValue({ recordset: [{ id: 17 }] });

    await expect(saveReport(report, spec)).resolves.toEqual({ id: 17 });

    const [query, parameters, operation] = mocks.executeSql.mock.calls[0];
    expect(query).toContain("report_schema_version");
    expect(operation).toBe("report_save");
    const byName = Object.fromEntries(
      parameters.map((parameter: { name: string; value: unknown }) => [
        parameter.name,
        parameter.value
      ])
    );
    expect(JSON.parse(String(byName.report))).toMatchObject({
      schemaVersion: 1,
      datasetVersion: "dataset-v1",
      modelDeployment: "gpt-test",
      report: { title: "Styrepakke" }
    });
    expect(JSON.parse(String(byName.spec))).toEqual(spec);
    expect(byName.version).toBe("dataset-v1");
    expect(byName.deployment).toBe("gpt-test");
  });

  it("rejects an unbounded spec before connecting to SQL", async () => {
    await expect(
      saveReport(report, { ...spec, brief: "x".repeat(601) })
    ).rejects.toThrow("ugyldig");
    expect(mocks.executeSql).not.toHaveBeenCalled();
  });

  it("lists only the newest 50 with dataset and model metadata", async () => {
    mocks.queryRows.mockResolvedValue([
      {
        id: 3,
        title: "Ny rapport",
        created_at: new Date("2026-08-26T12:00:00.000Z"),
        dataset_version: "dataset-v2",
        model_deployment: "gpt-test",
        spec_json: JSON.stringify({ topics: ["sales", "quality"] })
      }
    ]);

    await expect(listReports()).resolves.toEqual([
      {
        id: 3,
        title: "Ny rapport",
        createdAt: "2026-08-26T12:00:00.000Z",
        datasetVersion: "dataset-v2",
        modelDeployment: "gpt-test",
        topicCount: 2
      }
    ]);
    expect(mocks.queryRows.mock.calls[0][0]).toContain("TOP (50)");
    expect(mocks.queryRows.mock.calls[0][0]).toContain(
      "ORDER BY created_at DESC, id DESC"
    );
  });

  it("loads one versioned report and applies canonical row metadata", async () => {
    const envelope = JSON.stringify({
      schemaVersion: 1,
      datasetVersion: report.datasetVersion,
      modelDeployment: report.modelDeployment,
      report
    });
    mocks.queryRows.mockResolvedValue([
      {
        id: 9,
        title: "Lagret tittel",
        report_json: envelope,
        report_schema_version: 1,
        dataset_version: "dataset-v1",
        model_deployment: "gpt-test",
        created_at: new Date("2026-08-26T13:00:00.000Z")
      }
    ]);

    await expect(getReport(9)).resolves.toMatchObject({
      id: 9,
      title: "Lagret tittel",
      datasetVersion: "dataset-v1",
      modelDeployment: "gpt-test",
      createdAt: "2026-08-26T13:00:00.000Z"
    });
    expect(mocks.queryRows.mock.calls[0][1]).toEqual([
      { name: "id", type: "int", value: 9 }
    ]);
  });
});
