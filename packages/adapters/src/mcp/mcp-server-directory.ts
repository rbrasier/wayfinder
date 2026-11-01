import {
  err,
  isFlowUsableClassification,
  ok,
  type IMcpClient,
  type IMcpServerDirectory,
  type IMcpServerRepository,
  type IMcpToolRepository,
  type McpServer,
  type McpServerWithTools,
  type McpTool,
  type Result,
} from "@wayfinder/domain";

// Lists the servers flow authors may use, with their tools. Tools come from the
// `admin_mcp_tools` cache (ADR-062 §5); a server with nothing cached is listed
// live once and cached. A server that fails to respond is returned with no tools
// rather than failing the whole directory, so one broken integration never
// blocks the editor.
export class McpServerDirectory implements IMcpServerDirectory {
  constructor(
    private readonly servers: IMcpServerRepository,
    private readonly client: IMcpClient,
    private readonly tools: IMcpToolRepository,
  ) {}

  async listServersWithTools(): Promise<Result<McpServerWithTools[]>> {
    const serversResult = await this.servers.list();
    if (serversResult.error) return err(serversResult.error);

    const usable = serversResult.data.filter((server) => isFlowUsableClassification(server.dataClassification));
    const withTools: McpServerWithTools[] = [];
    for (const server of usable) {
      withTools.push({ server, tools: await this.toolsFor(server) });
    }
    return ok(withTools);
  }

  private async toolsFor(server: McpServer): Promise<McpTool[]> {
    const cached = await this.tools.listByServer(server.id);
    if (!cached.error && cached.data.length > 0) return cached.data;
    const listed = await this.client.listTools(server);
    if (listed.error) return [];
    await this.tools.replaceForServer(server.id, listed.data);
    return listed.data;
  }
}
