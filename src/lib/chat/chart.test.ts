import { describe, expect, it } from "vitest";
import { inferChartFromResult } from "./chart";

describe("inferChartFromResult", () => {
  it("creates a pie chart for a small grouped numeric result", () => {
    const result = inferChartFromResult(
      ["region", "nettosalg_nok"],
      [
        { region: "Norge", nettosalg_nok: 10 },
        { region: "Sverige", nettosalg_nok: 20 }
      ]
    );
    expect(result?.type).toBe("pie");
    expect(result?.yKeys).toEqual(["nettosalg_nok"]);
  });

  it("creates a line chart for temporal categories", () => {
    const result = inferChartFromResult(
      ["month", "net_sales_nok"],
      [
        { month: "2026-01", net_sales_nok: 10 },
        { month: "2026-02", net_sales_nok: 20 }
      ]
    );
    expect(result?.type).toBe("line");
  });

  it("treats a numeric year as the temporal category", () => {
    const result = inferChartFromResult(
      ["sales_year", "net_sales_nok"],
      [
        { sales_year: 2025, net_sales_nok: 10 },
        { sales_year: 2026, net_sales_nok: 20 }
      ]
    );
    expect(result).toEqual(
      expect.objectContaining({
        type: "line",
        xKey: "sales_year",
        yKeys: ["net_sales_nok"]
      })
    );
  });

  it("normalizes percentage points to the renderer's ratio contract", () => {
    const result = inferChartFromResult(
      ["region", "gross_margin_pct"],
      [
        { region: "Norge", gross_margin_pct: 25 },
        { region: "Sverige", gross_margin_pct: 0.4 }
      ]
    );
    expect(result?.percent).toBe(true);
    expect(result?.data).toEqual([
      { region: "Norge", gross_margin_pct: 0.25 },
      { region: "Sverige", gross_margin_pct: 0.4 }
    ]);
  });

  it("keeps only measures with compatible units", () => {
    const result = inferChartFromResult(
      ["region", "net_sales_nok", "units"],
      [
        { region: "Norge", net_sales_nok: 10, units: 200 },
        { region: "Sverige", net_sales_nok: 20, units: 300 }
      ]
    );
    expect(result?.yKeys).toEqual(["net_sales_nok"]);
  });

  it.each([
    {
      columns: ["region", "value"],
      rows: [
        { region: "Norge", value: 1 },
        { region: "Norge", value: 2 }
      ]
    },
    {
      columns: ["region", "segment", "value"],
      rows: [
        { region: "Norge", segment: "A", value: 1 },
        { region: "Sverige", segment: "B", value: 2 }
      ]
    },
    {
      columns: ["region", "value"],
      rows: [
        { region: "Norge", value: null },
        { region: "Sverige", value: 2 }
      ]
    },
    {
      columns: ["region", "value"],
      rows: [
        { region: "Norge", value: "0x10" },
        { region: "Sverige", value: "20" }
      ]
    },
    {
      columns: ["region", "defect_rate_pct"],
      rows: [
        { region: "Norge", defect_rate_pct: 101 },
        { region: "Sverige", defect_rate_pct: 120 }
      ]
    }
  ])("rejects results that cannot be represented safely", ({ columns, rows }) => {
    expect(inferChartFromResult(columns, rows)).toBeNull();
  });
});
