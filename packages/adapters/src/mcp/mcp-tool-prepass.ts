import {
  domainError,
  err,
  ok,
  type McpServer,
  type McpToolCallRecord,
  type ProviderName,
  type IUsageRepository,
  type Result,
} from "@rbrasier/domain";
import {
  experimental_createMCPClient,
  generateText,
  type LanguageModelV1,
  type ToolSet,
} from "ai";
import { buildMcpTransport } from "./ai-sdk-mcp-client";
import { recordTokenUsage } from "../observability/usage-tracking-adapter";
import type { QuotaEnforcer } from "../observability/quota-enforcing-adapter";

export interface McpToolPrepassInput {
  model: LanguageModelV1;
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
  ) {}

  async run(input: McpToolPrepassInput): Promise<Result<McpToolPrepassResult>> {
    // Quota is enforced outermost, before any tokens are spent — the same
    // ceiling the port applies to every other model call (ADR-026).
    const gate = await this.quotaEnforcer.check(input.userId);
    if (gate.error) return err(gate.error);

    const clients: Awaited<ReturnType<typeof experimental_createMCPClient>>[] = [];
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? DEFAULT_PREPASS_TIMEOUT_MS);
    try {
      let tools: ToolSet = {};
      const origins = new Map<string, ToolOrigin>();
      const takenKeys = new Set<string>();
      for (const server of input.servers) {
        const allowed = input.allowedToolNamesByServer[server.id] ?? [];
        if (allowed.length === 0) continue;
        const client = await experimental_createMCPClient({ transport: buildMcpTransport(server) });
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
        maxSteps: input.maxSteps ?? 4,
        abortSignal: controller.signal,
      });

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
        {
          promptTokens: result.usage.promptTokens,
          completionTokens: result.usage.completionTokens,
          systemTokens: 0,
          ...extractCacheTokens(result.providerMetadata as Record<string, unknown> | undefined),
        },
      );

      const toolCalls = extractToolCalls(result.steps, origins);
      return ok({ summary: result.text.trim(), toolCallCount: toolCalls.length, toolCalls });
    } catch (cause) {
      return err(domainError("AGENT_FAILED", "MCP tool pre-pass failed.", cause));
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
}

interface StepLike {
  toolCalls: { toolCallId: string; toolName: string; args: unknown }[];
  toolResults: { toolCallId: string; result: unknown }[];
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
    const resultById = new Map(step.toolResults.map((entry) => [entry.toolCallId, entry.result]));
    for (const call of step.toolCalls) {
      const origin = origins.get(call.toolName);
      const rawResult = resultById.get(call.toolCallId);
      records.push({
        serverLabel: origin?.serverLabel ?? "unknown",
        toolName: origin?.toolName ?? call.toolName,
        arguments: truncate(stringify(call.args), AUDIT_ARGUMENTS_MAX_CHARS),
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
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}

const extractCacheTokens = (
  providerMetadata: Record<string, unknown> | undefined,
): { cacheReadTokens: number; cacheWriteTokens: number } => {
  const anthropic = providerMetadata?.["anthropic"] as AnthropicCacheMeta | undefined;
  return {
    cacheReadTokens: anthropic?.cacheReadInputTokens ?? 0,
    cacheWriteTokens: anthropic?.cacheCreationInputTokens ?? 0,
  };
};
