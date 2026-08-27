import { getBearerTokenProvider } from "@azure/identity";
import { AzureOpenAI } from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { getAzureCredential } from "./azure-credential";
import { startModelOperation } from "./telemetry";
import type { PipelineStage } from "./types";

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type ModelMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ModelEvent =
  | { kind: "delta"; text: string }
  | { kind: "usage"; deployment: string; usage: TokenUsage }
  | { kind: "stage"; stage: PipelineStage };

export type StreamModelOptions = {
  operation: string;
  messages: ModelMessage[];
  maxTokens: number;
  responseJson?: boolean;
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
  requestId?: string;
  signal?: AbortSignal;
};

export const DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-5.6-terra";
const TOKEN_SCOPE = "https://cognitiveservices.azure.com/.default";

let client: AzureOpenAI | undefined;

function getClient() {
  if (client) return client;
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT?.trim().replace(/\/+$/, "");
  if (!endpoint) {
    throw new Error("AZURE_OPENAI_ENDPOINT is required.");
  }
  let endpointUrl: URL;
  try {
    endpointUrl = new URL(endpoint);
  } catch {
    throw new Error("AZURE_OPENAI_ENDPOINT must be a valid URL.");
  }
  if (endpointUrl.protocol !== "https:") {
    throw new Error("AZURE_OPENAI_ENDPOINT must use HTTPS.");
  }

  client = new AzureOpenAI({
    endpoint,
    apiVersion: process.env.AZURE_OPENAI_API_VERSION || "2025-04-01-preview",
    azureADTokenProvider: getBearerTokenProvider(getAzureCredential(), TOKEN_SCOPE),
    maxRetries: 2,
    timeout: 120_000
  });
  return client;
}

export async function* streamModelEvents(
  options: StreamModelOptions
): AsyncIterable<ModelEvent> {
  const telemetry = startModelOperation(
    options.operation,
    DEPLOYMENT,
    options.requestId
  );
  let usage:
    | {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      }
    | undefined;

  try {
    options.signal?.throwIfAborted();
    const stream = await getClient().chat.completions.create(
      {
        model: DEPLOYMENT,
        messages: options.messages as ChatCompletionMessageParam[],
        stream: true,
        stream_options: { include_usage: true },
        max_completion_tokens: options.maxTokens,
        ...(options.reasoningEffort
          ? { reasoning_effort: options.reasoningEffort }
          : {}),
        ...(options.responseJson
          ? { response_format: { type: "json_object" as const } }
          : {})
      },
      { signal: options.signal }
    );

    let completed = false;
    try {
      for await (const chunk of stream) {
        options.signal?.throwIfAborted();
        const text = chunk.choices?.[0]?.delta?.content || "";
        if (text) yield { kind: "delta", text };
        const chunkUsage = (
          chunk as {
            usage?: {
              prompt_tokens?: number;
              completion_tokens?: number;
              total_tokens?: number;
            } | null;
          }
        ).usage;
        if (chunkUsage) usage = chunkUsage;
      }
      completed = true;
    } finally {
      if (!completed) {
        stream.controller.abort();
        telemetry.end(
          false,
          undefined,
          new DOMException("Model stream cancelled.", "AbortError")
        );
      }
    }

    const inputTokens = usage?.prompt_tokens ?? 0;
    const outputTokens = usage?.completion_tokens ?? 0;
    const normalizedUsage = {
      inputTokens,
      outputTokens,
      totalTokens: usage?.total_tokens ?? inputTokens + outputTokens
    };
    telemetry.end(true, normalizedUsage);
    if (usage) {
      yield {
        kind: "usage",
        deployment: DEPLOYMENT,
        usage: normalizedUsage
      };
    }
  } catch (error) {
    telemetry.end(false, undefined, error);
    throw error;
  }
}

export async function collectModelText(options: StreamModelOptions) {
  let text = "";
  let usage: TokenUsage | undefined;
  for await (const event of streamModelEvents(options)) {
    if (event.kind === "delta") text += event.text;
    if (event.kind === "usage") usage = event.usage;
  }
  return { text, usage };
}
