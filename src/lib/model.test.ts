// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  abort: vi.fn(),
  clientOptions: [] as unknown[],
  create: vi.fn(),
  credential: {},
  getBearerTokenProvider: vi.fn(),
  telemetryEnd: vi.fn(),
  tokenProvider: vi.fn()
}));

vi.mock("@azure/identity", () => ({
  getBearerTokenProvider: mocks.getBearerTokenProvider
}));

vi.mock("./azure-credential", () => ({
  getAzureCredential: () => mocks.credential
}));

vi.mock("./telemetry", () => ({
  startModelOperation: () => ({ end: mocks.telemetryEnd })
}));

vi.mock("openai", () => ({
  AzureOpenAI: class {
    chat = { completions: { create: mocks.create } };

    constructor(options: unknown) {
      mocks.clientOptions.push(options);
    }
  }
}));

import { DEPLOYMENT, streamModelEvents } from "./model";

function fakeStream(chunks: unknown[]) {
  return {
    controller: { abort: mocks.abort },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    }
  };
}

describe("model client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.clientOptions.length = 0;
    mocks.getBearerTokenProvider.mockReturnValue(mocks.tokenProvider);
    process.env.AZURE_OPENAI_ENDPOINT = "https://models.example.azure.com/";
  });

  it("uses managed identity and GPT-5.6 streaming parameters", async () => {
    mocks.create.mockResolvedValue(
      fakeStream([
        { choices: [{ delta: { content: "Hei" } }] },
        {
          choices: [],
          usage: {
            prompt_tokens: 8,
            completion_tokens: 3,
            total_tokens: 11
          }
        }
      ])
    );
    const signal = new AbortController().signal;
    const events = [];
    for await (const event of streamModelEvents({
      operation: "test",
      messages: [{ role: "user", content: "Hei" }],
      maxTokens: 400,
      reasoningEffort: "low",
      responseJson: true,
      signal
    })) {
      events.push(event);
    }

    expect(DEPLOYMENT).toBe(
      process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-5.6-terra"
    );
    expect(mocks.getBearerTokenProvider).toHaveBeenCalledWith(
      mocks.credential,
      "https://cognitiveservices.azure.com/.default"
    );
    expect(mocks.clientOptions[0]).toMatchObject({
      endpoint: "https://models.example.azure.com",
      apiVersion: "2025-04-01-preview",
      azureADTokenProvider: mocks.tokenProvider,
      maxRetries: 2,
      timeout: 120_000
    });
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: DEPLOYMENT,
        stream: true,
        stream_options: { include_usage: true },
        max_completion_tokens: 400,
        reasoning_effort: "low",
        response_format: { type: "json_object" }
      }),
      { signal }
    );
    expect(events).toEqual([
      { kind: "delta", text: "Hei" },
      {
        kind: "usage",
        deployment: DEPLOYMENT,
        usage: { inputTokens: 8, outputTokens: 3, totalTokens: 11 }
      }
    ]);
  });

  it("aborts the provider stream when the consumer stops early", async () => {
    mocks.create.mockResolvedValue(
      fakeStream([
        { choices: [{ delta: { content: "first" } }] },
        { choices: [{ delta: { content: "second" } }] }
      ])
    );
    const events = streamModelEvents({
      operation: "test",
      messages: [{ role: "user", content: "Hei" }],
      maxTokens: 100
    }) as AsyncGenerator;

    expect(await events.next()).toMatchObject({
      value: { kind: "delta", text: "first" }
    });
    await events.return(undefined);

    expect(mocks.abort).toHaveBeenCalledOnce();
    expect(mocks.telemetryEnd).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ name: "AbortError" })
    );
  });
});
