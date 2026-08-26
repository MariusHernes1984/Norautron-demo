import { inferChartFromResult } from "../chat/chart";
import { KPI_TOPICS } from "../constants";
import { queryRows, type SqlParameter } from "../db/query";
import type {
  ChartSpec,
  KpiTopicId,
  ReportKpi,
  ReportSpec,
  Row
} from "../types";
import { buildTopicKpis } from "./fact-spec";

export type TopicFacts = {
  topic: KpiTopicId;
  label: string;
  kpis: ReportKpi[];
  rows: Row[];
  verificationRows: Row[];
  chart: ChartSpec | null;
};

type FilterColumns = {
  date: string;
  region?: string;
  productFamily?: string;
  factory?: string;
};

function sqlDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function filteredWhere(
  spec: ReportSpec,
  prefix: string,
  columns: FilterColumns,
  base: string[] = []
) {
  const predicates = [...base];
  const parameters: SqlParameter[] = [];
  if (spec.periodFrom) {
    predicates.push(`${columns.date} >= @${prefix}_from`);
    parameters.push({
      name: `${prefix}_from`,
      type: "datetime2",
      value: sqlDate(spec.periodFrom)
    });
  }
  if (spec.periodTo) {
    predicates.push(`${columns.date} <= @${prefix}_to`);
    parameters.push({
      name: `${prefix}_to`,
      type: "datetime2",
      value: sqlDate(spec.periodTo)
    });
  }

  const dimensions = [
    ["region", columns.region, spec.filters.regions],
    ["product_family", columns.productFamily, spec.filters.productFamilies],
    ["factory", columns.factory, spec.filters.factories]
  ] as const;
  for (const [name, column, values] of dimensions) {
    if (!column || values.length === 0) continue;
    const bindings = values.map((value, index) => {
      const parameterName = `${prefix}_${name}_${index}`;
      parameters.push({
        name: parameterName,
        type: "nvarchar",
        length: 80,
        value
      });
      return `@${parameterName}`;
    });
    predicates.push(`${column} IN (${bindings.join(", ")})`);
  }

  return {
    clause: predicates.length ? `WHERE ${predicates.join(" AND ")}` : "",
    parameters
  };
}

function topicLabel(topic: KpiTopicId) {
  return KPI_TOPICS.find((item) => item.id === topic)?.label ?? topic;
}

function topicFacts(
  topic: KpiTopicId,
  verificationRows: Row[],
  rows: Row[],
  chart: ChartSpec | null
): TopicFacts {
  return {
    topic,
    label: topicLabel(topic),
    kpis: buildTopicKpis(topic, verificationRows),
    verificationRows,
    rows,
    chart
  };
}

async function executive(spec: ReportSpec): Promise<TopicFacts> {
  const sales = filteredWhere(spec, "ex_sales", {
    date: "[month]",
    region: "region",
    productFamily: "product_family"
  });
  const production = filteredWhere(spec, "ex_production", {
    date: "production_date",
    factory: "factory",
    productFamily: "product_family"
  });
  const pipeline = filteredWhere(
    spec,
    "ex_pipeline",
    {
      date: "expected_close_month",
      region: "region",
      productFamily: "product_family"
    },
    ["status = N'Apen'"]
  );
  const quality = filteredWhere(spec, "ex_quality", {
    date: "registered_month",
    factory: "factory",
    productFamily: "product_family"
  });
  const supply = filteredWhere(spec, "ex_supply", {
    date: "movement_month",
    factory: "factory",
    productFamily: "product_family"
  });
  const rows = await queryRows(
    `
      SELECT
        (SELECT SUM(net_sales_nok) FROM metrics.sales_monthly ${sales.clause})
          AS net_sales_nok,
        (SELECT SUM(gross_margin_nok) FROM metrics.sales_monthly ${sales.clause})
          AS gross_margin_nok,
        (SELECT SUM(oee_total) FROM metrics.production_daily ${production.clause})
          AS oee_total,
        (SELECT SUM(oee_observation_count) FROM metrics.production_daily ${production.clause})
          AS oee_observation_count,
        (SELECT SUM(defect_units) FROM metrics.quality_summary ${quality.clause})
          AS defect_units,
        (SELECT SUM(affected_units) FROM metrics.quality_summary ${quality.clause})
          AS affected_units,
        (SELECT SUM(weighted_value_nok) FROM metrics.pipeline_summary ${pipeline.clause})
          AS weighted_value_nok,
        (SELECT SUM(delay_day_total) FROM metrics.supply_summary ${supply.clause})
          AS delay_day_total,
        (SELECT SUM(delay_observation_count) FROM metrics.supply_summary ${supply.clause})
          AS delay_observation_count
    `,
    [
      ...sales.parameters,
      ...production.parameters,
      ...pipeline.parameters,
      ...quality.parameters,
      ...supply.parameters
    ],
    "report_fact_executive"
  );
  return topicFacts("executive", rows, rows, null);
}

async function sales(spec: ReportSpec): Promise<TopicFacts> {
  const filter = filteredWhere(spec, "sales", {
    date: "[month]",
    region: "region",
    productFamily: "product_family"
  });
  const rows = await queryRows(
    `
      SELECT
        product_family,
        SUM(net_sales_nok) AS net_sales_nok,
        SUM(gross_margin_nok) AS gross_margin_nok,
        SUM(units) AS units
      FROM metrics.sales_monthly
      ${filter.clause}
      GROUP BY product_family
      ORDER BY net_sales_nok DESC, product_family
    `,
    filter.parameters,
    "report_fact_sales"
  );
  const displayRows = rows.slice(0, 18);
  return topicFacts(
    "sales",
    rows,
    displayRows,
    inferChartFromResult(["product_family", "net_sales_nok"], displayRows)
  );
}

async function production(spec: ReportSpec): Promise<TopicFacts> {
  const filter = filteredWhere(spec, "production", {
    date: "production_date",
    factory: "factory",
    productFamily: "product_family"
  });
  const rows = await queryRows(
    `
      SELECT
        product_family,
        SUM(approved_units) AS approved_units,
        SUM(scrap_units) AS scrap_units,
        SUM(oee_total) AS oee_total,
        SUM(oee_observation_count) AS oee_observation_count
      FROM metrics.production_daily
      ${filter.clause}
      GROUP BY product_family
      ORDER BY approved_units DESC, product_family
    `,
    filter.parameters,
    "report_fact_production"
  );
  const displayRows = rows.slice(0, 18);
  return topicFacts(
    "production",
    rows,
    displayRows,
    inferChartFromResult(
      ["product_family", "approved_units", "scrap_units"],
      displayRows
    )
  );
}

async function pipeline(spec: ReportSpec): Promise<TopicFacts> {
  const filter = filteredWhere(
    spec,
    "pipeline",
    {
      date: "expected_close_month",
      region: "region",
      productFamily: "product_family"
    },
    ["status = N'Apen'"]
  );
  const rows = await queryRows(
    `
      SELECT
        sales_stage,
        SUM(opportunity_count) AS opportunity_count,
        SUM(weighted_value_nok) AS weighted_value_nok,
        SUM(pipeline_days_total) AS pipeline_days_total,
        SUM(pipeline_days_observation_count) AS pipeline_days_observation_count
      FROM metrics.pipeline_summary
      ${filter.clause}
      GROUP BY sales_stage
      ORDER BY weighted_value_nok DESC, sales_stage
    `,
    filter.parameters,
    "report_fact_pipeline"
  );
  const displayRows = rows.slice(0, 12);
  return topicFacts(
    "pipeline",
    rows,
    displayRows,
    inferChartFromResult(["sales_stage", "weighted_value_nok"], displayRows)
  );
}

async function quality(spec: ReportSpec): Promise<TopicFacts> {
  const filter = filteredWhere(spec, "quality", {
    date: "registered_month",
    factory: "factory",
    productFamily: "product_family"
  });
  const rows = await queryRows(
    `
      SELECT
        product_family,
        SUM(deviation_count) AS deviation_count,
        SUM(affected_units) AS affected_units,
        SUM(defect_units) AS defect_units,
        SUM(quality_cost_nok) AS quality_cost_nok
      FROM metrics.quality_summary
      ${filter.clause}
      GROUP BY product_family
      ORDER BY quality_cost_nok DESC, product_family
    `,
    filter.parameters,
    "report_fact_quality"
  );
  const displayRows = rows.slice(0, 18);
  return topicFacts(
    "quality",
    rows,
    displayRows,
    inferChartFromResult(["product_family", "quality_cost_nok"], displayRows)
  );
}

async function supply(spec: ReportSpec): Promise<TopicFacts> {
  const filter = filteredWhere(spec, "supply", {
    date: "movement_month",
    factory: "factory",
    productFamily: "product_family"
  });
  const rows = await queryRows(
    `
      SELECT
        supplier,
        SUM(received_units) AS received_units,
        SUM(rejected_units) AS rejected_units,
        SUM(delay_day_total) AS delay_day_total,
        SUM(delay_observation_count) AS delay_observation_count,
        SUM(total_cost_nok) AS total_cost_nok
      FROM metrics.supply_summary
      ${filter.clause}
      GROUP BY supplier
      ORDER BY delay_day_total DESC, supplier
    `,
    filter.parameters,
    "report_fact_supply"
  );
  const displayRows = rows.slice(0, 10);
  return topicFacts(
    "supply",
    rows,
    displayRows,
    inferChartFromResult(["supplier", "delay_day_total"], displayRows)
  );
}

const loaders: Record<
  KpiTopicId,
  (spec: ReportSpec) => Promise<TopicFacts>
> = {
  executive,
  sales,
  pipeline,
  production,
  quality,
  supply
};

export async function loadReportFacts(
  topics: KpiTopicId[],
  spec: ReportSpec
) {
  const unique = Array.from(new Set(topics));
  return Promise.all(unique.map((topic) => loaders[topic](spec)));
}
