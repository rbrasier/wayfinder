import type { EventWatch, OutboundJsonRequest } from "@wayfinder/domain";

export type WatchConnection = Pick<EventWatch, "url" | "method" | "requestBody" | "authType" | "apiKeyPlacement">;

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const DEFAULT_API_KEY_PLACEMENT = { in: "header", name: "X-API-Key" } as const;

const withQueryParameter = (url: string, name: string, value: string): string => {
  const parsed = new URL(url);
  parsed.searchParams.set(name, value);
  return parsed.toString();
};

// The one request a watch makes, shared by the poller and the editor's Test
// button so a sample is fetched exactly as a poll would fetch it.
export const buildWatchRequest = (
  connection: WatchConnection,
  secret: string | null,
  allowedHosts: readonly string[],
): OutboundJsonRequest => {
  const base: OutboundJsonRequest = {
    url: connection.url,
    method: connection.method,
    headers: {},
    body: connection.method === "POST" ? connection.requestBody : undefined,
    timeoutMs: REQUEST_TIMEOUT_MS,
    maxBytes: MAX_RESPONSE_BYTES,
    allowedHosts,
  };
  if (connection.authType === "none") return base;
  const value = secret ?? "";
  if (connection.authType === "bearer") return { ...base, headers: { Authorization: `Bearer ${value}` } };

  const placement = connection.apiKeyPlacement ?? DEFAULT_API_KEY_PLACEMENT;
  if (placement.in === "query") return { ...base, url: withQueryParameter(connection.url, placement.name, value) };
  return { ...base, headers: { [placement.name]: value } };
};

const MAX_SAMPLE_NODES = 2_000;
const MAX_SAMPLE_BYTES = 256 * 1024;

interface Budget {
  nodes: number;
  bytes: number;
  truncated: boolean;
}

const spend = (budget: Budget, bytes: number): boolean => {
  if (budget.nodes >= MAX_SAMPLE_NODES || budget.bytes + bytes > MAX_SAMPLE_BYTES) {
    budget.truncated = true;
    return false;
  }
  budget.nodes += 1;
  budget.bytes += bytes;
  return true;
};

const copyWithin = (value: unknown, budget: Budget): { kept: boolean; value: unknown } => {
  const own = value !== null && typeof value === "object" ? 2 : JSON.stringify(value ?? null).length;
  if (!spend(budget, own)) return { kept: false, value: undefined };
  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    for (const entry of value) {
      const child = copyWithin(entry, budget);
      if (!child.kept) break;
      copy.push(child.value);
    }
    return { kept: true, value: copy };
  }
  if (value === null || typeof value !== "object") return { kept: true, value };
  const copy: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    budget.bytes += key.length + 3;
    const child = copyWithin(entry, budget);
    if (!child.kept) break;
    copy[key] = child.value;
  }
  return { kept: true, value: copy };
};

// Cuts a sample response down to what the editor's tree can show (ADR-063 §2):
// at most 2,000 nodes and 256 KB. Lists keep their first entries, which is
// enough to pick paths from.
export const truncateSample = (json: unknown): { sample: unknown; truncated: boolean } => {
  const budget: Budget = { nodes: 0, bytes: 0, truncated: false };
  const copied = copyWithin(json, budget);
  return { sample: copied.value ?? null, truncated: budget.truncated };
};
