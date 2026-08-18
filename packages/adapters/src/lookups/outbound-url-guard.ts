import { domainError, err, ok } from "@rbrasier/domain";
import type { Result } from "@rbrasier/domain";
import { lookup } from "node:dns/promises";

// Resolves a hostname to the addresses it would actually be dialled on.
export type HostResolver = (hostname: string) => Promise<string[]>;

export interface OutboundUrlGuardOptions {
  // Development deployments point the api kind at a local stub. Off by default:
  // a production admin must never be able to aim a source at the app's own host.
  allowLocalhost?: boolean;
  resolveHost?: HostResolver;
}

const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

const isBlockedIpv4 = (address: string): boolean => {
  const match = address.match(IPV4_PATTERN);
  if (!match) return false;

  const octets = match.slice(1, 5).map(Number);
  const [first, second] = octets as [number, number, number, number];

  if (octets.some((octet) => octet > 255)) return true;
  if (first === 0 || first === 127) return true;
  if (first === 10) return true;
  if (first === 169 && second === 254) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 192 && second === 168) return true;
  return false;
};

// Rejects any address an external lookup source has no business being on:
// loopback, the unspecified address, link-local (which covers the cloud metadata
// endpoint), and the RFC1918 private ranges, plus their IPv6 equivalents.
export const isBlockedAddress = (address: string): boolean => {
  const normalised = address.trim().toLowerCase();
  if (normalised.length === 0) return true;

  // ::ffff:127.0.0.1 dials the IPv4 address it embeds.
  const mapped = normalised.match(/^::ffff:(.+)$/);
  if (mapped) return isBlockedAddress(mapped[1] ?? "");

  if (isBlockedIpv4(normalised)) return true;
  if (!normalised.includes(":")) return false;

  if (normalised === "::1" || normalised === "::") return true;
  if (normalised.startsWith("fe80:")) return true;
  // fc00::/7 — unique local addresses.
  if (/^f[cd][0-9a-f]{2}:/.test(normalised)) return true;
  return false;
};

const isLocalhostName = (hostname: string): boolean =>
  hostname === "localhost" || hostname.endsWith(".localhost");

const rejected = (message: string) => err(domainError("VALIDATION_FAILED", message));

// Validates an admin-supplied URL before every `api` call. An admin-controlled
// outbound URL is an SSRF vector, so both the literal host and the addresses it
// resolves to are checked — a public name pointing at 10.0.0.1 is the whole
// attack (ADR-050 §2a).
export const guardOutboundUrl = async (
  rawUrl: string,
  options: OutboundUrlGuardOptions = {},
): Promise<Result<URL>> => {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return rejected(`"${rawUrl}" is not a valid URL.`);
  }

  const allowLocalhost = options.allowLocalhost === true;
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const isLocalhost = isLocalhostName(hostname) || isBlockedAddress(hostname);

  if (url.protocol !== "https:") {
    if (!(url.protocol === "http:" && allowLocalhost && isLocalhost)) {
      return rejected("A lookup source URL must use HTTPS.");
    }
  }

  if (allowLocalhost && isLocalhostName(hostname)) return ok(url);

  if (IPV4_PATTERN.test(hostname) || hostname.includes(":")) {
    if (isBlockedAddress(hostname)) {
      if (!(allowLocalhost && (hostname.startsWith("127.") || hostname === "::1"))) {
        return rejected(
          `The lookup source URL points at an internal address (${hostname}). Use a publicly reachable endpoint.`,
        );
      }
    }
    return ok(url);
  }

  const resolveHost =
    options.resolveHost ??
    (async (name: string) => (await lookup(name, { all: true })).map((entry) => entry.address));

  let addresses: string[];
  try {
    addresses = await resolveHost(hostname);
  } catch {
    return rejected(`The lookup source host "${hostname}" could not be resolved.`);
  }

  if (addresses.length === 0) {
    return rejected(`The lookup source host "${hostname}" could not be resolved.`);
  }

  const blocked = addresses.find((address) => isBlockedAddress(address));
  if (blocked && !(allowLocalhost && isLocalhostName(hostname))) {
    return rejected(
      `The lookup source host "${hostname}" resolves to an internal address (${blocked}). Use a publicly reachable endpoint.`,
    );
  }

  return ok(url);
};
