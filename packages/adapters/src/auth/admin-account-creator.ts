import { eq, sql } from "drizzle-orm";
import {
  domainError,
  err,
  ok,
  type CreateAdminAccountInput,
  type IAdminAccountCreator,
  type Result,
} from "@rbrasier/domain";
import type { Database } from "../db/client";
import { core_users } from "../db/schema/core";
import type { Auth } from "./better-auth";

// A stable, arbitrary key for the bootstrap advisory lock (ADR-041 mnemonic).
// Any concurrent createFirstAdmin call serialises on it, so at most one admin is
// ever created regardless of races.
const BOOTSTRAP_LOCK_KEY = 4149041;

// The subset of Better Auth's server API this adapter uses. Better Auth types
// `api` loosely, so the call shape is declared here (verified against
// better-auth@1.6 `auth.api.signUpEmail({ body })`).
interface SignUpApi {
  signUpEmail(input: {
    body: { email: string; password: string; name: string };
  }): Promise<unknown>;
}

// Bootstraps the very first administrator (ADR-041 §0). Password hashing is
// delegated to Better Auth's credential sign-up; the transactional advisory lock
// makes the "no admin exists" check-and-create atomic across connections and
// processes.
export class BetterAuthAdminAccountCreator implements IAdminAccountCreator {
  constructor(
    private readonly db: Database,
    private readonly getAuth: () => Promise<Auth>,
  ) {}

  async adminExists(): Promise<Result<boolean>> {
    try {
      const [row] = await this.db
        .select({ id: core_users.id })
        .from(core_users)
        .where(eq(core_users.is_admin, true))
        .limit(1);
      return ok(Boolean(row));
    } catch (cause) {
      return err(
        domainError("INFRA_FAILURE", "Failed to check for an existing administrator.", cause),
      );
    }
  }

  async createFirstAdmin(
    input: CreateAdminAccountInput,
  ): Promise<Result<{ userId: string }>> {
    try {
      return await this.db.transaction(async (tx) => {
        // Transaction-scoped lock: every concurrent bootstrap blocks here until
        // the holder commits, then re-reads and sees the admin already exists.
        await tx.execute(sql`select pg_advisory_xact_lock(${BOOTSTRAP_LOCK_KEY})`);

        const [existing] = await tx
          .select({ id: core_users.id })
          .from(core_users)
          .where(eq(core_users.is_admin, true))
          .limit(1);
        if (existing) {
          return err(domainError("CONFLICT", "An administrator already exists."));
        }

        const auth = await this.getAuth();
        const api = auth.api as unknown as SignUpApi;
        // Better Auth inserts the user + credential row on its own connection and
        // commits; the row is visible to this READ COMMITTED transaction below.
        await api.signUpEmail({
          body: { email: input.email, password: input.password, name: input.name },
        });

        const [promoted] = await tx
          .update(core_users)
          .set({ is_admin: true, updated_at: new Date() })
          .where(eq(core_users.email, input.email))
          .returning({ id: core_users.id });
        if (!promoted) {
          return err(
            domainError(
              "INFRA_FAILURE",
              "The admin account was created but could not be promoted to administrator.",
            ),
          );
        }

        return ok({ userId: promoted.id });
      });
    } catch (cause) {
      return err(
        domainError("INFRA_FAILURE", "Failed to create the first administrator.", cause),
      );
    }
  }
}
