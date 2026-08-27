import { AsyncLocalStorage } from "node:async_hooks";
import { context, metrics, SpanStatusCode, trace } from "@opentelemetry/api";

export type TelemetryValue = string | number | boolean;
export type TelemetryAttributes = Record<string, TelemetryValue | undefined>;

type RequestCorrelation = {
  requestId: string;
};

const requestCorrelation = new AsyncLocalStorage<RequestCorrelation>();
const meter = metrics.getMeter("norautron.web", "0.1.0");
const tracer = trace.getTracer("norautron.web", "0.1.0");
const requestCount = meter.createCounter("norautron.web.request.count");
const requestDuration = meter.createHistogram(
  "norautron.web.request.duration",
  { unit: "ms" }
);
const sqlDuration = meter.createHistogram("norautron.sql.duration", {
  unit: "ms"
});
const modelCallCount = meter.createCounter("norautron.model.call.count");
const modelDuration = meter.createHistogram("norautron.model.duration", {
  unit: "ms"
});
const modelTokens = meter.createCounter("norautron.model.tokens");
const pipelineStageDuration = meter.createHistogram(
  "norautron.pipeline.stage.duration",
  { unit: "ms" }
);
const datasetReady = meter.createHistogram("norautron.dataset.ready");
let lastDatasetState: string | undefined;

const privateField =
  /(^|_)(address|chat|content|ip|message|prompt|question|sql|text)(_|$)/i;

export function safeTelemetryAttributes(attributes: TelemetryAttributes) {
  return Object.fromEntries(
    Object.entries(attributes)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [
        key,
        privateField.test(key) ? "[redacted]" : value
      ])
  ) as Record<string, TelemetryValue>;
}

export function errorType(error: unknown) {
  return error instanceof Error && error.name ? error.name : "UnknownError";
}

function activeCorrelation() {
  const spanContext = trace.getSpan(context.active())?.spanContext();
  return {
    ...(spanContext?.traceId ? { trace_id: spanContext.traceId } : {}),
    ...(spanContext?.spanId ? { span_id: spanContext.spanId } : {}),
    ...(requestCorrelation.getStore()?.requestId
      ? { request_id: requestCorrelation.getStore()?.requestId }
      : {})
  };
}

export function logEvent(
  level: "info" | "warn" | "error",
  event: string,
  attributes: TelemetryAttributes = {}
) {
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    severity: level,
    event,
    service: "norautron-web",
    ...activeCorrelation(),
    ...safeTelemetryAttributes(attributes)
  });
  console[level](entry);
}

export function withRequestCorrelation<T>(
  requestId: string,
  callback: () => T
) {
  return requestCorrelation.run({ requestId }, callback);
}

export function currentRequestId() {
  return requestCorrelation.getStore()?.requestId;
}

export function recordRequest(
  route: string,
  method: string,
  status: number,
  durationMs: number
) {
  const attributes = {
    "http.request.method": method,
    "http.route": route,
    "http.response.status_code": status
  };
  requestCount.add(1, attributes);
  requestDuration.record(durationMs, attributes);
}

export async function observeSql<T>(
  operation: string,
  callback: () => Promise<T>
): Promise<T> {
  return tracer.startActiveSpan(
    `sql.${operation}`,
    {
      attributes: {
        "db.system.name": "mssql",
        "db.operation.name": operation
      }
    },
    async (span) => {
      const started = performance.now();
      let outcome = "success";
      try {
        const result = await callback();
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        outcome = "failure";
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: errorType(error)
        });
        logEvent("error", "sql_operation_failed", {
          operation,
          error_type: errorType(error)
        });
        throw error;
      } finally {
        const durationMs = performance.now() - started;
        sqlDuration.record(durationMs, { operation, outcome });
        logEvent("info", "sql_operation_completed", {
          operation,
          outcome,
          duration_ms: Math.round(durationMs)
        });
        span.end();
      }
    }
  );
}

export function startModelOperation(
  operation: string,
  deployment: string,
  requestId?: string
) {
  const span = tracer.startSpan(`model.${operation}`, {
    attributes: {
      "gen_ai.operation.name": "chat",
      "gen_ai.request.model": deployment,
      "norautron.operation": operation
    }
  });
  const started = performance.now();
  let ended = false;

  return {
    end(
      ok: boolean,
      usage?: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
      },
      error?: unknown
    ) {
      if (ended) return;
      ended = true;
      const outcome = ok ? "success" : "failure";
      const durationMs = performance.now() - started;
      const attributes = { operation, deployment, outcome };
      modelCallCount.add(1, attributes);
      modelDuration.record(durationMs, attributes);
      if (usage) {
        modelTokens.add(usage.inputTokens, {
          operation,
          deployment,
          token_type: "input"
        });
        modelTokens.add(usage.outputTokens, {
          operation,
          deployment,
          token_type: "output"
        });
      }
      span.setStatus({
        code: ok ? SpanStatusCode.OK : SpanStatusCode.ERROR,
        ...(!ok ? { message: errorType(error) } : {})
      });
      if (usage) {
        span.setAttributes({
          "gen_ai.usage.input_tokens": usage.inputTokens,
          "gen_ai.usage.output_tokens": usage.outputTokens
        });
      }
      logEvent(ok ? "info" : "error", "model_operation_completed", {
        request_id: requestId,
        operation,
        deployment,
        outcome,
        duration_ms: Math.round(durationMs),
        input_tokens: usage?.inputTokens,
        output_tokens: usage?.outputTokens,
        total_tokens: usage?.totalTokens,
        ...(!ok ? { error_type: errorType(error) } : {})
      });
      span.end();
    }
  };
}

export function recordPipelineStage(
  operation: string,
  stage: string,
  outcome: "success" | "failure",
  durationMs: number,
  requestId?: string
) {
  pipelineStageDuration.record(durationMs, { operation, stage, outcome });
  logEvent(outcome === "success" ? "info" : "error", "pipeline_stage_completed", {
    request_id: requestId,
    operation,
    stage,
    outcome,
    duration_ms: Math.round(durationMs)
  });
}

export function recordDatasetStatus(
  ready: boolean,
  state: string,
  totalRows: number
) {
  datasetReady.record(ready ? 1 : 0, { state });
  if (lastDatasetState !== state) {
    logEvent("info", "dataset_status_changed", {
      ready,
      state,
      total_rows: totalRows
    });
    lastDatasetState = state;
  }
}
