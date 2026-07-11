import {
  err,
  ok,
  type IMcpClient,
  type IMcpServerDirectory,
  type IMcpServerRepository,
  type McpServerWithTools,
  type Result,
} from "@rbrasier/domain";

// Lists active servers with the tools they currently expose. A server that fails
// to respond is returned with an empty tool list rather than failing the whole
// directory, so one broken integration never blocks the editor.
export class McpServerDirectory implements IMcpServerDirectory {
  constructor(
    private readonly servers: IMcpServerRepository,
    private readonly client: IMcpClient,
  ) {}

  async listServersWithTools(): Promise<Result<McpServerWithTools[]>> {
    const serversResult = await this.servers.list();
    if (serversResult.error) return err(serversResult.error);

    // Flow authors only ever see internal servers (spellcheck, calculation);
    // externally-communicating integrations are registered but not offered here.
    const internalServers = serversResult.data.filter((server) => !server.communicatesExternally);

    const withTools: McpServerWithTools[] = [];
    for (const server of internalServers) {
      const toolsResult = await this.client.listTools(server);
      withTools.push({ server, tools: toolsResult.error ? [] : toolsResult.data });
    }
    return ok(withTools);
  }
}
