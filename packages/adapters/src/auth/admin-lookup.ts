import { eq } from "drizzle-orm";
import { domainError, err, ok, type IAdminLookup, type Result } from "@wayfinder/domain";
import type { Database } from "../db/client";
import { core_users } from "../db/schema/core";

// The "does an administrator exist" query on its own, with a database handle as
// its only dependency. BetterAuthAdminAccountCreator delegates to it, and the
// startup setup-link emitter uses it directly so answering the question on the
// boot path never has to construct the auth provider.
export class DrizzleAdminLookup implements IAdminLookup {
  constructor(private readonly db: Database) {}

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
}
