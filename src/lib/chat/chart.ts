import type { ChartSpec, Row } from "../types";

const PERCENT_COLUMN = /(?:^|_)(pct|percent|share|andel|prosent|procent)(?:_|$)/i;
const TEMPORAL_COLUMN = /(date|dato|month|maned|måned|year|aar|år|time|tid)/i;

function numeric(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = value.trim().replace(",", ".");
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function category(value: unknown) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value !== "string" && typeof value !== "number") return null;
  const label = String(value).trim();
  return label ? label : null;
}

function measureFamily(column: string) {
  if (/(?:^|_)(nok|cost|revenue|sales|margin|value|verdi|kostnad)(?:_|$)/i.test(column)) {
    return "currency";
  }
  if (/(?:^|_)(count|units?|antall|volume|volum)(?:_|$)/i.test(column)) {
    return "count";
  }
  if (/(?:^|_)(days?|dager|min|minutes?|hours?|timer)(?:_|$)/i.test(column)) {
    return "duration";
  }
  return column.toLowerCase();
}

export function inferChartFromResult(
  columns: string[],
  rows: Row[]
): ChartSpec | null {
  if (
    !Array.isArray(columns) ||
    !Array.isArray(rows) ||
    rows.length < 2 ||
    rows.length > 40 ||
    columns.length < 2 ||
    new Set(columns).size !== columns.length ||
    columns.some((column) => !column.trim())
  ) {
    return null;
  }

  const allNumericColumns = columns.filter(
    (column) =>
      rows.every((row) => numeric(row[column]) !== null)
  );
  const categoryColumns = columns.filter(
    (column) => !allNumericColumns.includes(column)
  );
  const numericTemporalColumns = allNumericColumns.filter((column) =>
    TEMPORAL_COLUMN.test(column)
  );
  if (
    categoryColumns.length > 1 ||
    (categoryColumns.length === 0 && numericTemporalColumns.length !== 1)
  ) {
    return null;
  }

  const xKey = categoryColumns[0] ?? numericTemporalColumns[0];
  const numericColumns = allNumericColumns.filter((column) => column !== xKey);
  if (!numericColumns.length) return null;
  const values = rows.map((row) => category(row[xKey]));
  if (values.some((value) => value === null)) return null;
  const labels = values as string[];
  if (new Set(labels).size !== rows.length) return null;

  const percentColumns = numericColumns.filter(
    (column) =>
      PERCENT_COLUMN.test(column) &&
      rows.every((row) => {
        const value = numeric(row[column]);
        return value !== null && value >= 0 && value <= 100;
      })
  );
  const chartableColumns = numericColumns.filter(
    (column) =>
      !PERCENT_COLUMN.test(column) || percentColumns.includes(column)
  );
  if (!chartableColumns.length) return null;
  const firstFamily = measureFamily(chartableColumns[0]);
  const yKeys = percentColumns.length
    ? percentColumns.slice(0, 4)
    : chartableColumns
        .filter((column) => measureFamily(column) === firstFamily)
        .slice(0, 4);
  if (!yKeys.length) return null;

  const temporal =
    TEMPORAL_COLUMN.test(xKey) ||
    labels.every((value) => /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(value));
  const chartRows = rows.map((row, index) => ({
    [xKey]: labels[index],
    ...Object.fromEntries(
      yKeys.map((key) => {
        const value = numeric(row[key]) as number;
        return [
          key,
          percentColumns.includes(key) && value > 1 ? value / 100 : value
        ];
      })
    )
  }));
  const pieSafe =
    !temporal &&
    rows.length <= 6 &&
    yKeys.length === 1 &&
    chartRows.every((row) => (row[yKeys[0]] as number) >= 0) &&
    chartRows.some((row) => (row[yKeys[0]] as number) > 0);

  return {
    type: temporal ? "line" : pieSafe ? "pie" : "bar",
    title: `${yKeys.join(", ")} per ${xKey}`,
    xKey,
    yKeys,
    data: chartRows,
    ...(percentColumns.length ? { percent: true } : {})
  };
}
