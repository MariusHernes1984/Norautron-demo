import { describe, expect, it } from "vitest";
import { buildTopicKpis, verifyTopicKpis } from "./fact-spec";

describe("deterministic FactSpec calculations", () => {
  it("uses ratio-of-sums rather than averaging percentages", () => {
    const rows = [
      { net_sales_nok: 100, gross_margin_nok: 10, units: 2 },
      { net_sales_nok: 300, gross_margin_nok: 120, units: 4 }
    ];
    const kpis = buildTopicKpis("sales", rows);

    expect(kpis.find((kpi) => kpi.id === "sales-total")?.value).toBe(400);
    expect(kpis.find((kpi) => kpi.id === "sales-margin")?.value).toBe(0.325);
    expect(kpis.find((kpi) => kpi.id === "sales-units")?.value).toBe(6);
    expect(
      verifyTopicKpis({ topic: "sales", rows, kpis }).every(
        (check) => check.ok
      )
    ).toBe(true);
  });

  it("weights supplier delay by observations and detects tampering", () => {
    const rows = [
      {
        received_units: 100,
        rejected_units: 2,
        delay_day_total: 10,
        delay_observation_count: 10,
        total_cost_nok: 5_000
      },
      {
        received_units: 20,
        rejected_units: 3,
        delay_day_total: 18,
        delay_observation_count: 2,
        total_cost_nok: 2_000
      }
    ];
    const kpis = buildTopicKpis("supply", rows);
    expect(kpis.find((kpi) => kpi.id === "supply-delay")?.value).toBeCloseTo(
      28 / 12
    );

    kpis[0] = { ...kpis[0], value: 99 };
    expect(
      verifyTopicKpis({ topic: "supply", rows, kpis })[0].ok
    ).toBe(false);
  });
});
