import {
  SETUP_TOKEN_SETTING_KEY,
  ok,
  type IAdminAccountCreator,
  type ISystemSettingsRepository,
  type Result,
} from "@rbrasier/domain";

export interface EnsureSetupTokenConfig {
  // Env override (`SETUP_TOKEN`) for automated installs. When set it is the
  // effective token and no DB row is written.
  envSetupToken: string | null;
  // Injected so the application layer stays free of Node crypto; the adapter
  // supplies a cryptographically random generator.
  generateToken: () => string;
}

// Ensures a one-time setup token exists on boot while no admin has been created
// (ADR-041 §0/§5). Returns null once an admin exists so the startup emitter logs
// no link. The token is persisted in a DB row (not .env) so it survives restarts
// and is identical across launch methods.
export class EnsureSetupToken {
  constructor(
    private readonly adminCreator: IAdminAccountCreator,
    private readonly systemSettings: ISystemSettingsRepository,
    private readonly config: EnsureSetupTokenConfig,
  ) {}

  async execute(): Promise<Result<string | null>> {
    const adminExists = await this.adminCreator.adminExists();
    if (adminExists.error) return adminExists;
    if (adminExists.data) return ok(null);

    if (this.config.envSetupToken) return ok(this.config.envSetupToken);

    const existing = await this.systemSettings.get(SETUP_TOKEN_SETTING_KEY);
    if (existing.error) return existing;
    if (existing.data) return ok(existing.data.value);

    const token = this.config.generateToken();
    const stored = await this.systemSettings.set(SETUP_TOKEN_SETTING_KEY, token);
    if (stored.error) return stored;
    return ok(token);
  }
}
