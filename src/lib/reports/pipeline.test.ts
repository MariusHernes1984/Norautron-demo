// @vitest-environment node

import modelReport from "./__fixtures__/model-report.json";
import { describe, expect, it } from "vitest";
import type { ReportSpec } from "../types";
import { buildTopicKpis } from "./fact-spec";
import type { TopicFacts } from "./facts";
import { hydrateReport } from "./pipeline";

const rows = [
  {
    product_family: "Controls",
    net_sales_nok: 400,
    gross_margin_nok: 130,
    units: 6
  }
];

const facts: TopicFacts[] = [
  {
    topic: "sales",
    label: "Salg og margin",
    kpis: buildTopicKpis("sales", rows),
    rows,
    verificationRows: rows,
    chart: null
  }
];

const spec: ReportSpec = {
  title: "Styrepakke",
  topics: ["sales"],
  language: "no",
  audience: "ledelse",
  filters: { regions: [], productFamilies: [], factories: [] },
  includeRisks: true,
  includeActions: false,
  includeMethodology: true,
  brief: ""
};

describe("report hydration and QA", () => {
  it("hydrates the fixed report shape and verifies every KPI and claim", () => {
    const report = hydrateReport({
      text: JSON.stringify(modelReport),
      spec,
      facts,
      datasetVersion: "dataset-1",
      now: () => new Date("2026-08-26T10:00:00.000Z")
    });

    expect(report).toMatchObject({
      title: "Styrepakke",
      datasetVersion: "dataset-1",
      createdAt: "2026-08-26T10:00:00.000Z",
      actions: [],
      qa: {
        verified: 3,
        total: 3,
        ok: true,
        groundedClaims: 3,
        totalClaims: 3
      }
    });
    expect(report?.sections[0]).toMatchObject({
      topic: "sales",
      claims: [
        expect.objectContaining({ factIds: ["sales-margin"] })
      ]
    });
  });

  it("rejects unknown citations and KPI values that fail verification", () => {
    const ungrounded = structuredClone(modelReport);
    ungrounded.sections[0].claims[0].factIds = ["invented-fact"];
    expect(
      hydrateReport({
        text: JSON.stringify(ungrounded),
        spec,
        facts,
        datasetVersion: "dataset-1"
      })
    ).toBeNull();

    const tamperedFacts = structuredClone(facts);
    tamperedFacts[0].kpis[0].value += 1;
    expect(
      hydrateReport({
        text: JSON.stringify(modelReport),
        spec,
        facts: tamperedFacts,
        datasetVersion: "dataset-1"
      })
    ).toBeNull();
  });

  it("rejects numeric narrative claims absent from their cited facts", () => {
    const inventedNumber = structuredClone(modelReport);
    inventedNumber.sections[0].claims[0].text =
      "Bruttomarginen er 99 prosent.";
    expect(
      hydrateReport({
        text: JSON.stringify(inventedNumber),
        spec,
        facts,
        datasetVersion: "dataset-1"
      })
    ).toBeNull();
  });
});
