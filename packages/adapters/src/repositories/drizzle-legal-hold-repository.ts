import {
  domainError,
  err,
  ok,
  type ILegalHoldRepository,
  type LegalHold,
  type NewLegalHold,
  type Result,
} from "@rbrasier/domain";
import { desc, eq, isNull } from "drizzle-orm";
import type { Database } from "../db/client";
import { app_legal_holds } from "../db/schema/app";

const toEntity = (row: typeof app_legal_holds.$inferSelect): LegalHold => ({
  id: row.id,
  name: row.name,
  reason: row.reason,
  createdBy: row.created_by,
  scope: row.scope,
  releasedAt: row.released_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class DrizzleLegalHoldRepository implements ILegalHoldRepository {
  constructor(private readonly db: Database) {}

  async create(hold: NewLegalHold): Promise<Result<LegalHold>> {
    try {
      const [row] = await this.db
        .insert(app_legal_holds)
        .values({
          name: hold.name,
          reason: hold.reason ?? null,
          created_by: hold.createdBy ?? null,
          scope: hold.scope,
        })
        .returning();
      if (!row) return err(domainError("INFRA_FAILURE", "Legal hold insert returned no row."));
      return ok(toEntity(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to create legal hold.", cause));
    }
  }

  async list(): Promise<Result<LegalHold[]>> {
    try {
      const rows = await this.db
        .select()
        .from(app_legal_holds)
        .orderBy(desc(app_legal_holds.created_at));
      return ok(rows.map(toEntity));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to list legal holds.", cause));
    }
  }

  async listActive(): Promise<Result<LegalHold[]>> {
    try {
      const rows = await this.db
        .select()
        .from(app_legal_holds)
        .where(isNull(app_legal_holds.released_at))
        .orderBy(desc(app_legal_holds.created_at));
      return ok(rows.map(toEntity));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to list active legal holds.", cause));
    }
  }

  async release(id: string): Promise<Result<LegalHold>> {
    try {
      const now = new Date();
      const [row] = await this.db
        .update(app_legal_holds)
        // Only an active hold can be released; a second release is a no-op that
        // returns NOT_FOUND rather than resurrecting a released hold's timestamp.
        .set({ released_at: now, updated_at: now })
        .where(eq(app_legal_holds.id, id))
        .returning();
      if (!row) return err(domainError("NOT_FOUND", "Legal hold not found."));
      return ok(toEntity(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to release legal hold.", cause));
    }
  }
}
