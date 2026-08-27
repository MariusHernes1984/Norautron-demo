import type { TokenUsage } from "../model";
import { logSafeError } from "../http";
import { executeSql } from "./query";

export async function logUsage(input: {
  kind: "chat" | "report";
  deployment: string;
  usage?: TokenUsage;
  ok: boolean;
}) {
  try {
    await executeSql(
      `
        INSERT INTO app.usage_log
          (kind, deployment, input_tokens, output_tokens, total_tokens, succeeded)
        VALUES
          (@kind, @deployment, @input, @output, @total, @ok)
      `,
      [
        { name: "kind", type: "nvarchar", length: 20, value: input.kind },
        {
          name: "deployment",
          type: "nvarchar",
          length: 100,
          value: input.deployment
        },
        {
          name: "input",
          type: "int",
          value: input.usage?.inputTokens ?? 0
        },
        {
          name: "output",
          type: "int",
          value: input.usage?.outputTokens ?? 0
        },
        {
          name: "total",
          type: "int",
          value: input.usage?.totalTokens ?? 0
        },
        { name: "ok", type: "bit", value: input.ok }
      ],
      "usage_log"
    );
  } catch (error) {
    logSafeError("Usage logging failed", error);
  }
}
