import { describe, expect, it } from "vitest";
import { parseReportSpec, REPORT_LIMITS } from "./spec";

function validSpec() {
  return {
    topics: ["sales"],
    language: "no",
    audience: "ledelse",
    includeRisks: true,
    includeActions: true,
    includeMethodology: false,
    brief: ""
  };
}

describe("report specification validation", () => {
  it("normalizes omitted filters to a bounded empty filter set", () => {
    const parsed = parseReportSpec(validSpec());
    expect(parsed).toEqual({
      ok: true,
      value: expect.objectContaining({
        filters: { regions: [], productFamilies: [], factories: [] }
      })
    });
  });

  it("rejects duplicate topics, reversed dates and oversized inputs", () => {
    expect(
      parseReportSpec({ ...validSpec(), topics: ["sales", "sales"] }).ok
    ).toBe(false);
    expect(
      parseReportSpec({
        ...validSpec(),
        periodFrom: "2026-02-01",
        periodTo: "2026-01-01"
      }).ok
    ).toBe(false);
    expect(
      parseReportSpec({
        ...validSpec(),
        brief: "x".repeat(REPORT_LIMITS.briefCharacters + 1)
      }).ok
    ).toBe(false);
    expect(
      parseReportSpec({
        ...validSpec(),
        filters: {
          regions: Array.from(
            { length: REPORT_LIMITS.filterValues + 1 },
            (_, index) => `R${index}`
          ),
          productFamilies: [],
          factories: []
        }
      }).ok
    ).toBe(false);
  });
});
