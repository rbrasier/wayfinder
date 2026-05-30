import { describe, it, expect } from "vitest";
import { ok, err, domainError } from "@rbrasier/domain";
import type {
  AnalyticsMessageRow,
  AnalyticsSessionRow,
  AnalyticsTimeRange,
  Flow,
  FlowNode,
  IAnalyticsRepository,
  IFlowNodeRepository,
  IFlowRepository,
  ISessionStepOutputRepository,
  Result,
  SessionStepOutput,
} from "@rbrasier/domain";
import { GetOverviewDashboard } from "./get-overview-dashboard";
import { GetFlowDeepDive } from "./get-flow-deep-dive";

const now = new Date("2026-05-29T00:00:00Z");

const makeSession = (overrides: Partial<AnalyticsSessionRow>): AnalyticsSessionRow => ({
  id: "s1",
  flowId: "f1",
  flowName: "Flow One",
  status: "active",
  currentNodeId: null,
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
  async listSessionsByFlow(flowId: string): Promise<Result<AnalyticsSessionRow[]>> {
    return ok(this.sessions.filter((session) => session.flowId === flowId));
  }
  async listMessagesByFlow(): Promise<Result<AnalyticsMessageRow[]>> {
    return ok(this.messages);
  }
}

describe("GetOverviewDashboard", () => {
  it("assembles metrics, activity, distribution and confidence lifecycle", async () => {
    const analytics = new FakeAnalytics(
      [
        makeSession({ id: "a", createdAt: new Date("2026-05-23T00:00:00Z") }),
        makeSession({ id: "b", flowId: "f2", flowName: "Flow Two", createdAt: new Date("2026-05-24T00:00:00Z"), status: "complete", updatedAt: new Date("2026-05-25T00:00:00Z") }),
      ],
      [
        { sessionId: "a", stepNodeId: "n1", role: "assistant", confidence: 80, createdAt: new Date("2026-05-23T00:00:00Z") },
      ],
    );

    const useCase = new GetOverviewDashboard(analytics);
    const result = await useCase.execute({ periodDays: 30, now });

    expect(result.error).toBeUndefined();
    expect(result.data?.metrics.activeSessions.value).toBe(2);
    expect(result.data?.flowDistribution).toHaveLength(2);
    expect(result.data?.confidenceLifecycle).toHaveLength(10);
    expect(result.data?.activity.length).toBeGreaterThan(0);
  });

  it("propagates a repository error", async () => {
    const failing: IAnalyticsRepository = {
      listSessions: async () => err(domainError("INFRA_FAILURE", "boom")),
      listAssistantMessages: async () => ok([]),
      listSessionsByFlow: async () => ok([]),
      listMessagesByFlow: async () => ok([]),
    };
    const result = await new GetOverviewDashboard(failing).execute({ now });
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
    );

    const result = await useCase.execute({ now });

    expect(result.error).toBeUndefined();
    expect(result.data?.selectedFlowId).toBe("f2");
    expect(result.data?.flows[0]).toEqual({ flowId: "f2", flowName: "Two", sessionCount: 2 });
    expect(result.data?.nodeBreakdown[0]?.nodeName).toBe("Intake");
    expect(result.data?.fieldReport.columns[0]?.fieldKey).toBe("fee");
    expect(result.data?.fieldReport.columns[0]?.columnKey).toBe("n1:fee");
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
    );

    const result = await useCase.execute({ now });
    expect(result.data?.selectedFlowId).toBeNull();
    expect(result.data?.nodeBreakdown).toEqual([]);
  });
});
