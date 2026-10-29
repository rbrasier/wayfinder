import {
  domainError,
  err,
  ok,
  type McpServer,
  type McpToolCallRecord,
  type ProviderName,
  type IUsageRepository,
  type Result,
  type TokenUsage,
} from "@rbrasier/domain";
import { experimental_createMCPClient } from "@ai-sdk/mcp";
import {
  generateText,
  stepCountIs,
  type LanguageModel,
  type LanguageModelUsage,
  type ProviderMetadata,
  type ToolSet,
} from "ai";
import { buildMcpTransport } from "./ai-sdk-mcp-client";
import type { McpBearerTokenResolver } from "./mcp-bearer-token-resolver";
import { recordTokenUsage } from "../observability/usage-tracking-adapter";
import type { QuotaEnforcer } from "../observability/quota-enforcing-adapter";

export interface McpToolPrepassInput {
  model: LanguageModel;
  // Provider + model name label the usage record the governance stack writes, so
  // the pre-pass appears in spend/quota reporting like every other model call.
  provider: ProviderName;
  modelName: string;
  system: string;
  // The conversation so far, already trimmed by the caller.
  messages: { role: "user" | "assistant"; content: string }[];
  servers: McpServer[];
  // Allowed tool names per server id (deny-by-default — anything not listed is
  // never assembled into the toolset).
  allowedToolNamesByServer: Record<string, string[]>;
  maxSteps?: number;
  // Whole-pre-pass wall-clock budget. A hung MCP server must not hold the turn
  // lease open indefinitely, so the tool loop is aborted past this deadline.
  timeoutMs?: number;
  userId?: string | null;
  flowId?: string | null;
  sessionId?: string | null;
  // Usage-record label; defaults to the pre-pass purpose.
  purpose?: string;
}

export interface McpToolPrepassResult {
  // Free-text summary of what the tools returned, for injection into the
  // structured turn's context.
  summary: string;
  toolCallCount: number;
  // Structured record of every call for the audit trail (ADR-032).
  toolCalls: McpToolCallRecord[];
}

// Default whole-pre-pass budget. The tool loop can make several sequential model
// + tool round-trips, so this is generous relative to a single node call.
const DEFAULT_PREPASS_TIMEOUT_MS = 15_000;

// Per-value cap on persisted call arguments/results so one large tool payload
// can never bloat the stored turn.
const AUDIT_ARGUMENTS_MAX_CHARS = 1_000;
const AUDIT_RESULT_MAX_CHARS = 4_000;

const truncate = (value: string, max: number): string =>
  value.length > max ? `${value.slice(0, max)}… [truncated]` : value;

// Deny-by-default tool selection. Exported for unit testing without a live
// server (ADR-032 testing notes).
export function selectAllowedTools(allTools: ToolSet, allowedNames: string[]): ToolSet {
  const allow = new Set(allowedNames);
  const selected: ToolSet = {};
  for (const [name, tool] of Object.entries(allTools)) {
    if (allow.has(name)) selected[name] = tool;
  }
  return selected;
}

// Namespaced tool key. Two allowed servers can expose the same tool name; a flat
// name-keyed toolset silently shadows one with the other, so every tool is keyed
// by its server as well (refs are already (serverId, toolName)). Exported for
// unit testing the collision rule.
export function prefixToolName(serverLabel: string, toolName: string): string {
  const slug = serverLabel.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "server";
  return `${slug}__${toolName}`;
}

interface ToolOrigin {
  serverLabel: string;
  toolName: string;
}

// Guards against two servers whose labels slug to the same prefix by suffixing a
// disambiguator, so no assembled key is ever overwritten.
function uniqueKey(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base}_${suffix}`)) suffix += 1;
  return `${base}_${suffix}`;
}

// The conversational tool-loop, run as a non-streaming pre-pass (ADR-032). It lets
// the model call the step's allowed MCP tools, then returns the gathered text for
// the caller to fold into the structured turn's context — leaving the streaming
// structured turn untouched. Runs through the governance building blocks the port
// decorators use for direct-SDK calls: the quota check short-circuits a blocked
// user before any spend, and token usage is recorded so the tokens are tracked
// and count against caps. Live behaviour is a staging smoke test; tool selection,
// name prefixing, and audit extraction are unit-tested.
export class McpToolPrepass {
  constructor(
    private readonly usageRepo: IUsageRepository,
    private readonly quotaEnforcer: QuotaEnforcer,
    // Stored tokens and OAuth access tokens; without it a server whose token is
    // not in the environment is called unauthenticated.
    private readonly bearerTokens: Pick<McpBearerTokenResolver, "resolve">,
  ) {}

  async run(input: McpToolPrepassInput): Promise<Result<McpToolPrepassResult>> {
    // Quota is enforced outermost, before any tokens are spent — the same
    // ceiling the port applies to every other model call (ADR-026).
    const gate = await this.quotaEnforcer.check(input.userId);
    if (gate.error) return err(gate.error);

    const clients: Awaited<ReturnType<typeof experimental_createMCPClient>>[] = [];
    // Collected as each round finishes, so a loop cut off by the deadline still
    // hands over what its earlier rounds fetched.
    const completedSteps: CompletedStep[] = [];
    const origins = new Map<string, ToolOrigin>();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? DEFAULT_PREPASS_TIMEOUT_MS);
    try {
      let tools: ToolSet = {};
      const takenKeys = new Set<string>();
      for (const server of input.servers) {
        const allowed = input.allowedToolNamesByServer[server.id] ?? [];
        if (allowed.length === 0) continue;
        const bearerToken = await this.bearerTokens.resolve(server);
        if (bearerToken.error) return bearerToken;
        const client = await experimental_createMCPClient({
          transport: buildMcpTransport(server, bearerToken.data),
        });
        clients.push(client);
        const serverTools = (await client.tools()) as ToolSet;
        for (const [name, tool] of Object.entries(selectAllowedTools(serverTools, allowed))) {
          const key = uniqueKey(prefixToolName(server.label, name), takenKeys);
          takenKeys.add(key);
          tools[key] = tool;
          origins.set(key, { serverLabel: server.label, toolName: name });
        }
      }

      if (Object.keys(tools).length === 0) {
        return ok({ summary: "", toolCallCount: 0, toolCalls: [] });
      }

      const result = await generateText({
        model: input.model,
        system: input.system,
        messages: input.messages,
        tools,
        stopWhen: stepCountIs(input.maxSteps ?? 4),
        abortSignal: controller.signal,
        onStepFinish: (step) => {
          completedSteps.push(step);
        },
      });

      // `totalUsage`, not `usage`: ai@5 reports only the final step under `usage`,
      // which would bill a multi-round tool loop as a single call.
      this.recordUsage(input, toTokenUsage(result.totalUsage, result.providerMetadata));

      const toolCalls = extractToolCalls(result.steps, origins);
      return ok({ summary: result.text.trim(), toolCallCount: toolCalls.length, toolCalls });
    } catch (cause) {
      const partialCalls = controller.signal.aborted ? extractToolCalls(completedSteps, origins) : [];
      if (partialCalls.length === 0) {
        return err(domainError("AGENT_FAILED", "MCP tool pre-pass failed.", cause));
      }
      this.recordUsage(input, {
        promptTokens: sumUsage(completedSteps, "inputTokens"),
        completionTokens: sumUsage(completedSteps, "outputTokens"),
        systemTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      });
      return ok({ summary: "", toolCallCount: partialCalls.length, toolCalls: partialCalls });
    } finally {
      clearTimeout(timeout);
      for (const client of clients) {
        try {
          await client.close();
        } catch {
          // best-effort close
        }
      }
    }
  }

  private recordUsage(input: McpToolPrepassInput, usage: TokenUsage): void {
    recordTokenUsage(
      this.usageRepo,
      {
        purpose: input.purpose ?? "chat-mcp-prepass",
        userId: input.userId,
        flowId: input.flowId,
        sessionId: input.sessionId,
        model: input.modelName,
        provider: input.provider,
      },
      usage,
    );
  }
}

interface CompletedStep extends StepLike {
  usage: LanguageModelUsage;
}

const sumUsage = (steps: readonly CompletedStep[], key: "inputTokens" | "outputTokens"): number =>
  steps.reduce((total, step) => total + (step.usage?.[key] ?? 0), 0);

interface StepLike {
  toolCalls: readonly { toolCallId: string; toolName: string; input: unknown }[];
  toolResults: readonly { toolCallId: string; output: unknown }[];
}

// Pairs each tool call with its result (by call id) into an audit record.
// Exported for unit testing without a live model.
export function extractToolCalls(
  steps: readonly StepLike[],
  origins: Map<string, { serverLabel: string; toolName: string }>,
  now: () => Date = () => new Date(),
): McpToolCallRecord[] {
  const records: McpToolCallRecord[] = [];
  for (const step of steps) {
    const resultById = new Map(step.toolResults.map((entry) => [entry.toolCallId, entry.output]));
    for (const call of step.toolCalls) {
      const origin = origins.get(call.toolName);
      const rawResult = resultById.get(call.toolCallId);
      records.push({
        serverLabel: origin?.serverLabel ?? "unknown",
        toolName: origin?.toolName ?? call.toolName,
        arguments: truncate(stringify(call.input), AUDIT_ARGUMENTS_MAX_CHARS),
        result: rawResult === undefined ? "" : truncate(stringify(rawResult), AUDIT_RESULT_MAX_CHARS),
        calledAt: now().toISOString(),
      });
    }
  }
  return records;
}

const stringify = (value: unknown): string => {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
};

interface AnthropicCacheMeta {
  cacheCreationInputTokens?: number | null;
}

// Cache reads come from usage in ai@5; Anthropic reports writes only in metadata.
const toTokenUsage = (
  usage: LanguageModelUsage,
  providerMetadata: ProviderMetadata | undefined,
): TokenUsage => {
  const anthropic = providerMetadata?.["anthropic"] as AnthropicCacheMeta | undefined;
  return {
    promptTokens: usage.inputTokens ?? 0,
    completionTokens: usage.outputTokens ?? 0,
    systemTokens: 0,
    cacheReadTokens: usage.cachedInputTokens ?? 0,
    cacheWriteTokens: anthropic?.cacheCreationInputTokens ?? 0,
  };
};
