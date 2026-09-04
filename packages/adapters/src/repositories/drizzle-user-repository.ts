import {
  domainError,
  err,
  normaliseEmail,
  ok,
  type IUserRepository,
  type NewUser,
  type Result,
  type User,
  type UserUpdate,
} from "@rbrasier/domain";
import { eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import type { Database } from "../db/client";
import { core_users } from "../db/schema/core";

// `%` and `_` are wildcards to LIKE, so a name containing one would otherwise
// widen the search rather than narrow it. Exported for the unit test — the
// escaping is the part of this query worth asserting without a database.
export const escapeLikePattern = (value: string): string =>
  value.replace(/[\\%_]/g, (character) => `\\${character}`);

// One IN query over the requested ids — the batch read that removes the
// per-participant N+1 (scaling wall #6). Callers guarantee a non-empty list.
export const buildFindByIdsStatement = (ids: readonly string[]): SQL => sql`
  SELECT * FROM ${core_users}
  WHERE ${inArray(core_users.id, [...ids])}
`;

// Better Auth writes `name` directly through its own Drizzle adapter, so a
// sign-up that left the field empty lands here as "" rather than null. Collapse
// blank to null on the way out so callers only ever see a real name or nothing.
export const normaliseName = (name: string | null): string | null => name?.trim() || null;

const toEntity = (row: typeof core_users.$inferSelect): User => ({
  id: row.id,
  email: row.email,
  name: normaliseName(row.name),
  role: row.role,
  team: row.team,
  organisationId: row.organisation_id,
  emailVerified: row.email_verified,
  isAdmin: row.is_admin,
  welcomeTourCompletedAt: row.welcome_tour_completed_at,
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
          email: normaliseEmail(input.email),
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
      const [row] = await this.db
        .select()
        .from(core_users)
        .where(eq(core_users.email, normaliseEmail(email)));
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

  async search(input: { query: string; limit: number }): Promise<Result<User[]>> {
    const term = input.query.trim();
    // A blank query would match every row; the type-ahead only searches once
    // the operator has typed something, and this makes that a guarantee.
    if (term.length === 0) return ok([]);

    try {
      const pattern = `%${escapeLikePattern(term)}%`;
      const rows = await this.db
        .select()
        .from(core_users)
        .where(or(ilike(core_users.name, pattern), ilike(core_users.email, pattern)))
        .orderBy(core_users.name)
        .limit(input.limit);
      return ok(rows.map(toEntity));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to search users.", cause));
    }
  }

  async update(id: string, patch: UserUpdate): Promise<Result<User>> {
    try {
      const [row] = await this.db
        .update(core_users)
        .set({
          ...(patch.email !== undefined ? { email: normaliseEmail(patch.email) } : {}),
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.role !== undefined ? { role: patch.role } : {}),
          ...(patch.team !== undefined ? { team: patch.team } : {}),
          ...(patch.organisationId !== undefined ? { organisation_id: patch.organisationId } : {}),
          ...(patch.isAdmin !== undefined ? { is_admin: patch.isAdmin } : {}),
          ...(patch.welcomeTourCompletedAt !== undefined
            ? { welcome_tour_completed_at: patch.welcomeTourCompletedAt }
            : {}),
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
