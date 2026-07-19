import {
  domainError,
  err,
  ok,
  type IUserRepository,
  type NewUser,
  type Result,
  type User,
  type UserUpdate,
} from "@rbrasier/domain";
import { eq, inArray, sql, type SQL } from "drizzle-orm";
import type { Database } from "../db/client";
import { core_users } from "../db/schema/core";

// One IN query over the requested ids — the batch read that removes the
// per-participant N+1 (scaling wall #6). Callers guarantee a non-empty list.
export const buildFindByIdsStatement = (ids: readonly string[]): SQL => sql`
  SELECT * FROM ${core_users}
  WHERE ${inArray(core_users.id, [...ids])}
`;

const toEntity = (row: typeof core_users.$inferSelect): User => ({
  id: row.id,
  email: row.email,
  name: row.name,
  role: row.role,
  team: row.team,
  organisationId: row.organisation_id,
  emailVerified: row.email_verified,
  isAdmin: row.is_admin,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class DrizzleUserRepository implements IUserRepository {
  constructor(private readonly db: Database) {}

  async create(input: NewUser): Promise<Result<User>> {
    try {
      const [row] = await this.db
        .insert(core_users)
        .values({
          email: input.email,
          name: input.name ?? null,
          role: input.role ?? null,
          team: input.team ?? null,
          organisation_id: input.organisationId ?? null,
          is_admin: input.isAdmin ?? false,
        })
        .returning();
      if (!row) return err(domainError("INFRA_FAILURE", "User insert returned no row."));
      return ok(toEntity(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to create user.", cause));
    }
  }

  async findById(id: string): Promise<Result<User | null>> {
    try {
      const [row] = await this.db.select().from(core_users).where(eq(core_users.id, id));
      return ok(row ? toEntity(row) : null);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to find user.", cause));
    }
  }

  async findByIds(ids: readonly string[]): Promise<Result<User[]>> {
    if (ids.length === 0) return ok([]);
    try {
      const rows = (await this.db.execute(
        buildFindByIdsStatement(ids),
      )) as unknown as (typeof core_users.$inferSelect)[];
      return ok(rows.map(toEntity));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to find users by ids.", cause));
    }
  }

  async findByEmail(email: string): Promise<Result<User | null>> {
    try {
      const [row] = await this.db.select().from(core_users).where(eq(core_users.email, email));
      return ok(row ? toEntity(row) : null);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to find user.", cause));
    }
  }

  async list(opts?: { limit?: number; offset?: number }): Promise<Result<User[]>> {
    try {
      const rows = await this.db
        .select()
        .from(core_users)
        .limit(opts?.limit ?? 100)
        .offset(opts?.offset ?? 0);
      return ok(rows.map(toEntity));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to list users.", cause));
    }
  }

  async update(id: string, patch: UserUpdate): Promise<Result<User>> {
    try {
      const [row] = await this.db
        .update(core_users)
        .set({
          ...(patch.email !== undefined ? { email: patch.email } : {}),
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.role !== undefined ? { role: patch.role } : {}),
          ...(patch.team !== undefined ? { team: patch.team } : {}),
          ...(patch.organisationId !== undefined ? { organisation_id: patch.organisationId } : {}),
          ...(patch.isAdmin !== undefined ? { is_admin: patch.isAdmin } : {}),
          updated_at: new Date(),
        })
        .where(eq(core_users.id, id))
        .returning();
      if (!row) return err(domainError("NOT_FOUND", `User ${id} not found.`));
      return ok(toEntity(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to update user.", cause));
    }
  }

  async delete(id: string): Promise<Result<true>> {
    try {
      await this.db.delete(core_users).where(eq(core_users.id, id));
      return ok(true as const);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to delete user.", cause));
    }
  }
}
