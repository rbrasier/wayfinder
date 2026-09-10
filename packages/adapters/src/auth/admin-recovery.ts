import { and, eq } from "drizzle-orm";
import {
  AUTH_CONFIG_SETTING_KEY,
  createDefaultAuthConfig,
  domainError,
  err,
  normaliseEmail,
  ok,
  type AdminRecoveryOutcome,
  type AuthConfig,
  type IAdminRecovery,
  type IAuditLogger,
  type ISystemSettingsRepository,
  type IUserRepository,
  type RecoverAdminAccessInput,
  type Result,
} from "@wayfinder/domain";
import type { Database } from "../db/client";
import { parseAuthConfig } from "../config/runtime-config-defaults";
import { core_accounts, core_sessions } from "../db/schema/core";
import type { Auth } from "./better-auth";
import { CREDENTIAL_PROVIDER_ID } from "./entra-precedence";

export const ADMIN_RECOVERY_AUDIT_ACTION = "admin.recovery.password_reset";

export interface AdminRecoveryDependencies {
  readonly database: Database;
  readonly users: IUserRepository;
  readonly settings: ISystemSettingsRepository;
  readonly auditLogger: IAuditLogger;
  readonly getAuth: () => Promise<Auth>;
}

/**
 * Break-glass restoration of password sign-in, for the lockout that Entra
 * precedence creates: `applyEntraPrecedence` destroys an account's credential
 * row at link time, so once every administrator has signed in through Entra an
 * outage at the identity provider leaves nobody able to reach the settings page
 * that could turn email/password back on.
 *
 * The protection that deletion provides is not weakened by this, because the
 * attack it defends against is remote pre-registration at a victim's address.
 * Running this requires shell and database access to the deployment, which such
 * an attacker does not have.
 *
 * The caller must restart the application afterwards: `RuntimeConfigStore`
 * caches `AuthConfig` in-process for the lifetime of the process and only
 * clears it through `invalidateAuth()`, which is reachable only from the admin
 * settings mutation this recovery exists to work around.
 */
export class BetterAuthAdminRecovery implements IAdminRecovery {
  constructor(private readonly dependencies: AdminRecoveryDependencies) {}

  async recoverAdminAccess(
    input: RecoverAdminAccessInput,
  ): Promise<Result<AdminRecoveryOutcome>> {
    if (input.password.length === 0) {
      return err(domainError("VALIDATION_FAILED", "A replacement password is required."));
    }

    const email = normaliseEmail(input.email);
    const found = await this.dependencies.users.findByEmail(email);
    if (found.error) return err(found.error);
    if (!found.data) {
      return err(domainError("NOT_FOUND", `No user exists with the address ${email}.`));
    }
    const user = found.data;

    // Credential first: a config change that outlived a failed credential write
    // would leave the deployment offering a sign-in method nobody can use.
    const restored = await this.restoreCredential(user.id, input.password);
    if (restored.error) return err(restored.error);

    const reEnabled = await this.enableEmailPasswordSignIn();
    if (reEnabled.error) return err(reEnabled.error);

    await this.dependencies.auditLogger.log({
      actorId: null,
      action: ADMIN_RECOVERY_AUDIT_ACTION,
      resourceType: "user",
      resourceId: user.id,
      metadata: { email, wasAdmin: user.isAdmin, emailPasswordReEnabled: reEnabled.data },
    });

    return ok({
      userId: user.id,
      email,
      wasAdmin: user.isAdmin,
      emailPasswordReEnabled: reEnabled.data,
    });
  }

  // Delete-then-insert rather than an update: the row is normally absent (Entra
  // precedence removed it), and starting from a clean slate means a half-written
  // row left by an earlier attempt cannot survive into the restored credential.
  private async restoreCredential(userId: string, password: string): Promise<Result<true>> {
    try {
      const auth = await this.dependencies.getAuth();
      const context = await auth.$context;
      const passwordHash = await context.password.hash(password);

      await this.dependencies.database
        .delete(core_accounts)
        .where(
          and(
            eq(core_accounts.user_id, userId),
            eq(core_accounts.provider_id, CREDENTIAL_PROVIDER_ID),
          ),
        );

      // Better Auth's credential sign-up writes account_id = the user's own id;
      // sign-in finds the row by provider_id and verifies the password column.
      await this.dependencies.database.insert(core_accounts).values({
        user_id: userId,
        account_id: userId,
        provider_id: CREDENTIAL_PROVIDER_ID,
        password: passwordHash,
      });

      // Anything holding a session predates the reset, including whatever the
      // outage stranded.
      await this.dependencies.database
        .delete(core_sessions)
        .where(eq(core_sessions.user_id, userId));

      return ok(true);
    } catch (cause) {
      return err(
        domainError("INFRA_FAILURE", "Failed to restore password sign-in for the account.", cause),
      );
    }
  }

  // Returns whether the setting had to be changed, so the operator is told only
  // about a change that actually happened.
  private async enableEmailPasswordSignIn(): Promise<Result<boolean>> {
    const stored = await this.dependencies.settings.get(AUTH_CONFIG_SETTING_KEY);
    if (stored.error) return err(stored.error);

    // No stored row means the effective config comes from env, where
    // email/password is on. Writing one here would pin blank Entra credentials
    // over the env values, so an absent row is left absent.
    const fallback = createDefaultAuthConfig();
    const current: AuthConfig = stored.data?.value
      ? parseAuthConfig(stored.data.value, fallback)
      : fallback;
    if (current.emailPasswordEnabled) return ok(false);

    const merged: AuthConfig = { ...current, emailPasswordEnabled: true };
    const written = await this.dependencies.settings.set(
      AUTH_CONFIG_SETTING_KEY,
      JSON.stringify(merged),
    );
    if (written.error) return err(written.error);
    return ok(true);
  }
}
