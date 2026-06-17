export interface UsageEvent {
  readonly id: string;
  readonly userId: string | null;
  readonly conversationId: string | null;
  readonly flowId: string | null;
  readonly sessionId: string | null;
  readonly purpose: string;
  readonly provider: string;
  readonly model: string;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly systemTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly costUsd: number;
  readonly metadata: Record<string, unknown> | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface NewUsageEvent {
  readonly userId?: string | null;
  readonly conversationId?: string | null;
  readonly flowId?: string | null;
  readonly sessionId?: string | null;
  readonly purpose: string;
  readonly provider: string;
  readonly model: string;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly systemTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly costUsd: number;
  readonly metadata?: Record<string, unknown> | null;
}

export interface UsageSummary {
  readonly provider: string;
  readonly model: string;
  readonly totalPromptTokens: number;
  readonly totalCompletionTokens: number;
  readonly totalCacheReadTokens: number;
  readonly totalCacheWriteTokens: number;
  readonly totalCostUsd: number;
  readonly eventCount: number;
}

export type UsageDimension = "user" | "flow";

// Spend grouped by a single dimension (`user_id` or `flow_id`) for the
// governance dashboard. `key` is null when the dimension column was null on the
// recorded events (e.g. spend with no flow attribution).
export interface UsageGroupSummary {
  readonly dimension: UsageDimension;
  readonly key: string | null;
  readonly totalCostUsd: number;
  readonly eventCount: number;
}
