import type {
  IAuditLogger,
  ILogger,
  IMcpClient,
  McpCallOptions,
  McpServer,
  McpTool,
  McpToolCallOutput,
  Result,
} from "@wayfinder/domain";

// The audit row records what was sent to the source; past this it is cut, and
// the row says so, so a reviewer never mistakes a cut copy for the whole query.
const AUDIT_ARGUMENTS_MAX_CHARS = 8_000;

const serialiseArguments = (args: Record<string, unknown>): { text: string; truncated: boolean } => {
  const text = JSON.stringify(args) ?? "{}";
  if (text.length <= AUDIT_ARGUMENTS_MAX_CHARS) return { text, truncated: false };
  return { text: text.slice(0, AUDIT_ARGUMENTS_MAX_CHARS), truncated: true };
};

// Writes one `core_audit_log` row per MCP tool call, success or failure, for
// both the conversational pre-pass and the MCP node (ADR-062 §7). Wrapping the
// client, rather than auditing at each caller, is what guarantees no path can
// call a tool unrecorded.
export class AuditingMcpClient implements IMcpClient {
  constructor(
    private readonly inner: IMcpClient,
    private readonly auditLogger: IAuditLogger,
    private readonly logger: ILogger,
  ) {}

  listTools(server: McpServer): Promise<Result<McpTool[]>> {
    return this.inner.listTools(server);
  }

  async callTool(
    server: McpServer,
    toolName: string,
    args: Record<string, unknown>,
    options?: McpCallOptions,
  ): Promise<Result<McpToolCallOutput>> {
    const startedAt = Date.now();
    const result = await this.inner.callTool(server, toolName, args, options);
    await this.record(server, toolName, args, options, result, Date.now() - startedAt);
    return result;
  }

  // The call has already happened by now, so a failed audit write is logged and
  // swallowed — failing the call would not un-send the query.
  private async record(
    server: McpServer,
    toolName: string,
    args: Record<string, unknown>,
    options: McpCallOptions | undefined,
    result: Result<McpToolCallOutput>,
    durationMs: number,
  ): Promise<void> {
    const context = options?.context;
    const sent = serialiseArguments(args);
    const logged = await this.auditLogger.log({
      actorId: context?.actorId ?? null,
      action: "mcp.tool.called",
      resourceType: "mcp_server",
      resourceId: server.id,
      metadata: {
        toolName,
        path: context?.path ?? null,
        sessionId: context?.sessionId ?? null,
        flowId: context?.flowId ?? null,
        nodeId: context?.nodeId ?? null,
        arguments: sent.text,
        argumentsTruncated: sent.truncated,
        outcome: result.error ? "error" : "ok",
        errorMessage: result.error?.message ?? null,
        pagesFetched: result.data?.pagesFetched ?? 0,
        truncatedAtPageLimit: result.data?.truncatedAtPageLimit ?? false,
        resultChars: result.data?.output.length ?? 0,
        sourceStatus: result.data?.sourceStatus?.kind ?? null,
        durationMs,
      },
    });
    if (logged.error) {
      this.logger.error("Failed to audit an MCP tool call.", {
        serverId: server.id,
        toolName,
        reason: logged.error.message,
      });
    }
  }
}
