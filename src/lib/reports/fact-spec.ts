import type {
  KpiTopicId,
  ReportKpi,
  ReportQaCheck,
  Row
} from "../types";
import { formatNok } from "../utils";

export type FactSpec = {
  id: string;
  topic: KpiTopicId;
  label: string;
  sourceView: string;
  calculate: (rows: Row[]) => number;
  format: (value: number) => string;
};

const numberValue = (value: unknown) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const sum = (rows: Row[], column: string) =>
  rows.reduce((total, row) => total + numberValue(row[column]), 0);

const ratio = (numerator: number, denominator: number) =>
  denominator === 0 ? 0 : numerator / denominator;

const percent = (value: number) =>
  new Intl.NumberFormat("nb-NO", {
    style: "percent",
    maximumFractionDigits: 1
  }).format(value);

const decimal = (value: number, suffix = "") =>
  `${new Intl.NumberFormat("nb-NO", {
    maximumFractionDigits: 1
  }).format(value)}${suffix}`;

const integer = (value: number) =>
  new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 0 }).format(value);

export const FACT_SPECS: readonly FactSpec[] = [
  {
    id: "net-sales",
    topic: "executive",
    label: "Nettosalg",
    sourceView: "metrics.sales_monthly",
    calculate: (rows) => sum(rows, "net_sales_nok"),
    format: formatNok
  },
  {
    id: "gross-margin",
    topic: "executive",
    label: "Bruttomargin",
    sourceView: "metrics.sales_monthly",
    calculate: (rows) =>
      ratio(sum(rows, "gross_margin_nok"), sum(rows, "net_sales_nok")),
    format: percent
  },
  {
    id: "oee",
    topic: "executive",
    label: "Gjennomsnittlig OEE",
    sourceView: "metrics.production_daily",
    calculate: (rows) =>
      ratio(sum(rows, "oee_total"), sum(rows, "oee_observation_count")),
    format: percent
  },
  {
    id: "defect-rate",
    topic: "executive",
    label: "Defektrate",
    sourceView: "metrics.quality_summary",
    calculate: (rows) =>
      ratio(sum(rows, "defect_units"), sum(rows, "affected_units")),
    format: percent
  },
  {
    id: "weighted-pipeline",
    topic: "executive",
    label: "Vektet åpen pipeline",
    sourceView: "metrics.pipeline_summary",
    calculate: (rows) => sum(rows, "weighted_value_nok"),
    format: formatNok
  },
  {
    id: "supplier-delay",
    topic: "executive",
    label: "Leverandørforsinkelse",
    sourceView: "metrics.supply_summary",
    calculate: (rows) =>
      ratio(sum(rows, "delay_day_total"), sum(rows, "delay_observation_count")),
    format: (value) => decimal(value, " dager")
  },
  {
    id: "sales-total",
    topic: "sales",
    label: "Nettosalg",
    sourceView: "metrics.sales_monthly",
    calculate: (rows) => sum(rows, "net_sales_nok"),
    format: formatNok
  },
  {
    id: "sales-margin",
    topic: "sales",
    label: "Bruttomargin",
    sourceView: "metrics.sales_monthly",
    calculate: (rows) =>
      ratio(sum(rows, "gross_margin_nok"), sum(rows, "net_sales_nok")),
    format: percent
  },
  {
    id: "sales-units",
    topic: "sales",
    label: "Solgte enheter",
    sourceView: "metrics.sales_monthly",
    calculate: (rows) => sum(rows, "units"),
    format: integer
  },
  {
    id: "approved-units",
    topic: "production",
    label: "Godkjent volum",
    sourceView: "metrics.production_daily",
    calculate: (rows) => sum(rows, "approved_units"),
    format: integer
  },
  {
    id: "scrap-share",
    topic: "production",
    label: "Skrapandel",
    sourceView: "metrics.production_daily",
    calculate: (rows) => {
      const scrap = sum(rows, "scrap_units");
      return ratio(scrap, sum(rows, "approved_units") + scrap);
    },
    format: percent
  },
  {
    id: "production-oee",
    topic: "production",
    label: "Gjennomsnittlig OEE",
    sourceView: "metrics.production_daily",
    calculate: (rows) =>
      ratio(sum(rows, "oee_total"), sum(rows, "oee_observation_count")),
    format: percent
  },
  {
    id: "pipeline-weighted",
    topic: "pipeline",
    label: "Vektet åpen pipeline",
    sourceView: "metrics.pipeline_summary",
    calculate: (rows) => sum(rows, "weighted_value_nok"),
    format: formatNok
  },
  {
    id: "pipeline-opportunities",
    topic: "pipeline",
    label: "Åpne muligheter",
    sourceView: "metrics.pipeline_summary",
    calculate: (rows) => sum(rows, "opportunity_count"),
    format: integer
  },
  {
    id: "pipeline-age",
    topic: "pipeline",
    label: "Gjennomsnittlig pipelinealder",
    sourceView: "metrics.pipeline_summary",
    calculate: (rows) =>
      ratio(
        sum(rows, "pipeline_days_total"),
        sum(rows, "pipeline_days_observation_count")
      ),
    format: (value) => decimal(value, " dager")
  },
  {
    id: "quality-rate",
    topic: "quality",
    label: "Defektrate",
    sourceView: "metrics.quality_summary",
    calculate: (rows) =>
      ratio(sum(rows, "defect_units"), sum(rows, "affected_units")),
    format: percent
  },
  {
    id: "quality-cost",
    topic: "quality",
    label: "Kvalitetskostnad",
    sourceView: "metrics.quality_summary",
    calculate: (rows) => sum(rows, "quality_cost_nok"),
    format: formatNok
  },
  {
    id: "quality-deviations",
    topic: "quality",
    label: "Registrerte avvik",
    sourceView: "metrics.quality_summary",
    calculate: (rows) => sum(rows, "deviation_count"),
    format: integer
  },
  {
    id: "supply-delay",
    topic: "supply",
    label: "Gjennomsnittlig forsinkelse",
    sourceView: "metrics.supply_summary",
    calculate: (rows) =>
      ratio(sum(rows, "delay_day_total"), sum(rows, "delay_observation_count")),
    format: (value) => decimal(value, " dager")
  },
  {
    id: "supply-rejection-rate",
    topic: "supply",
    label: "Avvisningsgrad",
    sourceView: "metrics.supply_summary",
    calculate: (rows) =>
      ratio(sum(rows, "rejected_units"), sum(rows, "received_units")),
    format: percent
  },
  {
    id: "supply-spend",
    topic: "supply",
    label: "Innkjøpsverdi",
    sourceView: "metrics.supply_summary",
    calculate: (rows) => sum(rows, "total_cost_nok"),
    format: formatNok
  }
] as const;

export function factSpecsForTopic(topic: KpiTopicId) {
  return FACT_SPECS.filter((spec) => spec.topic === topic);
}

export function buildTopicKpis(
  topic: KpiTopicId,
  rows: Row[]
): ReportKpi[] {
  return factSpecsForTopic(topic).map((spec) => {
    const value = spec.calculate(rows);
    return {
      id: spec.id,
      label: spec.label,
      value,
      formatted: spec.format(value),
      sourceView: spec.sourceView
    };
  });
}

export function verifyTopicKpis(input: {
  topic: KpiTopicId;
  rows: Row[];
  kpis: ReportKpi[];
}): ReportQaCheck[] {
  const actualById = new Map(input.kpis.map((kpi) => [kpi.id, kpi]));
  return factSpecsForTopic(input.topic).map((spec) => {
    const expected = spec.calculate(input.rows);
    const actual = actualById.get(spec.id);
    const tolerance = Math.max(1e-8, Math.abs(expected) * 1e-10);
    return {
      factId: spec.id,
      sourceView: spec.sourceView,
      expected,
      actual: actual?.value ?? Number.NaN,
      ok:
        actual?.sourceView === spec.sourceView &&
        Number.isFinite(actual.value) &&
        Math.abs(actual.value - expected) <= tolerance &&
        actual.formatted === spec.format(actual.value)
    };
  });
}
