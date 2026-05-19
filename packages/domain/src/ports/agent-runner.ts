import type { Result } from "../result";

export interface AgentInput {
  readonly prompt: string;
  readonly context?: Record<string, unknown>;
}

export interface AgentOutput {
  readonly output: string;
  readonly steps: ReadonlyArray<{
    readonly node: string;
    readonly summary: string;
  }>;
  readonly metadata?: Record<string, unknown>;
}

export interface AgentRunConfig {
  readonly userId?: string;
  readonly conversationId?: string;
  readonly traceId?: string;
}

export interface IAgentRunner {
  run(input: AgentInput, config?: AgentRunConfig): Promise<Result<AgentOutput>>;
}
