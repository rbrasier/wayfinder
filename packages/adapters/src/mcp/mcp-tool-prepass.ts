import {
  domainError,
  err,
  ok,
  type McpServer,
  type McpToolRef,
  type Result,
} from "@rbrasier/domain";
import {
  experimental_createMCPClient,
  generateText,
  type LanguageModelV1,
  type ToolSet,
} from "ai";

export interface McpToolPrepassInput {
  model: LanguageModelV1;
  system: string;
  // The conversation so far, already trimmed by the caller.
  messages: { role: "user" | "assistant"; content: string }[];
  servers: McpServer[];
  // Allowed tool names per server id (deny-by-default — anything not listed is
  // never assembled into the toolset).
  allowedToolNamesByServer: Record<string, string[]>;
  maxSteps?: number;
  userId?: string | null;
}

export interface McpToolPrepassResult {
  // Free-text summary of what the tools returned, for injection into the
  // structured turn's context.
  summary: string;
  toolCallCount: number;
}

// Keeps only the tools whose names are in the allow-list. Exported for unit
// testing the deny-by-default rule without a live server (ADR-032 testing notes).
export function selectAllowedTools(allTools: ToolSet, allowedNames: string[]): ToolSet {
  const allow = new Set(allowedNames);
  const selected: ToolSet = {};
  for (const [name, tool] of Object.entries(allTools)) {
    if (allow.has(name)) selected[name] = tool;
  }
  return selected;
}

// The conversational tool-loop, run as a non-streaming pre-pass (ADR-032). It lets
// the model call the step's allowed MCP tools, then returns the gathered text for
// the caller to fold into the structured turn's context — leaving the streaming
// structured turn untouched. Live behaviour is a staging smoke test; the tool
// selection above is unit-tested.
export class McpToolPrepass {
  async run(input: McpToolPrepassInput): Promise<Result<McpToolPrepassResult>> {
    const clients: Awaited<ReturnType<typeof experimental_createMCPClient>>[] = [];
    try {
      let tools: ToolSet = {};
      for (const server of input.servers) {
        const allowed = input.allowedToolNamesByServer[server.id] ?? [];
        if (allowed.length === 0) continue;
        const client = await experimental_createMCPClient({ transport: transportFor(server) });
        clients.push(client);
        const serverTools = (await client.tools()) as ToolSet;
        tools = { ...tools, ...selectAllowedTools(serverTools, allowed) };
      }

      if (Object.keys(tools).length === 0) {
        return ok({ summary: "", toolCallCount: 0 });
      }

      const result = await generateText({
        model: input.model,
        system: input.system,
        messages: input.messages,
        tools,
        maxSteps: input.maxSteps ?? 4,
      });

      const toolCallCount = result.steps.reduce((total, step) => total + step.toolCalls.length, 0);
      return ok({ summary: result.text.trim(), toolCallCount });
    } catch (cause) {
      return err(domainError("AGENT_FAILED", "MCP tool pre-pass failed.", cause));
    } finally {
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

export function transportFor(server: McpServer): { type: "sse"; url: string; headers?: Record<string, string> } {
  const headers: Record<string, string> = {};
  if (server.credentialRef) {
    const token = process.env[server.credentialRef];
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  return { type: "sse", url: server.url, headers };
}
