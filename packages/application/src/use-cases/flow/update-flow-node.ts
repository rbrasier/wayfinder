import {
  emailConfigsAfterRename,
  ok,
  type FlowNode,
  type FlowNodeUpdate,
  type IFlowNodeRepository,
  type Result,
} from "@wayfinder/domain";

export class UpdateFlowNode {
  constructor(private readonly nodes: IFlowNodeRepository) {}

  async execute(id: string, patch: FlowNodeUpdate): Promise<Result<FlowNode>> {
    const existing = await this.nodes.findById(id);
    if (existing.error) return existing;
    const previousName = existing.data?.name;

    const updated = await this.nodes.update(id, patch);
    if (updated.error) return updated;
    if (patch.name === undefined || previousName === undefined || patch.name === previousName) return updated;

    const followed = await this.followRename(updated.data, previousName);
    if (followed.error) return followed;
    return updated;
  }

  // Email steps name earlier steps by a key derived from the step's name, so a
  // rename rewrites their tags to match (ADR-065 §4).
  private async followRename(renamed: FlowNode, previousName: string): Promise<Result<true>> {
    const flowNodes = await this.nodes.listByFlow(renamed.flowId);
    if (flowNodes.error) return flowNodes;
    const asBefore = flowNodes.data.map((node) =>
      node.id === renamed.id ? { ...node, name: previousName } : node,
    );
    for (const rewrite of emailConfigsAfterRename(asBefore, renamed.id, renamed.name)) {
      const saved = await this.nodes.update(rewrite.nodeId, { config: rewrite.config });
      if (saved.error) return saved;
    }
    return ok(true);
  }
}
