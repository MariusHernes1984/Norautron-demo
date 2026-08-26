import schema from "../../../data/schema.json";
import type { SqlAllowlist } from "./sql-guard";

type ColumnMetadata = Readonly<{ name: string; type: string }>;

export type AnalyticsObjectMetadata = Readonly<{
  object: string;
  kind: "analytics-table" | "metrics-view";
  columns: readonly ColumnMetadata[];
  rowHint?: number;
}>;

const METRIC_VIEWS = [
  {
    object: "metrics.executive_kpis",
    columns: [
      ["net_sales_nok", "decimal"],
      ["gross_margin_nok", "decimal"],
      ["gross_margin_pct", "decimal"],
      ["approved_units", "integer"],
      ["oee_pct", "decimal"],
      ["defect_rate_pct", "decimal"],
      ["weighted_open_pipeline_nok", "decimal"],
      ["supplier_delay_days", "decimal"],
      ["dataset_version", "string"]
    ]
  },
  {
    object: "metrics.sales_monthly",
    columns: [
      ["month", "date"],
      ["region", "string"],
      ["segment", "string"],
      ["product_family", "string"],
      ["net_sales_nok", "decimal"],
      ["gross_margin_nok", "decimal"],
      ["gross_margin_pct", "decimal"],
      ["units", "integer"]
    ]
  },
  {
    object: "metrics.production_daily",
    columns: [
      ["production_date", "date"],
      ["factory", "string"],
      ["production_line", "string"],
      ["shift", "string"],
      ["product_family", "string"],
      ["planned_units", "integer"],
      ["produced_units", "integer"],
      ["approved_units", "integer"],
      ["scrap_units", "integer"],
      ["oee_pct", "decimal"],
      ["oee_total", "decimal"],
      ["oee_observation_count", "bigint"],
      ["utilization_pct", "decimal"],
      ["energy_kwh", "decimal"]
    ]
  },
  {
    object: "metrics.pipeline_summary",
    columns: [
      ["expected_close_month", "date"],
      ["sales_stage", "string"],
      ["status", "string"],
      ["region", "string"],
      ["segment", "string"],
      ["product_family", "string"],
      ["opportunity_count", "bigint"],
      ["estimated_value_nok", "decimal"],
      ["weighted_value_nok", "decimal"],
      ["average_days_in_pipeline", "decimal"],
      ["pipeline_days_total", "decimal"],
      ["pipeline_days_observation_count", "bigint"]
    ]
  },
  {
    object: "metrics.quality_summary",
    columns: [
      ["registered_month", "date"],
      ["factory", "string"],
      ["production_line", "string"],
      ["product_family", "string"],
      ["supplier_id", "string"],
      ["severity", "string"],
      ["deviation_category", "string"],
      ["deviation_count", "bigint"],
      ["affected_units", "integer"],
      ["defect_units", "integer"],
      ["defect_rate_pct", "decimal"],
      ["quality_cost_nok", "decimal"]
    ]
  },
  {
    object: "metrics.supply_summary",
    columns: [
      ["movement_month", "date"],
      ["factory", "string"],
      ["supplier_id", "string"],
      ["supplier", "string"],
      ["supplier_country", "string"],
      ["product_family", "string"],
      ["movement_count", "bigint"],
      ["ordered_units", "integer"],
      ["received_units", "integer"],
      ["rejected_units", "integer"],
      ["average_delay_days", "decimal"],
      ["delay_day_total", "decimal"],
      ["delay_observation_count", "bigint"],
      ["total_cost_nok", "decimal"]
    ]
  }
] as const;

const OBJECT_METADATA: readonly AnalyticsObjectMetadata[] = [
  ...schema.sources.map((source) => ({
    object: `analytics.${source.table}`,
    kind: "analytics-table" as const,
    rowHint: source.expectedRows,
    columns: source.columns.map((name, index) => ({
      name,
      type: source.types[index] ?? "unknown"
    }))
  })),
  ...METRIC_VIEWS.map((view) => ({
    object: view.object,
    kind: "metrics-view" as const,
    columns: view.columns.map(([name, type]) => ({ name, type }))
  }))
];

export function analyticsObjectMetadata() {
  return OBJECT_METADATA;
}

export function sqlAllowlist(): SqlAllowlist {
  const objects = new Map<string, ReadonlySet<string>>();
  for (const metadata of OBJECT_METADATA) {
    objects.set(
      metadata.object.toLowerCase(),
      new Set(metadata.columns.map((column) => column.name.toLowerCase()))
    );
  }
  return objects;
}

export function buildSchemaCard() {
  return OBJECT_METADATA.map(
    (metadata) =>
      `${metadata.object}${
        metadata.rowHint ? ` (~${metadata.rowHint} rows)` : ""
      }:\n  ${metadata.columns
        .map((column) => `${column.name}:${column.type}`)
        .join(", ")}`
  )
    .join("\n\n");
}
