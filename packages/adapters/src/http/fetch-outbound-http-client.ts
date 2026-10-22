import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import {
  domainError,
  err,
  ok,
  type IOutboundHttpClient,
  type OutboundJsonRequest,
  type OutboundJsonResponse,
  type Result,
} from "@rbrasier/domain";

const MAX_REDIRECTS = 3;

type ResolveHost = (hostname: string) => Promise<string[]>;
type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const defaultResolve: ResolveHost = async (hostname) =>
  (await lookup(hostname, { all: true })).map((entry) => entry.address);

const ipv4ToNumber = (address: string): number =>
  address.split(".").reduce((total, octet) => total * 256 + Number(octet), 0);

// [first address, prefix length] of every IPv4 range an Event Watch may not
// reach unless allowed: "this network", private, CGNAT, loopback, link-local
// (the cloud metadata endpoint lives there), and the reserved blocks.
const BLOCKED_IPV4: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 3],
];

const isBlockedIpv4 = (address: string): boolean => {
  const value = ipv4ToNumber(address);
  return BLOCKED_IPV4.some(([base, prefix]) => {
    const size = 2 ** (32 - prefix);
    const start = ipv4ToNumber(base);
    return value >= start && value < start + size;
  });
};

const mappedIpv4 = (address: string): string | null => {
  const match = /^::ffff:(?:0{1,4}:)?(.+)$/i.exec(address);
  if (!match) return null;
  const tail = match[1]!;
  if (isIP(tail) === 4) return tail;
  const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(tail);
  if (!hex) return null;
  const high = parseInt(hex[1]!, 16);
  const low = parseInt(hex[2]!, 16);
  return [high >> 8, high & 255, low >> 8, low & 255].join(".");
};

export const isBlockedAddress = (address: string): boolean => {
  const version = isIP(address);
  if (version === 4) return isBlockedIpv4(address);
  if (version !== 6) return true;
  const lower = address.toLowerCase();
  const embedded = mappedIpv4(lower);
  if (embedded) return isBlockedIpv4(embedded);
  if (lower === "::" || lower === "::1") return true;
  // fc00::/7 unique local, fe80::/10 link-local.
  return /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower);
};

const formatBytes = (bytes: number): string =>
  bytes >= 1024 * 1024 ? `${Math.round(bytes / (1024 * 1024))} MB` : `${Math.round(bytes / 1024)} KB`;

// Reads at most `maxBytes`, so an endless or oversized body cannot exhaust memory.
const readCapped = async (response: Response, maxBytes: number): Promise<Result<string>> => {
  const reader = response.body?.getReader();
  if (!reader) return ok("");
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return err(domainError("VALIDATION_FAILED", `The response is larger than ${formatBytes(maxBytes)}.`));
    }
    chunks.push(value);
  }
  return ok(Buffer.concat(chunks).toString("utf8"));
};

// ADR-063 §6. The address check runs before each hop, including every redirect;
// redirects are followed by hand so one can never reach a blocked host. The
// check is on resolution, so a host that re-resolves between the check and the
// connection (DNS rebinding) is a known residual risk.
export class FetchOutboundHttpClient implements IOutboundHttpClient {
  constructor(
    private readonly resolveHost: ResolveHost = defaultResolve,
    private readonly fetchUrl: FetchLike = (url, init) => fetch(url, init),
  ) {}

  async requestJson(request: OutboundJsonRequest): Promise<Result<OutboundJsonResponse>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);
    try {
      return await this.follow(request, controller.signal);
    } catch (cause) {
      const message = controller.signal.aborted
        ? `The API did not answer within ${Math.round(request.timeoutMs / 1000)} seconds.`
        : "The API could not be reached.";
      return err(domainError("INFRA_FAILURE", message, cause instanceof Error ? cause.message : undefined));
    } finally {
      clearTimeout(timer);
    }
  }

  private async follow(request: OutboundJsonRequest, signal: AbortSignal): Promise<Result<OutboundJsonResponse>> {
    let url = request.url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const allowed = await this.checkUrl(url, request.allowedHosts);
      if (allowed.error) return allowed;

      const response = await this.fetchUrl(url, {
        method: request.method,
        headers: request.method === "POST" ? { "content-type": "application/json", ...request.headers } : request.headers,
        body: request.method === "POST" ? JSON.stringify(request.body ?? {}) : undefined,
        redirect: "manual",
        signal,
      });

      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location) {
        url = new URL(location, url).toString();
        continue;
      }
      if (response.status < 200 || response.status >= 300) {
        return err(domainError("INFRA_FAILURE", `The API answered HTTP ${response.status}.`));
      }

      const text = await readCapped(response, request.maxBytes);
      if (text.error) return text;
      try {
        return ok({ status: response.status, json: JSON.parse(text.data) as unknown });
      } catch {
        return err(domainError("VALIDATION_FAILED", "The response is not JSON."));
      }
    }
    return err(domainError("INFRA_FAILURE", `The API redirected more than ${MAX_REDIRECTS} times.`));
  }

  private async checkUrl(raw: string, allowedHosts: readonly string[]): Promise<Result<true>> {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return err(domainError("VALIDATION_FAILED", "The address is not a valid URL."));
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return err(domainError("VALIDATION_FAILED", "Only http:// and https:// addresses can be called."));
    }
    const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (allowedHosts.some((host) => host.toLowerCase() === hostname)) return ok(true);

    const addresses = isIP(hostname) ? [hostname] : await this.resolveHost(hostname);
    if (addresses.length === 0 || addresses.some(isBlockedAddress)) {
      return err(
        domainError("FORBIDDEN", `${hostname} resolves to a private network address, which is not allowed.`),
      );
    }
    return ok(true);
  }
}
