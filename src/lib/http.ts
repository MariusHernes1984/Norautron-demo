import { isIP } from "node:net";
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import {
  errorType,
  logEvent,
  recordRequest,
  withRequestCorrelation
} from "./telemetry";

export type RequestContext = {
  requestId: string;
};

const requestIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function containsRawAddress(value: string) {
  const ipv4Candidates = value.match(/(?:\d{1,3}\.){3}\d{1,3}/g) ?? [];
  const ipv6Candidates = value.match(/[a-f0-9:]{2,}/gi) ?? [];
  return [...ipv4Candidates, ...ipv6Candidates].some(
    (candidate) => isIP(candidate) !== 0
  );
}

export function requestId(request: NextRequest) {
  const candidate = request.headers.get("x-request-id")?.trim();
  return candidate &&
    requestIdPattern.test(candidate) &&
    !containsRawAddress(candidate)
    ? candidate
    : randomUUID();
}

export async function withRequestTelemetry(
  request: NextRequest,
  route: string,
  handler: (context: RequestContext) => Promise<Response> | Response
) {
  const id = requestId(request);
  const started = performance.now();
  return withRequestCorrelation(id, async () => {
    logEvent("info", "http_request_started", {
      method: request.method,
      route
    });
    try {
      const response = await handler({ requestId: id });
      response.headers.set("X-Request-Id", id);
      recordRequest(route, request.method, response.status, performance.now() - started);
      logEvent("info", "http_request_completed", {
        method: request.method,
        route,
        status_code: response.status,
        duration_ms: Math.round(performance.now() - started)
      });
      return response;
    } catch (error) {
      recordRequest(route, request.method, 500, performance.now() - started);
      logEvent("error", "http_request_failed", {
        method: request.method,
        route,
        status_code: 500,
        duration_ms: Math.round(performance.now() - started),
        error_type: errorType(error)
      });
      throw error;
    }
  });
}

export function clientAddress(request: NextRequest) {
  const forwarded =
    request.headers.get("x-forwarded-for") ||
    request.headers.get("x-real-ip") ||
    "";
  let candidate = forwarded.split(",")[0]?.trim() || "";
  const bracketed = candidate.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketed) candidate = bracketed[1];
  if (!isIP(candidate) && /^[^:]+:\d+$/.test(candidate)) {
    candidate = candidate.slice(0, candidate.lastIndexOf(":"));
  }
  return isIP(candidate) ? candidate.toLowerCase() : "unknown";
}

export function isSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (!origin || origin === "null") return false;
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return false;
  }
  try {
    return new URL(origin).origin === request.nextUrl.origin;
  } catch {
    return false;
  }
}

export function sameOriginError(request: NextRequest) {
  return isSameOrigin(request)
    ? null
    : jsonError("Forespørselen må komme fra denne applikasjonen.", 403);
}

export type JsonBodyResult =
  | { ok: true; value: unknown }
  | { ok: false; response: Response };

export async function readBoundedJson(
  request: NextRequest,
  maxBytes: number
): Promise<JsonBodyResult> {
  const contentType = request.headers.get("content-type")?.toLowerCase() || "";
  if (!/^application\/json(?:\s*;|$)/.test(contentType)) {
    return {
      ok: false,
      response: jsonError("Forespørselen må være JSON.", 415)
    };
  }

  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength &&
    (/^\d+$/.test(declaredLength) === false ||
      Number(declaredLength) > maxBytes)
  ) {
    return {
      ok: false,
      response: jsonError("Forespørselen er for stor.", 413)
    };
  }

  if (!request.body) {
    return {
      ok: false,
      response: jsonError("Forespørselen inneholder ikke gyldig JSON.", 400)
    };
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        return {
          ok: false,
          response: jsonError("Forespørselen er for stor.", 413)
        };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return {
      ok: false,
      response: jsonError("Forespørselen inneholder ikke gyldig JSON.", 400)
    };
  } finally {
    reader.releaseLock();
  }
}

export function logSafeError(context: string, error: unknown) {
  const candidate =
    error && typeof error === "object"
      ? (error as { name?: unknown; code?: unknown })
      : undefined;
  const name =
    typeof candidate?.name === "string"
      ? candidate.name.slice(0, 80)
      : "UnknownError";
  const code =
    typeof candidate?.code === "string" || typeof candidate?.code === "number"
      ? String(candidate.code).slice(0, 80)
      : undefined;
  logEvent("error", "safe_error", {
    operation: context,
    error_type: name,
    error_code: code
  });
}

export function jsonError(
  message: string,
  status: number,
  headers?: HeadersInit
) {
  const responseHeaders = new Headers(headers);
  if (!responseHeaders.has("Cache-Control")) {
    responseHeaders.set("Cache-Control", "no-store");
  }
  return Response.json({ error: message }, { status, headers: responseHeaders });
}
