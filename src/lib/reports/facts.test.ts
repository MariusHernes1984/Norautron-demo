// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReportSpec } from "../types";

const mocks = vi.hoisted(() => ({ queryRows: vi.fn() }));

vi.mock("../db/query", () => ({
  queryRows: mocks.queryRows
}));

import { loadReportFacts } from "./facts";

const spec: ReportSpec = {
  topics: ["sales"],
  language: "no",
  audience: "ledelse",
  periodFrom: "2026-01-01",
  periodTo: "2026-06-30",
  filters: {
    regions: ["Norden"],
    productFamilies: ["Controls"],
    factories: []
  },
  includeRisks: true,
  includeActions: true,
  includeMethodology: true,
  brief: ""
};

describe("report fact loaders", () => {
  beforeEach(() => {
    mocks.queryRows.mockReset();
  });

  it("loads exact facts with bounded parameterized filters", async () => {
    mocks.queryRows.mockResolvedValue([
      {
        product_family: "Controls",
        net_sales_nok: 100,
        gross_margin_nok: 25,
        units: 4
      }
    ]);

    const [facts] = await loadReportFacts(["sales"], spec);
    const [query, parameters, operation] = mocks.queryRows.mock.calls[0];

    expect(query).toContain("[month] >= @sales_from");
    expect(query).toContain("region IN (@sales_region_0)");
    expect(query).toContain(
      "product_family IN (@sales_product_family_0)"
    );
    expect(parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "sales_region_0", value: "Norden" }),
        expect.objectContaining({
          name: "sales_product_family_0",
          value: "Controls"
        })
      ])
    );
    expect(operation).toBe("report_fact_sales");
    expect(facts.kpis.find((kpi) => kpi.id === "sales-margin")?.value).toBe(
      0.25
    );
    expect(facts.verificationRows).toHaveLength(1);
  });
});
