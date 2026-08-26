import { describe, expect, it } from "vitest";
import {
  analyticsObjectMetadata,
  buildSchemaCard,
  sqlAllowlist
} from "./schema";

describe("chat schema metadata", () => {
  it("covers all five analytics tables and all metrics views", () => {
    const metadata = analyticsObjectMetadata();
    expect(
      metadata
        .filter((object) => object.kind === "analytics-table")
        .map((object) => object.object)
    ).toEqual([
      "analytics.production",
      "analytics.erp_sales",
      "analytics.crm_pipeline",
      "analytics.quality",
      "analytics.supply"
    ]);
    expect(
      metadata
        .filter((object) => object.kind === "metrics-view")
        .map((object) => object.object)
    ).toEqual([
      "metrics.executive_kpis",
      "metrics.sales_monthly",
      "metrics.production_daily",
      "metrics.pipeline_summary",
      "metrics.quality_summary",
      "metrics.supply_summary"
    ]);
  });

  it("derives strict per-object allowlists from metadata", () => {
    const allowlist = sqlAllowlist();
    expect(allowlist.get("analytics.erp_sales")).toContain("nettosalg_nok");
    expect(allowlist.get("analytics.quality")).not.toContain("nettosalg_nok");
    expect(allowlist.get("metrics.sales_monthly")).toContain("month");
    expect(allowlist.get("metrics.production_daily")).not.toContain("month");
  });

  it("gives the model object-specific columns and data types", () => {
    const card = buildSchemaCard();
    expect(card).toContain("analytics.production (~18000 rows)");
    expect(card).toContain("produksjonsdato:date");
    expect(card).toContain("metrics.quality_summary");
    expect(card).toContain("defect_rate_pct:decimal");
  });
});
