import {
  domainError,
  err,
  ok,
  type IUsageRepository,
  type NewUsageEvent,
  type Result,
  type UsageEvent,
  type UsageFilter,
  type UsageSummary,
} from "@rbrasier/domain";
import { and, eq, gte, lte, sum, count, type SQL } from "drizzle-orm";
import type { Database } from "../db/client";
import { ai_usage_events } from "../db/schema/ai";

const toEntity = (row: typeof ai_usage_events.$inferSelect): UsageEvent => ({
  id: row.id,
  userId: row.user_id,
  conversationId: row.conversation_id,
  purpose: row.purpose,
  provider: row.provider,
  model: row.model,
  promptTokens: row.prompt_tokens,
  completionTokens: row.completion_tokens,
  systemTokens: row.system_tokens,
  cacheReadTokens: row.cache_read_tokens,
  cacheWriteTokens: row.cache_write_tokens,
  costUsd: row.cost_usd,
  metadata: row.metadata,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class DrizzleUsageRepository implements IUsageRepository {
  constructor(private readonly db: Database) {}

  async create(input: NewUsageEvent): Promise<Result<UsageEvent>> {
    try {
      const [row] = await this.db
        .insert(ai_usage_events)
        .values({
          user_id: input.userId ?? null,
          conversation_id: input.conversationId ?? null,
          purpose: input.purpose,
          provider: input.provider,
          model: input.model,
          prompt_tokens: input.promptTokens,
          completion_tokens: input.completionTokens,
          system_tokens: input.systemTokens,
          cache_read_tokens: input.cacheReadTokens,
          cache_write_tokens: input.cacheWriteTokens,
          cost_usd: input.costUsd,
          metadata: input.metadata ?? null,
        })
        .returning();
      if (!row) return err(domainError("INFRA_FAILURE", "Usage insert returned no row."));
      return ok(toEntity(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to record usage event.", cause));
    }
  }

  async summarize(filter?: UsageFilter): Promise<Result<UsageSummary[]>> {
    try {
      const conds: SQL[] = [];
      if (filter?.userId) conds.push(eq(ai_usage_events.user_id, filter.userId));
      if (filter?.provider) conds.push(eq(ai_usage_events.provider, filter.provider));
      if (filter?.model) conds.push(eq(ai_usage_events.model, filter.model));
      if (filter?.from) conds.push(gte(ai_usage_events.created_at, filter.from));
      if (filter?.to) conds.push(lte(ai_usage_events.created_at, filter.to));

      const rows = await this.db
        .select({
          provider: ai_usage_events.provider,
          model: ai_usage_events.model,
          totalPromptTokens: sum(ai_usage_events.prompt_tokens),
          totalCompletionTokens: sum(ai_usage_events.completion_tokens),
          totalCacheReadTokens: sum(ai_usage_events.cache_read_tokens),
          totalCacheWriteTokens: sum(ai_usage_events.cache_write_tokens),
          totalCostUsd: sum(ai_usage_events.cost_usd),
          eventCount: count(),
        })
        .from(ai_usage_events)
        .where(conds.length ? and(...conds) : undefined)
        .groupBy(ai_usage_events.provider, ai_usage_events.model);

      return ok(
        rows.map((r) => ({
          provider: r.provider,
          model: r.model,
          totalPromptTokens: Number(r.totalPromptTokens ?? 0),
          totalCompletionTokens: Number(r.totalCompletionTokens ?? 0),
          totalCacheReadTokens: Number(r.totalCacheReadTokens ?? 0),
          totalCacheWriteTokens: Number(r.totalCacheWriteTokens ?? 0),
          totalCostUsd: Number(r.totalCostUsd ?? 0),
          eventCount: Number(r.eventCount),
        })),
      );
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to summarize usage.", cause));
    }
  }
}
