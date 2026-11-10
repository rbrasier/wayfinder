import { createHash } from "node:crypto";
import {
  resolveTsaUrl,
  type ConnectivityResult,
  type EngineChoice,
  type IPdfConverter,
  type Result,
  type ISignatureServicesProbe,
  type SignatureConfig,
  type SignatureServiceTarget,
} from "@wayfinder/domain";
import { buildMinimalDocx } from "../documents/minimal-docx";
import { buildTimeStampRequest, readTimeStampResponseStatus } from "./rfc3161";

export interface BuiltInProbeTargets {
  pdfConverter: IPdfConverter;
  signatureEngine: { ensureRunning(): Promise<Result<string>> };
}

const DEFAULT_TIMEOUT_MS = 8_000;

const trimSlash = (url: string): string => url.replace(/\/+$/, "");

interface HttpOutcome {
  ok: boolean;
  message?: string;
  response?: Response;
}

const NO_BUILT_IN: HttpOutcome = { ok: false, message: "There is no built-in engine here." };

// Live, side-effect-free probes for the signing services (ADR-067 §6): a health
// check for each external engine, a throwaway timestamp over a fixed digest,
// and the CSC `info` call, which every CSC provider answers without
// credentials. A built-in converter is checked by converting a one-line
// document, and a built-in signature engine by starting it (ADR-069 §2).
export class HttpSignatureServicesProbe implements ISignatureServicesProbe {
  constructor(
    private readonly fetchFn: typeof fetch = globalThis.fetch,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
    private readonly builtIn: BuiltInProbeTargets | null = null,
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
        return this.probeEngine(config.pdfConverter, (builtIn) => this.probeBuiltInConverter(builtIn));
      case "signature-engine":
        return this.probeEngine(config.signatureEngine, (builtIn) => this.probeBuiltInSignatureEngine(builtIn));
      case "timestamp-authority":
        return this.probeTimestampAuthority(resolveTsaUrl(config));
      case "signing-provider":
        return config.csc ? this.probeCsc(config.csc.baseUrl) : null;
    }
  }

  private probeEngine(
    choice: EngineChoice,
    probeBuiltIn: (builtIn: BuiltInProbeTargets) => Promise<HttpOutcome>,
  ): Promise<HttpOutcome> {
    if (choice.source === "external") return this.get(`${trimSlash(choice.url)}/health`);
    return this.builtIn ? probeBuiltIn(this.builtIn) : Promise.resolve(NO_BUILT_IN);
  }

  private async probeBuiltInConverter(builtIn: BuiltInProbeTargets): Promise<HttpOutcome> {
    const converted = await builtIn.pdfConverter.convertDocxToPdfA(buildMinimalDocx(["Wayfinder converter check"]));
    return converted.error ? { ok: false, message: converted.error.message } : { ok: true };
  }

  private async probeBuiltInSignatureEngine(builtIn: BuiltInProbeTargets): Promise<HttpOutcome> {
    const started = await builtIn.signatureEngine.ensureRunning();
    if (started.error) return { ok: false, message: started.error.message };
    return this.get(`${started.data}/health`);
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
