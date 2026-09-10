import { describe, expect, it } from "vitest";
import { ok, type Approval, type FlowNode, type Result, type Session, type SessionParticipant, type User } from "@wayfinder/domain";
import { ResolveDecisionNotifyTargets } from "./resolve-decision-notify-targets";

const user = (id: string, name: string): User =>
  ({
    id,
    email: `${id}@corp.test`,
    name,
    role: null,
    team: null,
    organisationId: null,
    isAdmin: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  }) as unknown as User;

const session = (overrides: Partial<Session> = {}): Session =>
  ({
    id: "session-1",
    flowId: "flow-1",
    // Olivia raised the chat. She is the originator, whatever else happens.
    userId: "olivia",
    status: "active",
    title: "New starter",
    currentNodeId: null,
    graphCheckpoint: null,
    pendingExecutions: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as Session;

const approval = (overrides: Partial<Approval> = {}): Approval =>
  ({
    id: "appr-2",
    sessionId: "session-1",
    flowId: "flow-1",
    nodeId: "node-appr-b",
    messageId: null,
    // The second approval of a chain is raised by the *first approver* from
    // their own decision modal — this is exactly the column the modal used to
    // read as "the originator".
    requestedByUserId: "ada",
    approverSource: "first_level_supervisor",
    suggestedApproverUserId: null,
    approverUserId: "bruno",
    approverEmail: null,
    isOverride: false,
    status: "approved",
    decidedByUserId: "bruno",
    decidedAt: new Date(),
    comment: null,
    recordSnapshot: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as Approval;

const participant = (userId: string, role: SessionParticipant["role"]): SessionParticipant =>
  ({
    id: `part-${userId}`,
    sessionId: "session-1",
    userId,
    role,
    joinedAt: new Date(),
    invitedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }) as SessionParticipant;

const build = (parts: {
  session?: Session;
  participants?: SessionParticipant[];
  users?: User[];
  nodes?: FlowNode[];
  approvals?: Approval[];
}) => {
  const users = parts.users ?? [
    user("olivia", "Olivia Operator"),
    user("ada", "Ada Lovelace"),
    user("bruno", "Bruno Approver"),
    user("cleo", "Cleo Collaborator"),
  ];
  return new ResolveDecisionNotifyTargets(
    { findById: async (id: string) => ok(id === "session-1" ? parts.session ?? session() : null) } as never,
    { listBySession: async () => ok(parts.participants ?? []) } as never,
    {
      findById: async (id: string): Promise<Result<User | null>> =>
        ok(users.find((candidate) => candidate.id === id) ?? null),
    } as never,
    {
      findById: async (id: string): Promise<Result<FlowNode | null>> =>
        ok(parts.nodes?.find((node) => node.id === id) ?? null),
    } as never,
    { listBySession: async () => ok(parts.approvals ?? []) } as never,
  );
};

const approvalNode = (id: string): FlowNode =>
  ({ id, flowId: "flow-1", type: "approval", name: "Finance review", config: {} }) as unknown as FlowNode;

describe("ResolveDecisionNotifyTargets", () => {
  // The reported defect: the modal named Ada Lovelace, who was the *first
  // approver* and had already signed, because `requestedByUserId` is whoever
  // raised the request — and a chained approval is raised by the approver
  // before it, not by the originator.
  it("never names the previous approver just because they raised the request", async () => {
    const sut = build({
      session: session({ status: "complete" }),
      participants: [participant("cleo", "collaborator")],
    });

    const result = await sut.execute({
      approval: approval(),
      newNodeId: null,
      sessionCompleted: true,
      decidedByUserId: "bruno",
    });

    const ids = result.data!.map((target) => target.userId);
    expect(ids).not.toContain("ada");
    expect(ids).toContain("olivia");
  });

  it("names the next approver when the decision advanced onto another approval", async () => {
    const sut = build({
      nodes: [approvalNode("node-appr-c")],
      approvals: [
        approval({
          id: "appr-3",
          nodeId: "node-appr-c",
          status: "pending",
          approverUserId: "cleo",
          decidedByUserId: null,
          decidedAt: null,
        }),
      ],
    });

    const result = await sut.execute({
      approval: approval(),
      newNodeId: "node-appr-c",
      sessionCompleted: false,
      decidedByUserId: "bruno",
    });

    expect(result.data).toEqual([
      { userId: "cleo", name: "Cleo Collaborator", email: "cleo@corp.test", reason: "next_approver" },
    ]);
  });

  it("names an email-only next approver who has no account yet", async () => {
    const sut = build({
      nodes: [approvalNode("node-appr-c")],
      approvals: [
        approval({
          id: "appr-3",
          nodeId: "node-appr-c",
          status: "pending",
          approverUserId: null,
          approverEmail: "external@partner.test",
          decidedByUserId: null,
          decidedAt: null,
        }),
      ],
    });

    const result = await sut.execute({
      approval: approval(),
      newNodeId: "node-appr-c",
      sessionCompleted: false,
      decidedByUserId: "bruno",
    });

    expect(result.data).toEqual([
      { userId: null, name: null, email: "external@partner.test", reason: "next_approver" },
    ]);
  });

  it("names the participants who can act while the session is still running", async () => {
    const sut = build({
      participants: [participant("cleo", "collaborator"), participant("viv", "viewer")],
      users: [
        user("olivia", "Olivia Operator"),
        user("cleo", "Cleo Collaborator"),
        user("viv", "Viv Viewer"),
      ],
    });

    const result = await sut.execute({
      approval: approval(),
      newNodeId: "node-next",
      sessionCompleted: false,
      decidedByUserId: "bruno",
    });

    const ids = result.data!.map((target) => target.userId);
    expect(ids).toContain("olivia");
    expect(ids).toContain("cleo");
    // A viewer cannot pick the work back up, so telling someone to chase them
    // is telling them to chase the wrong person.
    expect(ids).not.toContain("viv");
  });

  it("includes viewers once the session is complete, because nobody is picking it up", async () => {
    const sut = build({
      session: session({ status: "complete" }),
      participants: [participant("viv", "viewer")],
      users: [user("olivia", "Olivia Operator"), user("viv", "Viv Viewer")],
    });

    const result = await sut.execute({
      approval: approval(),
      newNodeId: null,
      sessionCompleted: true,
      decidedByUserId: "bruno",
    });

    const ids = result.data!.map((target) => target.userId);
    expect(ids).toEqual(expect.arrayContaining(["olivia", "viv"]));
  });

  it("falls back to the originator when the session has no other participants", async () => {
    const sut = build({ participants: [] });

    const result = await sut.execute({
      approval: approval(),
      newNodeId: null,
      sessionCompleted: true,
      decidedByUserId: "bruno",
    });

    expect(result.data).toEqual([
      { userId: "olivia", name: "Olivia Operator", email: "olivia@corp.test", reason: "originator" },
    ]);
  });

  it("never tells the decider to notify themselves", async () => {
    // The approver is also the session owner: there is genuinely nobody else,
    // and an empty list is the honest answer.
    const sut = build({ session: session({ userId: "bruno" }), participants: [] });

    const result = await sut.execute({
      approval: approval(),
      newNodeId: null,
      sessionCompleted: true,
      decidedByUserId: "bruno",
    });

    expect(result.data).toEqual([]);
  });

  it("de-duplicates the owner appearing as a participant row too", async () => {
    const sut = build({ participants: [participant("olivia", "owner")] });

    const result = await sut.execute({
      approval: approval(),
      newNodeId: "node-next",
      sessionCompleted: false,
      decidedByUserId: "bruno",
    });

    expect(result.data!.filter((target) => target.userId === "olivia")).toHaveLength(1);
  });

  it("returns an empty list rather than failing when the session cannot be read", async () => {
    // Advisory only: it drives who the modal suggests contacting. A decision
    // that has already committed must never fail over this.
    const sut = build({ session: undefined as never });

    const result = await sut.execute({
      approval: approval({ sessionId: "missing" }),
      newNodeId: null,
      sessionCompleted: true,
      decidedByUserId: "bruno",
    });

    expect(result.error).toBeUndefined();
    expect(result.data).toEqual([]);
  });
});
