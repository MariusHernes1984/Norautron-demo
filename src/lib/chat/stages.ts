import type { PipelineStage } from "@/lib/types";

const stages = new Set<PipelineStage>(["schema", "sql", "query", "compose"]);

export function isPipelineStage(value: unknown): value is PipelineStage {
  return typeof value === "string" && stages.has(value as PipelineStage);
}
