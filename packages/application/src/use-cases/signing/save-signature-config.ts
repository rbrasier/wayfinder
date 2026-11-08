import {
  domainError,
  err,
  ok,
  parseSignatureConfig,
  SIGNATURE_CONFIG_SETTING_KEY,
  validateSignatureConfig,
  type IAuditLogger,
  type ISystemSettingsRepository,
  type Result,
  type SignatureConfig,
  type SignatureMethod,
} from "@wayfinder/domain";
import type { TestSignatureConfig } from "./test-signature-config";

export interface SignatureConfigInput {
  method: SignatureMethod;
  gotenbergUrl: string | null;
  dssUrl: string | null;
  tsaUrl: string | null;
  // A blank secret keeps the stored one, so an admin editing a URL does not
  // have to re-enter a credential they cannot see.
  csc: { baseUrl: string; clientId: string; clientSecret: string } | null;
}

// Saves the install-wide signature config. Refuses unless every probe the
// config needs passes on these exact values — a method that is enabled and
// broken is how a signing step ends up blocked for everyone (ADR-067 §6).
export class SaveSignatureConfig {
  constructor(
    private readonly systemSettings: ISystemSettingsRepository,
    private readonly tester: TestSignatureConfig,
    private readonly auditLogger: IAuditLogger,
  ) {}

  async execute(input: SignatureConfigInput, actorId: string): Promise<Result<SignatureConfig>> {
    const current = await this.systemSettings.get(SIGNATURE_CONFIG_SETTING_KEY);
    if (current.error) return current;
    const existing = parseSignatureConfig(current.data?.value ?? "");

    const config = parseSignatureConfig(JSON.stringify(withRetainedSecret(input, existing)));
    const problems = validateSignatureConfig(config);
    if (problems.length > 0) return err(domainError("VALIDATION_FAILED", problems.join(" ")));

    const results = await this.tester.execute(config);
    const failures = results.filter((result) => !result.ok);
    if (failures.length > 0) {
      const reasons = failures.map((result) => `${result.target}: ${result.message ?? "failed"}`);
      return err(
        domainError("VALIDATION_FAILED", `The signature settings did not pass their Test — ${reasons.join("; ")}`),
      );
    }

    const saved = await this.systemSettings.set(SIGNATURE_CONFIG_SETTING_KEY, JSON.stringify(config));
    if (saved.error) return saved;

    await this.auditLogger.log({
      actorId,
      action: "settings.signature.updated",
      resourceType: "system_setting",
      resourceId: SIGNATURE_CONFIG_SETTING_KEY,
      metadata: {
        method: config.method,
        gotenbergUrl: config.gotenbergUrl,
        dssUrl: config.dssUrl,
        tsaUrl: config.tsaUrl,
        cscBaseUrl: config.csc?.baseUrl ?? null,
      },
    });
    return ok(config);
  }
}

const withRetainedSecret = (input: SignatureConfigInput, existing: SignatureConfig): SignatureConfigInput => {
  if (!input.csc || input.csc.clientSecret.trim().length > 0) return input;
  return { ...input, csc: { ...input.csc, clientSecret: existing.csc?.clientSecret ?? "" } };
};
