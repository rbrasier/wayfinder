export interface UsageEvent {
  readonly id: string;
  readonly userId: string | null;
  readonly conversationId: string | null;
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
