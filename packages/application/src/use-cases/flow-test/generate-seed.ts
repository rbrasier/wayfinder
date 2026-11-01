import {
  canUserEditFlow,
  domainError,
  emptySeed,
  err,
  nodeFieldSet,
  nodesPrecedingNode,
  ok,
  validateSeedAgainstNodes,
  type ConversationalNodeConfig,
  type FlowTestSeed,
  type IFlowEdgeRepository,
  type IFlowNodeRepository,
  type IFlowRepository,
  type ISeedProposer,
  type Result,
  type SeedProposalNode,
  type SeedReject,
} from "@wayfinder/domain";

export interface GenerateSeedInput {
  flowId: string;
  // The node about to be tested. Everything upstream of it is what needs
  // inventing.
  startNodeId: string;
  userId: string;
  isAdmin?: boolean;
}

export interface GeneratedSeed {
  seed: FlowTestSeed;
  rejects: SeedReject[];
  // Why nothing was generated, when the proposer failed. A generated seed is a
  // convenience, so a provider outage should leave the author with an empty seed
  // they can fill in by hand — not a dead end. Null on success.
  failureReason: string | null;
}

export class GenerateSeed {
  constructor(
    private readonly flows: IFlowRepository,
    private readonly flowNodes: IFlowNodeRepository,
    private readonly flowEdges: IFlowEdgeRepository,
    private readonly proposer: ISeedProposer,
  ) {}

  async execute(input: GenerateSeedInput): Promise<Result<GeneratedSeed>> {
    const flowResult = await this.flows.findById(input.flowId);
    if (flowResult.error) return flowResult;
    if (!flowResult.data) return err(domainError("NOT_FOUND", "Flow not found."));
    if (!canUserEditFlow(flowResult.data, input.userId, input.isAdmin ?? false)) {
      return err(domainError("FORBIDDEN", "You do not have permission to test this flow."));
    }

    const [nodesResult, edgesResult] = await Promise.all([
      this.flowNodes.listByFlow(input.flowId),
      this.flowEdges.listByFlow(input.flowId),
    ]);
    if (nodesResult.error) return nodesResult;
    if (edgesResult.error) return edgesResult;

    const precedingIds = new Set(nodesPrecedingNode(edgesResult.data, input.startNodeId));
    const proposalNodes: SeedProposalNode[] = nodesResult.data
      .filter((node) => precedingIds.has(node.id))
      .map((node) => {
        const config = node.config as unknown as ConversationalNodeConfig;
        return {
          nodeId: node.id,
          nodeName: node.name,
          aiInstruction: config.aiInstruction ?? "",
          fields: nodeFieldSet(config),
        };
      });

    if (proposalNodes.length === 0) {
      return ok({ seed: emptySeed(), rejects: [], failureReason: null });
    }

    const proposed = await this.proposer.propose({
      flowName: flowResult.data.name,
      nodes: proposalNodes,
    });
    if (proposed.error) {
      return ok({ seed: emptySeed(), rejects: [], failureReason: proposed.error.message });
    }

    // Validated before it is ever offered: a proposed value that breaks a field
    // constraint would make a sound step look broken, so it is reported as a
    // reject rather than quietly corrected.
    const { accepted, rejects } = validateSeedAgainstNodes(proposed.data, nodesResult.data);
    return ok({ seed: accepted, rejects, failureReason: null });
  }
}
