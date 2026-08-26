"use client";

import { useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { ChartSpec } from "@/lib/types";

const colors = [
  "#008A00",
  "#0F766E",
  "#2563EB",
  "#D97706",
  "#7C3AED",
  "#DC2626"
];

export function ChartRenderer({ spec }: { spec: ChartSpec }) {
  const [type, setType] = useState(spec.type);
  const formatter = spec.percent
    ? (value: unknown) => `${(Number(value) * 100).toFixed(1)} %`
    : undefined;

  return (
    <section className="card p-4" data-pdf-avoid>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{spec.title}</h3>
        <div
          className="inline-flex rounded-full border border-[var(--border)] p-0.5 text-[11px]"
          aria-label="Diagramtype"
        >
          {(["bar", "hbar", "line", "area", "pie"] as const)
            .filter((candidate) => candidate !== "pie" || spec.yKeys.length === 1)
            .map((candidate) => (
              <button
                key={candidate}
                type="button"
                className={`rounded-full px-2 py-1 ${
                  type === candidate
                    ? "bg-[var(--brand)] text-white"
                    : "text-[var(--muted)]"
                }`}
                onClick={() => setType(candidate)}
              >
                {candidate}
              </button>
            ))}
        </div>
      </div>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {type === "bar" ? (
            <BarChart data={spec.data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey={spec.xKey} tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={formatter} />
              <Tooltip formatter={formatter} />
              {spec.yKeys.length > 1 && <Legend />}
              {spec.yKeys.map((key, index) => (
                <Bar
                  key={key}
                  dataKey={key}
                  fill={colors[index % colors.length]}
                  radius={[5, 5, 0, 0]}
                />
              ))}
            </BarChart>
          ) : type === "hbar" ? (
            <BarChart data={spec.data} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={formatter} />
              <YAxis
                type="category"
                dataKey={spec.xKey}
                width={150}
                tick={{ fontSize: 11 }}
              />
              <Tooltip formatter={formatter} />
              {spec.yKeys.map((key, index) => (
                <Bar
                  key={key}
                  dataKey={key}
                  fill={colors[index % colors.length]}
                  radius={[0, 5, 5, 0]}
                />
              ))}
            </BarChart>
          ) : type === "line" ? (
            <LineChart data={spec.data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey={spec.xKey} tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={formatter} />
              <Tooltip formatter={formatter} />
              {spec.yKeys.length > 1 && <Legend />}
              {spec.yKeys.map((key, index) => (
                <Line
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stroke={colors[index % colors.length]}
                  strokeWidth={2.5}
                />
              ))}
            </LineChart>
          ) : type === "area" ? (
            <AreaChart data={spec.data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey={spec.xKey} tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={formatter} />
              <Tooltip formatter={formatter} />
              {spec.yKeys.map((key, index) => (
                <Area
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stroke={colors[index % colors.length]}
                  fill={colors[index % colors.length]}
                  fillOpacity={0.14}
                />
              ))}
            </AreaChart>
          ) : (
            <PieChart>
              <Pie
                data={spec.data}
                dataKey={spec.yKeys[0]}
                nameKey={spec.xKey}
                outerRadius={90}
                label
              >
                {spec.data.map((_, index) => (
                  <Cell key={index} fill={colors[index % colors.length]} />
                ))}
              </Pie>
              <Tooltip formatter={formatter} />
              <Legend />
            </PieChart>
          )}
        </ResponsiveContainer>
      </div>
    </section>
  );
}
