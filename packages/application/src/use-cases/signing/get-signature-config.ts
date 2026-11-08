import {
  ok,
  parseSignatureConfig,
  SIGNATURE_CONFIG_SETTING_KEY,
  type ISystemSettingsRepository,
  type Result,
  type SignatureMethod,
} from "@wayfinder/domain";

// What the admin card reads. The CSC client secret never leaves the server;
// the card only learns whether one is set.
export interface SignatureConfigView {
  method: SignatureMethod;
  gotenbergUrl: string | null;
  dssUrl: string | null;
  tsaUrl: string | null;
  csc: { baseUrl: string; clientId: string; hasClientSecret: boolean } | null;
}

export class GetSignatureConfig {
  constructor(private readonly systemSettings: ISystemSettingsRepository) {}

  async execute(): Promise<Result<SignatureConfigView>> {
    const stored = await this.systemSettings.get(SIGNATURE_CONFIG_SETTING_KEY);
    if (stored.error) return stored;
    const config = parseSignatureConfig(stored.data?.value ?? "");
    return ok({
      method: config.method,
      gotenbergUrl: config.gotenbergUrl,
      dssUrl: config.dssUrl,
      tsaUrl: config.tsaUrl,
      csc: config.csc
        ? { baseUrl: config.csc.baseUrl, clientId: config.csc.clientId, hasClientSecret: true }
        : null,
    });
  }
}
