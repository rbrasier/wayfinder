import { domainError, err, ok, type McpServer, type Result } from "@rbrasier/domain";
import {
  experimental_createMCPClient,
  generateText,
  type LanguageModelV1,
  type ToolSet,
} from "ai";
import { selectAllowedTools, transportFor } from "./mcp-tool-prepass";

export interface McpToolPlannerInput {
  model: LanguageModelV1;
  // Guides which tool to choose and how to fill its arguments.
  system: string;
  // The conversation so far, already trimmed by the caller.
  messages: { role: "user" | "assistant"; content: string }[];
  server: McpServer;
  // Allowed tool names for the server (deny-by-default — anything not listed is
  // never offered to the model).
  allowedToolNames: string[];
  userId?: string | null;
}

// A single proposed write-action tool call. `null` means the model declined to
// call any tool (nothing to do this run).
export type ProposedToolCall = { toolName: string; args: Record<string, unknown> } | null;

// Picks the model's first proposed tool call from a generateText result's
// toolCalls. Exported so the propose-only rule is unit-testable without a live
// MCP server (mirrors selectAllowedTools).
export function firstProposedCall(
  toolCalls: readonly { toolName: string; args: unknown }[],
): ProposedToolCall {
  const first = toolCalls[0];
  if (!first) return null;
  return {
    toolName: first.toolName,
    args: (first.args ?? {}) as Record<string, unknown>,
  };
}

// The write-action planner (ADR-032, Phase B). Connects to the server, assembles
// the allow-listed tools with their execute stripped, then asks the model to choose
// exactly one tool and generate its arguments from the tool's input schema. Because
// the tools have no execute, generateText returns the proposed call instead of
// running it — the operator confirms (and may edit) before ConfirmMcpNode calls it.
export class McpToolPlanner {
  async plan(input: McpToolPlannerInput): Promise<Result<ProposedToolCall>> {
    if (input.allowedToolNames.length === 0) {
      return err(domainError("VALIDATION_FAILED", "The MCP node has no tools to choose from."));
    }

    let client: Awaited<ReturnType<typeof experimental_createMCPClient>> | null = null;
    try {
      client = await experimental_createMCPClient({ transport: transportFor(input.server) });
      const serverTools = (await client.tools()) as ToolSet;
      const allowed = selectAllowedTools(serverTools, input.allowedToolNames);

      // Strip execute so the model proposes a call rather than running it.
      const proposeOnly: ToolSet = {};
      for (const [name, tool] of Object.entries(allowed)) {
        proposeOnly[name] = { ...tool, execute: undefined };
      }

      if (Object.keys(proposeOnly).length === 0) {
        return err(domainError("NOT_FOUND", "None of the allowed tools are exposed by the server."));
      }

      const result = await generateText({
        model: input.model,
        system: input.system,
        messages: input.messages,
        tools: proposeOnly,
        maxSteps: 1,
      });

      return ok(firstProposedCall(result.toolCalls));
    } catch (cause) {
      return err(domainError("AGENT_FAILED", "MCP tool planning failed.", cause));
    } finally {
      if (client) {
        try {
          await client.close();
        } catch {
          // best-effort close
        }
      }
    }
  }
}
