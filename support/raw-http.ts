import { config, required } from "./config.js";

/**
 * Plain-fetch transport for the REST API — no SDK.
 *
 * Every endpoint is ordinary HTTP: `X-API-Key` on every request, `Idempotency-Key` on writes
 * that create work, `X-Grant-Token` on delegated calls. Errors are JSON:API documents; branch on
 * `errors[0].code`.
 */
export type RawRequest = {
  method?: "GET" | "POST" | "DELETE";
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** Public endpoints (`/v1/tokens`, `/v1/network`) do not need an API key. */
  allowMissingKey?: boolean;
};

export class RawApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly document: unknown,
  ) {
    super(`HTTP ${status}: ${code}`);
    this.name = "RawApiError";
  }
}

function authHeaders(request: RawRequest): Headers {
  const headers = new Headers(request.headers);
  const { apiKey } = config();
  if (!request.allowMissingKey) {
    headers.set("x-api-key", required(apiKey, "NEAR_INTENTS_AGENT_API_KEY"));
  } else if (apiKey) {
    headers.set("x-api-key", apiKey);
  }
  return headers;
}

function parseBody(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function errorCode(value: unknown, status: number): string {
  if (value && typeof value === "object" && "errors" in value) {
    const errors = (value as { errors?: Array<{ code?: unknown }> }).errors;
    return String(errors?.[0]?.code ?? "request_failed");
  }
  return `http_${status}`;
}

/** Sends one `/v1` request and returns the parsed JSON body. */
export async function rawRequest<T>(request: RawRequest): Promise<T> {
  const { apiUrl } = config();
  const headers = authHeaders(request);
  if (request.body !== undefined) headers.set("content-type", "application/json");
  const response = await fetch(`${apiUrl}${request.path}`, {
    method: request.method ?? "GET",
    headers,
    body: request.body === undefined ? undefined : JSON.stringify(request.body),
    redirect: "error",
    signal: AbortSignal.timeout(request.timeoutMs ?? 65_000),
  });
  const value = parseBody(await response.text());
  if (!response.ok)
    throw new RawApiError(response.status, errorCode(value, response.status), value);
  return value as T;
}
