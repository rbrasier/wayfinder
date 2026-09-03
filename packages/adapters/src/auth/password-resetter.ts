import { and, eq } from "drizzle-orm";
import {
  domainError,
  err,
  ok,
  type IPasswordResetter,
  type PasswordResetOutcome,
  type PasswordResetRequest,
  type Result,
} from "@rbrasier/domain";
import type { Database } from "../db/client";
import { core_accounts, core_sessions } from "../db/schema/core";
import type { Auth } from "./better-auth";
import { CREDENTIAL_PROVIDER_ID } from "./entra-precedence";

export interface PasswordResetterDependencies {
  readonly database: Database;
  readonly getAuth: () => Promise<Auth>;
}

/**
 * Replaces one user's local password on an administrator's instruction.
 *
 * Shares the credential-write technique with `BetterAuthAdminRecovery` but not
 * its purpose: recovery also forces email/password sign-in back on across the
 * deployment, because the operator running it is locked out of the settings
 * page. An administrator using this is already signed in, so changing that
 * setting here would be an unrequested change to how everyone signs in.
 */
export class BetterAuthPasswordResetter implements IPasswordResetter {
  constructor(private readonly dependencies: PasswordResetterDependencies) {}

  async resetPassword(input: PasswordResetRequest): Promise<Result<PasswordResetOutcome>> {
    try {
      // Hashed before the transaction opens: the hash is deliberately slow, and
      // holding row locks across it would serialise unrelated writes.
      const auth = await this.dependencies.getAuth();
      const context = await auth.$context;
      const passwordHash = await context.password.hash(input.password);

      const sessionsRevoked = await this.dependencies.database.transaction(async (tx) => {
        // Delete-then-insert rather than an update: the row is absent whenever
        // Entra precedence removed it, and starting clean means a half-written
        // row from an earlier attempt cannot survive into the new credential.
        await tx
          .delete(core_accounts)
          .where(
            and(
              eq(core_accounts.user_id, input.userId),
              eq(core_accounts.provider_id, CREDENTIAL_PROVIDER_ID),
            ),
          );

        // Better Auth's credential sign-up writes account_id = the user's own id;
        // sign-in finds the row by provider_id and verifies the password column.
        await tx.insert(core_accounts).values({
          user_id: input.userId,
          account_id: input.userId,
          provider_id: CREDENTIAL_PROVIDER_ID,
          password: passwordHash,
        });

        // RETURNING rather than a driver-specific row count, so the number the
        // administrator is shown does not depend on the Postgres client.
        const revoked = await tx
          .delete(core_sessions)
          .where(eq(core_sessions.user_id, input.userId))
          .returning({ id: core_sessions.id });

        return revoked.length;
      });

      return ok({ userId: input.userId, sessionsRevoked });
    } catch (cause) {
      return err(
        domainError("INFRA_FAILURE", "Failed to reset the password for the account.", cause),
      );
    }
  }
}
