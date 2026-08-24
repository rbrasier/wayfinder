import { describe, it, expect } from "vitest";
import { ok, err, domainError } from "@rbrasier/domain";
import type {
  AnalyticsMessageRow,
  AnalyticsSessionRow,
  AnalyticsTimeRange,
  Flow,
  FlowNode,
  FlowEdge,
  IAnalyticsRepository,
  IFlowEdgeRepository,
  IFlowNodeRepository,
  IFlowRepository,
  ISessionStepOutputRepository,
  IUsageRepository,
  Result,
  SessionStepOutput,
} from "@rbrasier/domain";
import { GetValueDashboard } from "./get-value-dashboard";
import { GetFlowDeepDive } from "./get-flow-deep-dive";

const now = new Date("2026-05-29T00:00:00Z");

const makeSession = (overrides: Partial<AnalyticsSessionRow>): AnalyticsSessionRow => ({
  id: "s1",
  flowId: "f1",
  flowName: "Flow One",
  status: "active",
  currentNodeId: null,
  manualEstimateMinutes: null,
  createdAt: new Date("2026-05-20T00:00:00Z"),
  updatedAt: new Date("2026-05-20T00:00:00Z"),
  ...overrides,
});

class FakeAnalytics implements IAnalyticsRepository {
  constructor(
    private readonly sessions: AnalyticsSessionRow[],
    private readonly messages: AnalyticsMessageRow[] = [],
  ) {}
  async listSessions(range: AnalyticsTimeRange): Promise<Result<AnalyticsSessionRow[]>> {
    return ok(
      this.sessions.filter(
        (session) =>
          session.createdAt.getTime() >= range.start.getTime() &&
          session.createdAt.getTime() <= range.end.getTime(),
      ),
    );
  }
  async listAssistantMessages(): Promise<Result<AnalyticsMessageRow[]>> {
    return ok(this.messages);
  }
  async listAllMessages(): Promise<Result<AnalyticsMessageRow[]>> {
    return ok(this.messages);
  }
  async listSessionsByFlow(flowId: string): Promise<Result<AnalyticsSessionRow[]>> {
    return ok(this.sessions.filter((session) => session.flowId === flowId));
  }
  async listMessagesByFlow(): Promise<Result<AnalyticsMessageRow[]>> {
    return ok(this.messages);
  }
}

const fakeUsage = (rows: { key: string | null; totalCostUsd: number }[] = []): IUsageRepository =>
  ({
    summarizeBy: async () =>
      ok(rows.map((row) => ({ dimension: "flow" as const, ...row, eventCount: 1 }))),
  }) as unknown as IUsageRepository;

describe("GetValueDashboard", () => {
  const estimated = (id: string, flowId: string, flowName: string, minutes: number | null) =>
    makeSession({
      id,
      flowId,
      flowName,
      status: "complete",
      manualEstimateMinutes: minutes,
      createdAt: new Date("2026-05-23T00:00:00Z"),
      updatedAt: new Date("2026-05-24T00:00:00Z"),
    });

  it("reports effort avoided in hours, with coverage and spend beside it", async () => {
    const analytics = new FakeAnalytics(
      [estimated("a", "f1", "Flow One", 600), estimated("b", "f1", "Flow One", 600)],
      [
        { sessionId: "a", stepNodeId: "n1", role: "user", confidence: null, createdAt: new Date("2026-05-23T00:00:00Z") },
        { sessionId: "b", stepNodeId: "n1", role: "user", confidence: null, createdAt: new Date("2026-05-23T00:00:00Z") },
      ],
    );

    const result = await new GetValueDashboard(
      analytics,
      fakeUsage([{ key: "f1", totalCostUsd: 12.5 }]),
    ).execute({ periodDays: 30, now });

    expect(result.error).toBeUndefined();
    expect(result.data?.avoidedHours).toBeGreaterThan(0);
    expect(result.data?.coveragePct).toBe(100);
    expect(result.data?.spendUsd).toBe(12.5);
    expect(result.data?.byFlow).toHaveLength(1);
  });

  it("never converts hours into money — spend stays a separate figure", async () => {
    const analytics = new FakeAnalytics([estimated("a", "f1", "Flow One", 600)], []);

    const result = await new GetValueDashboard(
      analytics,
      fakeUsage([{ key: "f1", totalCostUsd: 9.99 }]),
    ).execute({ periodDays: 30, now });

    // The two live side by side and are never combined into one number.
    expect(result.data?.avoidedHours).toBe(10);
    expect(result.data?.spendUsd).toBe(9.99);
  });

  it("scopes every figure to one flow when a flowId is supplied", async () => {
    const analytics = new FakeAnalytics(
      [estimated("a", "f1", "Flow One", 600), estimated("b", "f2", "Flow Two", 1200)],
      [],
    );

    const result = await new GetValueDashboard(analytics, fakeUsage()).execute({
      periodDays: 30,
      flowId: "f2",
      now,
    });

    expect(result.data?.flowId).toBe("f2");
    expect(result.data?.byFlow).toHaveLength(1);
    expect(result.data?.byFlow[0]?.flowId).toBe("f2");
    expect(result.data?.contributingSessions).toBe(1);
  });

  it("reports a flow with no estimates as having no baseline rather than zero saving", async () => {
    const analytics = new FakeAnalytics([estimated("a", "f1", "Flow One", null)], []);

    const result = await new GetValueDashboard(analytics, fakeUsage()).execute({ now });

    expect(result.data?.byFlow[0]?.baselineMinutes).toBeNull();
    expect(result.data?.byFlow[0]?.avoidedMinutes).toBeNull();
    expect(result.data?.coveragePct).toBe(0);
  });

  it("propagates a repository error", async () => {
    const failing: IAnalyticsRepository = {
      listSessions: async () => err(domainError("INFRA_FAILURE", "boom")),
      listAssistantMessages: async () => ok([]),
      listAllMessages: async () => ok([]),
      listSessionsByFlow: async () => ok([]),
      listMessagesByFlow: async () => ok([]),
    };
    const result = await new GetValueDashboard(failing, fakeUsage()).execute({ now });
    expect(result.error?.code).toBe("INFRA_FAILURE");
  });
});

const makeFlows = (flows: Pick<Flow, "id" | "name">[]): IFlowRepository =>
  ({
    list: async () => ok(flows as Flow[]),
  }) as unknown as IFlowRepository;

const makeFlowNodes = (nodes: FlowNode[]): IFlowNodeRepository =>
  ({
    listByFlow: async () => ok(nodes),
  }) as unknown as IFlowNodeRepository;

const makeStepOutputs = (outputs: SessionStepOutput[]): ISessionStepOutputRepository => ({
  create: async () => err(domainError("INFRA_FAILURE", "unused")),
  listByFlow: async () => ok(outputs),
});

const edge = (fromNodeId: string, toNodeId: string): FlowEdge => ({
  id: `${fromNodeId}-${toNodeId}`,
  flowId: "f1",
  fromNodeId,
  toNodeId,
  createdAt: new Date(),
  updatedAt: new Date(),
});

const makeFlowEdges = (
  edges: FlowEdge[],
  spy?: (flowId: string) => void,
): IFlowEdgeRepository =>
  ({
    listByFlow: async (flowId: string) => {
      spy?.(flowId);
      return ok(edges);
    },
  }) as unknown as IFlowEdgeRepository;

const node = (id: string, name: string): FlowNode => ({
  id,
  flowId: "f1",
  type: "conversational",
  name,
  colour: null,
  positionX: 0,
  positionY: 0,
  config: {},
  createdAt: new Date(),
  updatedAt: new Date(),
});

describe("GetFlowDeepDive", () => {
  it("selects the highest-use flow by default and builds breakdown + field report", async () => {
    const analytics = new FakeAnalytics([
      makeSession({ id: "s1", flowId: "f2" }),
      makeSession({ id: "s2", flowId: "f2" }),
      makeSession({ id: "s3", flowId: "f1" }),
    ]);
    const stepOutputs = makeStepOutputs([
      {
        id: "o1",
        sessionId: "s1",
        flowId: "f2",
        nodeId: "n1",
        messageId: "m1",
        fields: [{ key: "fee", label: "Fee", type: "currency", value: "$100.00" }],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const useCase = new GetFlowDeepDive(
      makeFlows([{ id: "f1", name: "One" }, { id: "f2", name: "Two" }]),
      makeFlowNodes([node("n1", "Intake")]),
      analytics,
      stepOutputs,
      makeFlowEdges([]),
    );

    const result = await useCase.execute({ now });

    expect(result.error).toBeUndefined();
    expect(result.data?.selectedFlowId).toBe("f2");
    expect(result.data?.flows[0]).toEqual({ flowId: "f2", flowName: "Two", sessionCount: 2 });
    expect(result.data?.stepFunnel[0]?.nodeName).toBe("Intake");
    expect(result.data?.fieldReport.columns[0]?.fieldKey).toBe("fee");
    expect(result.data?.fieldReport.columns[0]?.columnKey).toBe("n1:fee");
  });

  it("loads edges for the selected flow and collapses fork-sibling columns", () => {
    return (async () => {
      const loadedFlowIds: string[] = [];
      const analytics = new FakeAnalytics([
        makeSession({ id: "s1", flowId: "f1" }),
        makeSession({ id: "s2", flowId: "f1" }),
      ]);
      const stepOutputs = makeStepOutputs([
        {
          id: "o1",
          sessionId: "s1",
          flowId: "f1",
          nodeId: "n1",
          messageId: "m1",
          fields: [{ key: "amount", label: "Amount", type: "currency", value: "$10.00" }],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "o2",
          sessionId: "s2",
          flowId: "f1",
          nodeId: "n2",
          messageId: "m2",
          fields: [{ key: "amount", label: "Amount", type: "currency", value: "$20.00" }],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const useCase = new GetFlowDeepDive(
        makeFlows([{ id: "f1", name: "One" }]),
        makeFlowNodes([node("n1", "Standard"), node("n2", "Approval")]),
        analytics,
        stepOutputs,
        makeFlowEdges(
          [edge("n0", "n1"), edge("n0", "n2"), edge("n1", "n3"), edge("n2", "n3")],
          (flowId) => loadedFlowIds.push(flowId),
        ),
      );

      const result = await useCase.execute({ now });

      expect(loadedFlowIds).toEqual(["f1"]);
      const columns = result.data?.fieldReport.columns ?? [];
      const groupIds = columns.map((column) => column.collapseGroupId);
      expect(groupIds.every((id) => id === "amount::n1+n2")).toBe(true);
    })();
  });

  it("returns correct sessionSummary counts", async () => {
    const analytics = new FakeAnalytics([
      makeSession({ id: "s1", flowId: "f1", status: "complete" }),
      makeSession({ id: "s2", flowId: "f1", status: "active" }),
      makeSession({ id: "s3", flowId: "f1", status: "abandoned" }),
    ]);
    const useCase = new GetFlowDeepDive(
      makeFlows([{ id: "f1", name: "One" }]),
      makeFlowNodes([]),
      analytics,
      makeStepOutputs([]),
      makeFlowEdges([]),
    );

    const result = await useCase.execute({ now });

    expect(result.data?.sessionSummary).toEqual({
      total: 3,
      completed: 1,
      active: 1,
      abandoned: 1,
    });
  });

  it("honours an explicit flow selection", async () => {
    const analytics = new FakeAnalytics([makeSession({ id: "s1", flowId: "f2" })]);
    const useCase = new GetFlowDeepDive(
      makeFlows([{ id: "f1", name: "One" }, { id: "f2", name: "Two" }]),
      makeFlowNodes([]),
      analytics,
      makeStepOutputs([]),
      makeFlowEdges([]),
    );

    const result = await useCase.execute({ flowId: "f1", now });
    expect(result.data?.selectedFlowId).toBe("f1");
  });

  it("returns an empty deep dive when there are no flows", async () => {
    const useCase = new GetFlowDeepDive(
      makeFlows([]),
      makeFlowNodes([]),
      new FakeAnalytics([]),
      makeStepOutputs([]),
      makeFlowEdges([]),
    );

    const result = await useCase.execute({ now });
    expect(result.data?.selectedFlowId).toBeNull();
    expect(result.data?.stepFunnel).toEqual([]);
  });
});
