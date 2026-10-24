import type { Result } from "../result";

export interface OutboundJsonRequest {
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: unknown;
  timeoutMs: number;
  maxBytes: number;
  // Private-network hosts the admin has allowed despite the SSRF guard.
  allowedHosts: readonly string[];
}

export interface OutboundJsonResponse {
  status: number;
  json: unknown;
}

// Calls an external JSON API on an admin's behalf (ADR-063 §6). Refuses
// private-network addresses unless allowed, follows redirects only to hosts that
// pass the same check, caps time and size, and returns an error — never a
// thrown exception — for a non-2xx answer or a body that is not JSON. Error
// messages never contain request headers.
export interface IOutboundHttpClient {
  requestJson(request: OutboundJsonRequest): Promise<Result<OutboundJsonResponse>>;
}
