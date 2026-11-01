import { describe, expect, it } from "vitest";
import { ok, type Approval, type FlowNode, type Session } from "@wayfinder/domain";
import { ListTriggerRuns } from "./list-trigger-runs";

const node = (id: string, type: FlowNode["type"]): FlowNode =>
  ({ id, flowId: "flow-1", type, name: id, config: {} }) as FlowNode;

const run = (overrides: Partial<Session>): Session =>
  ({
    id: "s",
    flowId: "flow-1",
    userId: "owner-1",
    status: "active",
    title: "Run",
    currentNodeId: "ai",
    runError: null,
    flowVersionId: null,
    createdAt: new Date("2026-10-22T01:00:00.000Z"),
    updatedAt: new Date("2026-10-22T01:05:00.000Z"),
    ...overrides,
  }) as Session;

const build = (sessions: Session[], pendingReviewSessionIds: string[] = []) =>
  new ListTriggerRuns({
    runs: {
      listByTriggerSource: async () => ok(sessions),
    },
    graph: {
      flowVersions: { getById: async () => ok(null) },
      flowNodes: { listByFlow: async () => ok([node("ai", "ai_task"), node("talk", "conversational")]) },
      flowEdges: { listByFlow: async () => ok([]) },
    },
    approvals: {
      findPendingByNode: async (sessionId: string) =>
        ok(pendingReviewSessionIds.includes(sessionId) ? ({ id: "a" } as Approval) : null),
    },
  });

describe("ListTriggerRuns", () => {
  it("lists a source's runs with a status worked out from each session", async () => {
    const useCase = build(
      [
        run({ id: "done", status: "complete" }),
        run({ id: "broken", runError: { incidentId: "i", nodeId: "ai", code: "x", message: "SMTP refused", at: "" } }),
        run({ id: "with-person", currentNodeId: "talk" }),
        run({ id: "in-review" }),
        run({ id: "busy" }),
      ],
      ["in-review"],
    );

    const result = await useCase.execute({ sourceId: "watch-1", limit: 50 });

    expect(result.data?.map((item) => [item.sessionId, item.status])).toEqual([
      ["done", "completed"],
      ["broken", "failed"],
      ["with-person", "waiting_on_person"],
      ["in-review", "waiting_on_person"],
      ["busy", "running"],
    ]);
    expect(result.data?.[1]).toMatchObject({ error: "SMTP refused", currentStepName: "ai" });
  });
});
