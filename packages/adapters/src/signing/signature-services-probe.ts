import { createHash } from "node:crypto";
import type {
  ConnectivityResult,
  ISignatureServicesProbe,
  SignatureConfig,
  SignatureServiceTarget,
} from "@wayfinder/domain";
import { buildTimeStampRequest, readTimeStampResponseStatus } from "./rfc3161";

const DEFAULT_TIMEOUT_MS = 8_000;

const trimSlash = (url: string): string => url.replace(/\/+$/, "");

interface HttpOutcome {
  ok: boolean;
  message?: string;
  response?: Response;
}

// Live, side-effect-free probes for the signing services (ADR-067 §6): a health
// check for each sidecar, a throwaway timestamp over a fixed digest, and the
// CSC `info` call, which every CSC provider answers without credentials.
export class HttpSignatureServicesProbe implements ISignatureServicesProbe {
  constructor(
    private readonly fetchFn: typeof fetch = globalThis.fetch,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  async probe(target: SignatureServiceTarget, config: SignatureConfig): Promise<ConnectivityResult> {
    const start = Date.now();
    const outcome = await this.run(target, config);
    if (outcome === null) return { target, ok: false, skipped: true, message: "Not configured" };
    return {
      target,
      ok: outcome.ok,
      latencyMs: Date.now() - start,
      ...(outcome.message ? { message: outcome.message } : {}),
    };
  }

  private async run(target: SignatureServiceTarget, config: SignatureConfig): Promise<HttpOutcome | null> {
    switch (target) {
      case "pdf-converter":
        return config.gotenbergUrl ? this.get(`${trimSlash(config.gotenbergUrl)}/health`) : null;
      case "signature-engine":
        return config.dssUrl ? this.get(`${trimSlash(config.dssUrl)}/health`) : null;
      case "timestamp-authority":
        return config.tsaUrl ? this.probeTimestampAuthority(config.tsaUrl) : null;
      case "signing-provider":
        return config.csc ? this.probeCsc(config.csc.baseUrl) : null;
    }
  }

  private async probeTimestampAuthority(url: string): Promise<HttpOutcome> {
    const digest = createHash("sha256").update("wayfinder-signature-probe").digest();
    const outcome = await this.send(url, {
      method: "POST",
      headers: { "Content-Type": "application/timestamp-query" },
      body: new Uint8Array(buildTimeStampRequest(digest)),
    });
    if (!outcome.ok || !outcome.response) return outcome;

    const status = readTimeStampResponseStatus(Buffer.from(await outcome.response.arrayBuffer()));
    if (status === null) return { ok: false, message: "The reply is not an RFC 3161 timestamp response." };
    if (status > 1) return { ok: false, message: `The timestamp authority refused the request (status ${status}).` };
    return { ok: true };
  }

  private async probeCsc(baseUrl: string): Promise<HttpOutcome> {
    const outcome = await this.send(`${trimSlash(baseUrl)}/info`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (!outcome.ok || !outcome.response) return outcome;
    const body = (await outcome.response.json().catch(() => null)) as { name?: unknown } | null;
    if (!body) return { ok: false, message: "The signing provider's info reply is not JSON." };
    return { ok: true, ...(typeof body.name === "string" ? { message: body.name } : {}) };
  }

  private get(url: string): Promise<HttpOutcome> {
    return this.send(url, { method: "GET" });
  }

  private async send(url: string, init: RequestInit): Promise<HttpOutcome> {
    try {
      const response = await this.fetchFn(url, { ...init, signal: AbortSignal.timeout(this.timeoutMs) });
      if (!response.ok) return { ok: false, message: `HTTP ${response.status}` };
      return { ok: true, response };
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : "unknown error";
      return { ok: false, message: `Unreachable: ${reason}` };
    }
  }
}
