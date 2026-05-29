import {
  computeFieldReport,
  computeNodeBreakdown,
  ok,
  type AnalyticsNode,
  type FieldReport,
  type IAnalyticsRepository,
  type IFlowNodeRepository,
  type IFlowRepository,
  type ISessionStepOutputRepository,
  type NodeBreakdownRow,
  type Result,
} from "@rbrasier/domain";

export interface FlowDeepDiveCard {
  flowId: string;
  flowName: string;
  sessionCount: number;
}

export interface FlowDeepDive {
  flows: FlowDeepDiveCard[];
  selectedFlowId: string | null;
  nodeBreakdown: NodeBreakdownRow[];
  fieldReport: FieldReport;
}

export interface GetFlowDeepDiveInput {
  flowId?: string;
  now?: Date;
}

const emptyFieldReport: FieldReport = { fields: [], summaries: [], rows: [] };

export class GetFlowDeepDive {
  constructor(
    private readonly flows: IFlowRepository,
    private readonly flowNodes: IFlowNodeRepository,
    private readonly analytics: IAnalyticsRepository,
    private readonly stepOutputs: ISessionStepOutputRepository,
  ) {}

  async execute(input: GetFlowDeepDiveInput = {}): Promise<Result<FlowDeepDive>> {
    const now = input.now ?? new Date();

    const flowsResult = await this.flows.list();
    if (flowsResult.error) return flowsResult;

    const sessionsResult = await this.analytics.listSessions({ start: new Date(0), end: now });
    if (sessionsResult.error) return sessionsResult;

    const counts = new Map<string, number>();
    for (const session of sessionsResult.data) {
      counts.set(session.flowId, (counts.get(session.flowId) ?? 0) + 1);
    }

    const cards: FlowDeepDiveCard[] = flowsResult.data
      .map((flow) => ({
        flowId: flow.id,
        flowName: flow.name,
        sessionCount: counts.get(flow.id) ?? 0,
      }))
      .sort((a, b) => b.sessionCount - a.sessionCount);

    const selectedFlowId =
      input.flowId && cards.some((card) => card.flowId === input.flowId)
        ? input.flowId
        : (cards[0]?.flowId ?? null);

    if (!selectedFlowId) {
      return ok({ flows: cards, selectedFlowId: null, nodeBreakdown: [], fieldReport: emptyFieldReport });
    }

    const nodesResult = await this.flowNodes.listByFlow(selectedFlowId);
    if (nodesResult.error) return nodesResult;

    const messagesResult = await this.analytics.listMessagesByFlow(selectedFlowId);
    if (messagesResult.error) return messagesResult;

    const stepOutputsResult = await this.stepOutputs.listByFlow(selectedFlowId);
    if (stepOutputsResult.error) return stepOutputsResult;

    const nodes: AnalyticsNode[] = nodesResult.data.map((node) => ({
      id: node.id,
      name: node.name,
      colour: node.colour,
    }));

    const flowSessions = sessionsResult.data.filter((session) => session.flowId === selectedFlowId);

    return ok({
      flows: cards,
      selectedFlowId,
      nodeBreakdown: computeNodeBreakdown(nodes, messagesResult.data, flowSessions),
      fieldReport: computeFieldReport(
        stepOutputsResult.data.map((output) => ({
          sessionId: output.sessionId,
          nodeId: output.nodeId,
          createdAt: output.createdAt,
          fields: output.fields,
        })),
      ),
    });
  }
}
