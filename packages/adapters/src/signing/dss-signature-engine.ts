import {
  domainError,
  err,
  ok,
  type EngineChoice,
  type EngineSignatureReport,
  type ISignatureEngine,
  type PreparedSignature,
  type Result,
  type SigningParameters,
} from "@wayfinder/domain";

const DEFAULT_TIMEOUT_MS = 120_000;

const trimSlash = (url: string): string => url.replace(/\/+$/, "");

export interface BuiltInEngineHandle {
  ensureRunning(): Promise<Result<string>>;
}

// The DSS engine's JSON API (deploy/dss, ADR-067 §4), whether it runs as a
// sidecar or inside the Wayfinder container (ADR-069 §1) — one protocol, one
// code path. Long timeout: signing fetches a timestamp and revocation data, and
// validation walks every chain.
export class DssSignatureEngine implements ISignatureEngine {
  constructor(
    private readonly fetchFn: typeof fetch = globalThis.fetch,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
    private readonly builtIn: BuiltInEngineHandle | null = null,
  ) {}

  prepare(parameters: SigningParameters): Promise<Result<PreparedSignature>> {
    return this.post<PreparedSignature>(parameters.engine, "prepare", this.signingBody(parameters));
  }

  async sign(parameters: SigningParameters & { signatureValue: string; tsaUrl: string }): Promise<Result<Buffer>> {
    const response = await this.post<{ pdf: string }>(parameters.engine, "sign", {
      ...this.signingBody(parameters),
      signatureValue: parameters.signatureValue,
      // The mock and every CSC provider Wayfinder supports sign with RSA.
      signatureAlgorithm: "RSA_SHA256",
      tsaUrl: parameters.tsaUrl,
    });
    if (response.error) return response;
    return ok(Buffer.from(response.data.pdf, "base64"));
  }

  async validate(engine: EngineChoice, pdf: Buffer): Promise<Result<EngineSignatureReport[]>> {
    const response = await this.post<{ signatures: Array<EngineSignatureReport & { bestSignatureTime?: string }> }>(
      engine,
      "validate",
      { pdf: pdf.toString("base64") },
    );
    if (response.error) return response;
    return ok(
      response.data.signatures.map((entry) => ({
        id: entry.id,
        indication: entry.indication ?? null,
        subIndication: entry.subIndication ?? null,
        signedBy: entry.signedBy ?? null,
        signingTime: entry.signingTime ?? null,
        level: entry.level ?? null,
        timestampTimes: entry.timestampTimes ?? [],
        certificate: entry.certificate ?? null,
      })),
    );
  }

  private signingBody(parameters: SigningParameters): Record<string, unknown> {
    return {
      pdf: parameters.pdf.toString("base64"),
      certificateChain: parameters.certificateChain,
      signingTime: parameters.signingTime,
      reason: parameters.reason,
      appearance: parameters.appearance
        ? {
            ...parameters.appearance,
            imagePng: parameters.appearance.imagePng ? parameters.appearance.imagePng.toString("base64") : null,
          }
        : null,
    };
  }

  private async baseUrl(engine: EngineChoice): Promise<Result<string>> {
    if (engine.source === "external") return ok(engine.url);
    if (!this.builtIn) return err(domainError("INFRA_FAILURE", "There is no built-in signature engine here."));
    return this.builtIn.ensureRunning();
  }

  private async post<T>(engine: EngineChoice, operation: string, body: unknown): Promise<Result<T>> {
    const baseUrl = await this.baseUrl(engine);
    if (baseUrl.error) return baseUrl;
    let response: Response;
    try {
      response = await this.fetchFn(`${trimSlash(baseUrl.data)}/${operation}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "The signature engine is unreachable.", cause));
    }
    const parsed = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
    if (!response.ok) {
      return err(domainError("INFRA_FAILURE", `The signature engine refused: ${parsed?.error ?? `HTTP ${response.status}`}`));
    }
    if (!parsed) return err(domainError("INFRA_FAILURE", "The signature engine's reply is not JSON."));
    return ok(parsed);
  }
}
