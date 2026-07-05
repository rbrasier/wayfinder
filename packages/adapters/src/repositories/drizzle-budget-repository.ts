import {
  domainError,
  err,
  ok,
  type Budget,
  type BudgetUpdate,
  type IBudgetRepository,
  type NewBudget,
  type Result,
} from "@rbrasier/domain";
import { and, eq, inArray, or, type SQL } from "drizzle-orm";
import type { Database } from "../db/client";
import { app_usage_budgets } from "../db/schema/wayfinder";

const toEntity = (row: typeof app_usage_budgets.$inferSelect): Budget => ({
  id: row.id,
  scope: row.scope,
  roleKey: row.role_key,
  userId: row.user_id,
  period: row.period,
  limitUsd: row.limit_usd,
  warnThresholdPct: row.warn_threshold_pct,
  enabled: row.enabled,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class DrizzleBudgetRepository implements IBudgetRepository {
  constructor(private readonly db: Database) {}

  async create(input: NewBudget): Promise<Result<Budget>> {
    try {
      const [row] = await this.db
        .insert(app_usage_budgets)
        .values({
          scope: input.scope,
          role_key: input.roleKey ?? null,
          user_id: input.userId ?? null,
          period: input.period,
          limit_usd: input.limitUsd,
          warn_threshold_pct: input.warnThresholdPct ?? 80,
          enabled: input.enabled ?? false,
        })
        .returning();
      if (!row) return err(domainError("INFRA_FAILURE", "Budget insert returned no row."));
      return ok(toEntity(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to create budget.", cause));
    }
  }

  async update(id: string, patch: BudgetUpdate): Promise<Result<Budget>> {
    try {
      const [row] = await this.db
        .update(app_usage_budgets)
        .set({
          ...(patch.period !== undefined ? { period: patch.period } : {}),
          ...(patch.limitUsd !== undefined ? { limit_usd: patch.limitUsd } : {}),
          ...(patch.warnThresholdPct !== undefined
            ? { warn_threshold_pct: patch.warnThresholdPct }
            : {}),
          ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
          updated_at: new Date(),
        })
        .where(eq(app_usage_budgets.id, id))
        .returning();
      if (!row) return err(domainError("NOT_FOUND", "Budget not found."));
      return ok(toEntity(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to update budget.", cause));
    }
  }

  async delete(id: string): Promise<Result<true>> {
    try {
      await this.db.delete(app_usage_budgets).where(eq(app_usage_budgets.id, id));
      return ok(true as const);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to delete budget.", cause));
    }
  }

  async findById(id: string): Promise<Result<Budget | null>> {
    try {
      const [row] = await this.db
        .select()
        .from(app_usage_budgets)
        .where(eq(app_usage_budgets.id, id))
        .limit(1);
      return ok(row ? toEntity(row) : null);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to find budget.", cause));
    }
  }

  async list(): Promise<Result<Budget[]>> {
    try {
      const rows = await this.db.select().from(app_usage_budgets);
      return ok(rows.map(toEntity));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to list budgets.", cause));
    }
  }

  async findEnabledCandidatesForUser(
    userId: string,
    roleKeys: string[],
  ): Promise<Result<Budget[]>> {
    try {
      // Every enabled row that could apply to this user: everyone templates, the
      // user's own row, and role rows for the roles they actually hold. The pure
      // resolver narrows these to one effective cap per period.
      const scopeMatches: SQL[] = [
        eq(app_usage_budgets.scope, "everyone"),
        and(eq(app_usage_budgets.scope, "user"), eq(app_usage_budgets.user_id, userId)) as SQL,
      ];
      if (roleKeys.length > 0) {
        scopeMatches.push(
          and(
            eq(app_usage_budgets.scope, "role"),
            inArray(app_usage_budgets.role_key, roleKeys),
          ) as SQL,
        );
      }
      const rows = await this.db
        .select()
        .from(app_usage_budgets)
        .where(and(eq(app_usage_budgets.enabled, true), or(...scopeMatches)));
      return ok(rows.map(toEntity));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to find budget candidates for user.", cause));
    }
  }
}
