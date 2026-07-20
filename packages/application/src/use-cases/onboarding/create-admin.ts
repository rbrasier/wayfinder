import {
  SETUP_TOKEN_SETTING_KEY,
  domainError,
  err,
  ok,
  type IAdminAccountCreator,
  type IAuditLogger,
  type ISystemSettingsRepository,
  type Result,
} from "@rbrasier/domain";

// Public read backing `bootstrap.adminExists` and the no-admin redirect.
export class AdminExists {
  constructor(private readonly adminCreator: IAdminAccountCreator) {}

  execute(): Promise<Result<boolean>> {
    return this.adminCreator.adminExists();
  }
}

export interface CreateFirstAdminInput {
  email: string;
  password: string;
  name?: string;
  token: string;
}

export interface CreateFirstAdminConfig {
  // Env override (`SETUP_TOKEN`). When set it is the expected token and the DB
  // setup_token row is not consulted.
  envSetupToken: string | null;
  // `ADMIN_SEED_EMAIL` binding. When set, only this address may bootstrap.
  seedEmail: string | null;
}

const normaliseEmail = (email: string): string => email.trim().toLowerCase();

// Length-independent, constant-time-ish string compare so token validation does
// not leak length or prefix via timing.
const timingSafeEquals = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return mismatch === 0;
};

// Bootstraps the first administrator (ADR-041 §0). Defence in layers around the
// unauthenticated call: seed-email binding, one-time setup token, an explicit
// fast-fail when an admin exists, and the adapter's transactional singleton
// guard as the race backstop. Voids the token and audits on success.
export class CreateFirstAdmin {
  constructor(
    private readonly adminCreator: IAdminAccountCreator,
    private readonly systemSettings: ISystemSettingsRepository,
    private readonly auditLogger: IAuditLogger,
    private readonly config: CreateFirstAdminConfig,
  ) {}

  async execute(input: CreateFirstAdminInput): Promise<Result<{ userId: string }>> {
    if (
      this.config.seedEmail &&
      normaliseEmail(input.email) !== normaliseEmail(this.config.seedEmail)
    ) {
      return err(
        domainError("FORBIDDEN", "This installation is bound to a specific administrator email."),
      );
    }

    const expectedToken = await this.resolveExpectedToken();
    if (expectedToken.error) return expectedToken;
    if (!expectedToken.data) {
      return err(domainError("FORBIDDEN", "Setup is not available."));
    }
    if (!timingSafeEquals(input.token, expectedToken.data)) {
      return err(domainError("FORBIDDEN", "Invalid setup token."));
    }

    const adminExists = await this.adminCreator.adminExists();
    if (adminExists.error) return adminExists;
    if (adminExists.data) {
      return err(domainError("CONFLICT", "An administrator already exists."));
    }

    const created = await this.adminCreator.createFirstAdmin({
      email: input.email,
      password: input.password,
      name: input.name?.trim() || input.email,
    });
    if (created.error) return created;

    // Void the one-time token so the bootstrap window closes permanently. A
    // delete failure must not undo a created admin, so it is best-effort.
    await this.systemSettings.delete(SETUP_TOKEN_SETTING_KEY);

    await this.auditLogger.log({
      actorId: created.data.userId,
      action: "admin.bootstrap_created",
      resourceType: "user",
      resourceId: created.data.userId,
      metadata: { email: normaliseEmail(input.email) },
    });

    return ok({ userId: created.data.userId });
  }

  private async resolveExpectedToken(): Promise<Result<string | null>> {
    if (this.config.envSetupToken) return ok(this.config.envSetupToken);
    const row = await this.systemSettings.get(SETUP_TOKEN_SETTING_KEY);
    if (row.error) return row;
    return ok(row.data?.value ?? null);
  }
}
