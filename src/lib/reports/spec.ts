import { z } from "zod";
import type { ReportSpec } from "../types";

export const REPORT_LIMITS = {
  topics: 6,
  titleCharacters: 120,
  briefCharacters: 600,
  filterValues: 6,
  filterValueCharacters: 80
} as const;

const topicIds = [
  "executive",
  "sales",
  "pipeline",
  "production",
  "quality",
  "supply"
] as const;

const boundedFilter = z
  .array(z.string().trim().min(1).max(REPORT_LIMITS.filterValueCharacters))
  .max(REPORT_LIMITS.filterValues)
  .refine(
    (values) =>
      new Set(values.map((value) => value.toLocaleLowerCase("nb-NO"))).size ===
      values.length,
    "Filterverdiene må være unike."
  );

export const reportSpecSchema = z
  .object({
    title: z
      .string()
      .trim()
      .max(REPORT_LIMITS.titleCharacters)
      .optional(),
    topics: z
      .array(z.enum(topicIds))
      .min(1)
      .max(REPORT_LIMITS.topics)
      .refine(
        (topics) => new Set(topics).size === topics.length,
        "Rapportområdene må være unike."
      ),
    language: z.enum(["no", "en"]),
    audience: z.enum(["ledelse", "salg", "drift"]),
    periodFrom: z
      .string()
      .date()
      .optional(),
    periodTo: z
      .string()
      .date()
      .optional(),
    filters: z
      .object({
        regions: boundedFilter.default([]),
        productFamilies: boundedFilter.default([]),
        factories: boundedFilter.default([])
      })
      .strict()
      .default({
        regions: [],
        productFamilies: [],
        factories: []
      }),
    includeRisks: z.boolean(),
    includeActions: z.boolean(),
    includeMethodology: z.boolean(),
    brief: z.string().trim().max(REPORT_LIMITS.briefCharacters)
  })
  .strict()
  .refine(
    (spec) =>
      !spec.periodFrom || !spec.periodTo || spec.periodFrom <= spec.periodTo,
    { message: "Rapportperioden er ugyldig.", path: ["periodTo"] }
  );

export function parseReportSpec(value: unknown):
  | { ok: true; value: ReportSpec }
  | { ok: false } {
  const parsed = reportSpecSchema.safeParse(value);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false };
}
