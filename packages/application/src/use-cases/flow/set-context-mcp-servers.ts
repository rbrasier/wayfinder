import { err, type Flow, type IFlowRepository, type IMcpServerRepository, type Result } from "@rbrasier/domain";

// Replaces a flow's flow-wide `context` MCP server allow-list (ADR-032). Only
// active, `context`-kind servers are kept — an id for a missing, disabled, or
// `actions` server is dropped so a stale or mis-typed reference can never attach
// a write-capable server as ambient read-only context.
export class SetFlowContextMcpServers {
  constructor(
    private readonly flows: IFlowRepository,
    private readonly mcpServers: IMcpServerRepository,
  ) {}

  async execute(flowId: string, serverIds: string[]): Promise<Result<Flow>> {
    const serversResult = await this.mcpServers.list();
    if (serversResult.error) return err(serversResult.error);

    const contextServerIds = new Set(
      serversResult.data
        .filter((server) => server.status === "active" && server.kind === "context")
        .map((server) => server.id),
    );
    const valid = serverIds.filter((id) => contextServerIds.has(id));
    return this.flows.setContextMcpServers(flowId, valid);
  }
}
