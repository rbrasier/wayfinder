import {
  domainError,
  EMPTY_MCP_TOOL_SETTINGS,
  err,
  mcpToolDisplayTitle,
  ok,
  startToolProgress,
  type CachedMcpTool,
  type IMcpClient,
  type IMcpToolRepository,
  type IntervalScheduler,
  type IUsageRepository,
  type McpCallContext,
  type McpServer,
  type McpTool,
  type McpToolCallOutput,
  type McpToolCallRecord,
  type ProviderName,
  type Result,
  type SessionToolProgressEvent,
  type TokenUsage,
} from "@wayfinder/domain";
import {
  generateText,
  jsonSchema,
  stepCountIs,
  tool,
  type LanguageModel,
  type LanguageModelUsage,
  type ToolSet,
} from "ai";
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
  userId?: string | null;
  flowId?: string | null;
  sessionId?: string | null;
  nodeId?: string | null;
  // Usage-record label; defaults to the pre-pass purpose.
  purpose?: string;
  // Fires as each call starts, pages, heartbeats and ends (ADR-062 §4).
  onToolProgress?: (event: SessionToolProgressEvent) => void;
}

export interface McpToolPrepassResult {
  // Free-text summary of what the tools returned, for injection into the
  // structured turn's context.
  summary: string;
  toolCallCount: number;
  // Structured record of every call, kept on the turn for review and for later
  // turns to re-read.
  toolCalls: McpToolCallRecord[];
}

const DEFAULT_MAX_STEPS = 4;
// The whole pre-pass, every model step and tool call included, never holds the
// turn longer than this.
const PREPASS_MAX_BUDGET_MS = 120_000;
// The record keeps a tool's whole result up to this ceiling, and marks a cut
// past it — later turns re-read the record, so a silent cut here would be a
// silent cut in everything that follows (ADR-062 §7).
export const PREPASS_RESULT_MAX_CHARS = 200_000;
// Arguments are capped on the turn; the audit log keeps them at a larger cap.
const RECORD_ARGUMENTS_MAX_CHARS = 1_000;

const intervalScheduler: IntervalScheduler = {
  every: (intervalMs, run) => {
    const timer = setInterval(run, intervalMs);
    return () => clearInterval(timer);
  },
};

export const prepassBudgetMs = (servers: readonly McpServer[], maxSteps: number): number => {
  const slowest = Math.max(0, ...servers.map((server) => server.callTimeoutMs));
  return Math.min(maxSteps * slowest, PREPASS_MAX_BUDGET_MS);
};

// Deny-by-default tool selection.
export function selectAllowedTools<T extends Pick<McpTool, "name">>(listed: readonly T[], allowedNames: string[]): T[] {
  const allow = new Set(allowedNames);
  return listed.filter((entry) => allow.has(entry.name));
}

// Namespaced tool key. Two allowed servers can expose the same tool name; a flat
// name-keyed toolset silently shadows one with the other, so every tool is keyed
// by its server as well (refs are already (serverId, toolName)).
export function prefixToolName(serverLabel: string, toolName: string): string {
  const slug = serverLabel.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "server";
  return `${slug}__${toolName}`;
}

// Guards against two servers whose labels slug to the same prefix by suffixing a
// disambiguator, so no assembled key is ever overwritten.
function uniqueKey(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base}_${suffix}`)) suffix += 1;
  return `${base}_${suffix}`;
}

const capArguments = (args: Record<string, unknown>): string => {
  const text = JSON.stringify(args) ?? "{}";
  return text.length > RECORD_ARGUMENTS_MAX_CHARS ? `${text.slice(0, RECORD_ARGUMENTS_MAX_CHARS)}… [truncated]` : text;
};

const failureText = (message: string): string => `The tool call failed: ${message}`;

export interface CallOrigin {
  serverId: string;
  serverLabel: string;
  toolName: string;
}

export const buildCallRecord = (
  origin: CallOrigin,
  args: Record<string, unknown>,
  result: Result<McpToolCallOutput>,
  now: () => Date = () => new Date(),
): McpToolCallRecord => {
  const text = result.error ? failureText(result.error.message) : result.data.output;
  return {
    ...origin,
    arguments: capArguments(args),
    result: text.slice(0, PREPASS_RESULT_MAX_CHARS),
    truncated: text.length > PREPASS_RESULT_MAX_CHARS,
    calledAt: now().toISOString(),
    pagesFetched: result.data?.pagesFetched ?? 0,
    sourceStatus: result.data?.sourceStatus ?? null,
    citations: result.data?.citations ?? [],
  };
};

export interface BuildPrepassToolsInput {
  servers: readonly McpServer[];
  toolsByServer: ReadonlyMap<string, readonly CachedMcpTool[]>;
  allowedToolNamesByServer: Record<string, string[]>;
  client: IMcpClient;
  context: McpCallContext;
  onToolProgress?: (event: SessionToolProgressEvent) => void;
  scheduler?: IntervalScheduler;
  now?: () => Date;
}

// Builds the model's toolset from the cached tool schemas. Every `execute` goes
// through the (audited) MCP client with the tool's own settings, so pagination,
// status mapping and citations apply here exactly as they do to an MCP node.
export const buildPrepassTools = (input: BuildPrepassToolsInput): { tools: ToolSet; records: McpToolCallRecord[] } => {
  const tools: ToolSet = {};
  const records: McpToolCallRecord[] = [];
  const takenKeys = new Set<string>();
  const now = input.now ?? (() => new Date());

  for (const server of input.servers) {
    const allowed = input.allowedToolNamesByServer[server.id] ?? [];
    const listed = input.toolsByServer.get(server.id) ?? [];
    for (const cachedTool of selectAllowedTools(listed, allowed)) {
      const key = uniqueKey(prefixToolName(server.label, cachedTool.name), takenKeys);
      takenKeys.add(key);
      const origin = { serverId: server.id, serverLabel: server.label, toolName: cachedTool.name };
      tools[key] = tool({
        description: cachedTool.description ?? mcpToolDisplayTitle(cachedTool),
        inputSchema: jsonSchema<Record<string, unknown>>(
          (cachedTool.inputSchema ?? { type: "object", properties: {} }) as Parameters<typeof jsonSchema>[0],
        ),
        execute: async (args: Record<string, unknown>, options: { toolCallId: string }) => {
          const progress = startToolProgress({
            callId: options.toolCallId,
            toolTitle: mcpToolDisplayTitle(cachedTool),
            serverLabel: server.label,
            now: () => now().getTime(),
            scheduler: input.scheduler ?? intervalScheduler,
            emit: (event) => input.onToolProgress?.(event),
          });
          const result = await input.client.callTool(server, cachedTool.name, args, {
            settings: {
              pagination: cachedTool.pagination,
              status: cachedTool.status,
              citation: cachedTool.citation,
            },
            context: input.context,
            onPage: progress.page,
          });
          progress.stop();
          records.push(buildCallRecord(origin, args, result, now));
          return result.error ? failureText(result.error.message) : result.data.output;
        },
      });
    }
  }
  return { tools, records };
};

const asCachedTools = (serverId: string, listed: McpTool[]): CachedMcpTool[] =>
  listed.map((entry) => ({ ...entry, ...EMPTY_MCP_TOOL_SETTINGS, serverId, lastSyncedAt: new Date() }));

// The conversational tool-loop, run as a non-streaming pre-pass. It lets the
// model call the step's allowed MCP tools, then returns the gathered text for
// the caller to fold into the structured turn's context — leaving the streaming
// structured turn untouched. Runs through the governance building blocks the port
// decorators use for direct-SDK calls: the quota check short-circuits a blocked
// user before any spend, and token usage is recorded so the tokens are tracked
// and count against caps.
export class McpToolPrepass {
  constructor(
    private readonly usageRepo: IUsageRepository,
    private readonly quotaEnforcer: QuotaEnforcer,
    private readonly client: IMcpClient,
    private readonly toolCache: IMcpToolRepository,
  ) {}

  async run(input: McpToolPrepassInput): Promise<Result<McpToolPrepassResult>> {
    // Quota is enforced outermost, before any tokens are spent — the same
    // ceiling the port applies to every other model call (ADR-026).
    const gate = await this.quotaEnforcer.check(input.userId);
    if (gate.error) return err(gate.error);

    const maxSteps = input.maxSteps ?? DEFAULT_MAX_STEPS;
    const usedServers = input.servers.filter((server) => (input.allowedToolNamesByServer[server.id] ?? []).length > 0);
    const toolsByServer = new Map<string, CachedMcpTool[]>();
    for (const server of usedServers) toolsByServer.set(server.id, await this.toolsFor(server));

    const built = buildPrepassTools({
      servers: usedServers,
      toolsByServer,
      allowedToolNamesByServer: input.allowedToolNamesByServer,
      client: this.client,
      context: {
        actorId: input.userId ?? null,
        sessionId: input.sessionId ?? null,
        flowId: input.flowId ?? null,
        nodeId: input.nodeId ?? null,
        path: "prepass",
      },
      onToolProgress: input.onToolProgress,
    });
    if (Object.keys(built.tools).length === 0) {
      return ok({ summary: "", toolCallCount: 0, toolCalls: [] });
    }

    // Summed as each round finishes, so a loop cut off by the deadline still
    // bills the rounds that ran and hands over the results they fetched.
    const completedRoundUsage = { promptTokens: 0, completionTokens: 0 };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), prepassBudgetMs(usedServers, maxSteps));
    try {
      const result = await generateText({
        model: input.model,
        system: input.system,
        messages: input.messages,
        tools: built.tools,
        stopWhen: stepCountIs(maxSteps),
        abortSignal: controller.signal,
        onStepFinish: (step) => {
          completedRoundUsage.promptTokens += step.usage?.inputTokens ?? 0;
          completedRoundUsage.completionTokens += step.usage?.outputTokens ?? 0;
        },
      });

      // `totalUsage`, not `usage`: ai@5 reports only the final step under `usage`,
      // which would bill a multi-step tool loop as a single call.
      this.recordUsage(input, toTokenUsage(result.totalUsage, result.providerMetadata));

      return ok({ summary: result.text.trim(), toolCallCount: built.records.length, toolCalls: built.records });
    } catch (cause) {
      const partialCalls = controller.signal.aborted ? [...built.records] : [];
      if (partialCalls.length === 0) {
        return err(domainError("AGENT_FAILED", "MCP tool pre-pass failed.", cause));
      }
      this.recordUsage(input, { ...completedRoundUsage, systemTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
      return ok({ summary: "", toolCallCount: partialCalls.length, toolCalls: partialCalls });
    } finally {
      clearTimeout(timeout);
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

  // The cache answers first; an empty cache falls back to a live listing, which
  // is then cached so the next turn does not list again.
  private async toolsFor(server: McpServer): Promise<CachedMcpTool[]> {
    const cached = await this.toolCache.listByServer(server.id);
    if (!cached.error && cached.data.length > 0) return cached.data;
    const listed = await this.client.listTools(server);
    if (listed.error) return [];
    const stored = await this.toolCache.replaceForServer(server.id, listed.data);
    return stored.error ? asCachedTools(server.id, listed.data) : stored.data;
  }
}

interface AnthropicCacheMeta {
  cacheCreationInputTokens?: number | null;
}

// Cache reads come from usage in ai@5; Anthropic reports writes only in metadata.
const toTokenUsage = (
  usage: LanguageModelUsage,
  providerMetadata: Record<string, unknown> | undefined,
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
