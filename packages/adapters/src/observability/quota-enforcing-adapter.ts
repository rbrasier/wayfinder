import {
  budgetPeriodStart,
  domainError,
  err,
  evaluateBudget,
  ok,
  type Budget,
  type GenerateObjectInput,
  type IAuditLogger,
  type IBudgetRepository,
  type ILanguageModel,
  type IUsageRepository,
  type ProviderName,
  type Result,
  type StreamObjectInput,
  type StreamTextInput,
  type TokenUsage,
} from "@rbrasier/domain";

interface CapEvaluation {
  budget: Budget;
  spendUsd: number;
  ratio: number;
}

// Shared budget check used by both the decorator (port calls) and the chat
// stream route (which calls the Vercel SDK directly, bypassing the port). Holds
// the per-process warn de-duplication set (ADR-026 open question: one warn per
// user per period window).
export class QuotaEnforcer {
  private readonly warnedKeys = new Set<string>();

  constructor(
    private readonly budgetRepo: IBudgetRepository,
    private readonly usageRepo: IUsageRepository,
    private readonly auditLog: IAuditLogger,
    private readonly now: () => Date = () => new Date(),
  ) {}

  // Returns err(QUOTA_EXCEEDED) when an enabled cap is at/over its limit; ok
  // otherwise. Fails open (proceeds) on a budget/usage lookup error — a cap is a
  // governance ceiling, not a hard wall, and an infra blip must not halt all AI.
  async check(userId?: string | null): Promise<Result<true>> {
    if (!userId) return ok(true as const);

    const enabledResult = await this.budgetRepo.findEnabledForUser(userId);
    if (enabledResult.error) return ok(true as const);

    const caps = enabledResult.data;
    if (caps.length === 0) return ok(true as const);

    const now = this.now();
    const evaluations: CapEvaluation[] = [];
    for (const budget of caps) {
      const spendUsd = await this.currentSpend(userId, budget, now);
      const { ratio } = evaluateBudget(budget, spendUsd);
      evaluations.push({ budget, spendUsd, ratio });
    }

    const blocked = evaluations.find(
      (evaluation) => evaluateBudget(evaluation.budget, evaluation.spendUsd).status === "blocked",
    );
    if (blocked) {
      await this.writeAudit("budget.blocked", userId, blocked);
      return err(
        domainError(
          "QUOTA_EXCEEDED",
          "You have reached your usage cap — contact an administrator to continue.",
        ),
      );
    }

    for (const evaluation of evaluations) {
      if (evaluateBudget(evaluation.budget, evaluation.spendUsd).status !== "warn") continue;
      if (this.markWarned(userId, evaluation.budget, now)) {
        await this.writeAudit("budget.warn", userId, evaluation);
      }
    }

    return ok(true as const);
  }

  private async currentSpend(userId: string, budget: Budget, now: Date): Promise<number> {
    const since = budgetPeriodStart(budget.period, now);
    const summary = await this.usageRepo.summarize({ userId, since });
    if (summary.error) return 0;
    return summary.data.reduce((total, row) => total + row.totalCostUsd, 0);
  }

  private markWarned(userId: string, budget: Budget, now: Date): boolean {
    const key = `${userId}:${budget.period}:${budgetPeriodStart(budget.period, now).toISOString()}`;
    if (this.warnedKeys.has(key)) return false;
    this.warnedKeys.add(key);
    return true;
  }

  private async writeAudit(
    action: "budget.warn" | "budget.blocked",
    userId: string,
    evaluation: CapEvaluation,
  ): Promise<void> {
    await this.auditLog.log({
      actorId: userId,
      action,
      resourceType: "budget",
      resourceId: evaluation.budget.id,
      metadata: {
        period: evaluation.budget.period,
        limitUsd: evaluation.budget.limitUsd,
        spendUsd: evaluation.spendUsd,
        ratio: evaluation.ratio,
      },
    });
  }
}

// Ordered outermost (ADR-026 §3): the check runs before the inner usage-tracking
// + provider call and short-circuits a blocked user without spending.
export class QuotaEnforcingLanguageModel implements ILanguageModel {
  constructor(
    private readonly inner: ILanguageModel,
    private readonly enforcer: QuotaEnforcer,
  ) {}

  get provider(): ProviderName {
    return this.inner.provider;
  }

  async generateObject<T>(
    input: GenerateObjectInput,
  ): Promise<Result<{ object: T; usage: TokenUsage }>> {
    const check = await this.enforcer.check(input.userId);
    if (check.error) return err(check.error);
    return this.inner.generateObject<T>(input);
  }

  async streamText(
    input: StreamTextInput,
  ): Promise<Result<{ textStream: AsyncIterable<string>; usage: Promise<TokenUsage> }>> {
    const check = await this.enforcer.check(input.userId);
    if (check.error) return err(check.error);
    return this.inner.streamText(input);
  }

  async streamObject<T>(
    input: StreamObjectInput,
  ): Promise<
    Result<{
      partialObjectStream: AsyncIterable<Partial<T>>;
      object: Promise<T>;
      usage: Promise<TokenUsage>;
    }>
  > {
    const check = await this.enforcer.check(input.userId);
    if (check.error) return err(check.error);
    return this.inner.streamObject<T>(input);
  }
}

// The enforcer is constructed separately and shared so the chat stream route —
// which calls the Vercel SDK directly, outside the port — can run the identical
// check before streaming (ADR-026 §6).
export const withQuotaEnforcement = (
  inner: ILanguageModel,
  enforcer: QuotaEnforcer,
): ILanguageModel => new QuotaEnforcingLanguageModel(inner, enforcer);
