import { describe, expect, it } from "vitest";
import {
  buildFlowSnapshot,
  ok,
  type Flow,
  type FlowVersion,
  type Session,
  type SessionMessage,
  type User,
} from "@rbrasier/domain";
import type { StartSessionInput } from "../session/start-session";
import { StartUnattendedRun } from "./start-unattended-run";

const flow = (overrides: Partial<Flow> = {}): Flow => ({
  id: "flow-1",
  name: "Estimates summary",
  description: null,
  icon: null,
  expertRole: null,
  ownerUserId: "owner-1",
  flowType: "guided",
  status: "published",
  visibility: { kind: "private" },
  permissions: [],
  contextDocs: [],
  triggerInputs: [],
  deletedAt: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...overrides,
});

const publishedVersion = (pinned: Flow): FlowVersion =>
  ({
    id: "version-1",
    flowId: pinned.id,
    versionNumber: 1,
    status: "published",
    snapshot: buildFlowSnapshot(pinned, [], []),
    createdAt: new Date(0),
    updatedAt: new Date(0),
  }) as unknown as FlowVersion;

const runAs: User = {
  id: "owner-1",
  email: "owner@agency.gov.au",
  name: "Olive",
  role: null,
  team: null,
  isAdmin: false,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

const build = (options: { liveFlow?: Flow | null; pinnedFlow?: Flow; user?: User | null } = {}) => {
  const liveFlow = options.liveFlow === undefined ? flow() : options.liveFlow;
  const started: StartSessionInput[] = [];
  const titled: Array<{ id: string; title: string }> = [];
  const posted: Array<{ sessionId: string; role: string; content: string; aiPayload?: unknown }> = [];
  const useCase = new StartUnattendedRun({
    users: { findById: async () => ok(options.user === undefined ? runAs : options.user) },
    flows: { findById: async () => ok(liveFlow) },
    flowVersions: {
      latestPublished: async () => ok(options.pinnedFlow ? publishedVersion(options.pinnedFlow) : null),
    },
    startSession: {
      execute: async (input: StartSessionInput) => {
        started.push(input);
        return ok({ id: "session-9", currentNodeId: "node-start", ...input } as unknown as Session);
      },
    },
    sessions: {
      update: async (id: string, patch: { title?: string | null }) => {
        titled.push({ id, title: patch.title ?? "" });
        return ok({ id } as Session);
      },
    },
    sessionMessages: {
      create: async (message) => {
        posted.push(message);
        return ok({ id: "message-1" } as SessionMessage);
      },
    },
  });
  return { useCase, started, titled, posted };
};

const request = {
  flowId: "flow-1",
  runAsUserId: "owner-1",
  origin: "webhook" as const,
  triggerSourceId: "trigger-1",
  sourceName: null,
  inputs: { hearing_id: "H-123", unexpected: "x" },
  raw: { hearing_id: "H-123", unexpected: "x" },
};

describe("StartUnattendedRun", () => {
  it("starts a session as the run-as user with validated inputs from the pinned version", async () => {
    const pinned = flow({ triggerInputs: [{ key: "hearing_id", label: "Hearing", type: "text", required: true }] });
    const { useCase, started, titled } = build({ pinnedFlow: pinned });

    const result = await useCase.execute({ ...request, itemId: "H-123" });

    expect(result.data).toMatchObject({ started: true });
    expect(started[0]).toEqual({
      flowId: "flow-1",
      userId: "owner-1",
      origin: "webhook",
      triggerSourceId: "trigger-1",
      triggerPayload: { inputs: { hearing_id: "H-123" }, raw: request.raw, itemId: "H-123" },
    });
    expect(titled[0]).toEqual({ id: "session-9", title: "Estimates summary · H-123" });
  });

  it("opens the run's chat with a line saying what started it, carrying the inputs as insights", async () => {
    const pinned = flow({ triggerInputs: [{ key: "hearing_id", label: "Hearing", type: "text", required: true }] });
    const { useCase, posted } = build({ pinnedFlow: pinned });

    await useCase.execute({ ...request, origin: "watch", sourceName: "ParlView hearings" });

    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({
      sessionId: "session-9",
      role: "system",
      // Anchored to the run's first step, as every insight-carrying message is.
      stepNodeId: "node-start",
      content: 'Started by Event Watch "ParlView hearings".',
      aiPayload: { contextGathered: [{ key: "Hearing", value: "H-123" }] },
    });
  });

  it("refuses inputs that fail the pinned version's declaration and starts nothing", async () => {
    const pinned = flow({ triggerInputs: [{ key: "hearing_id", label: "Hearing", type: "text", required: true }] });
    const { useCase, started } = build({ pinnedFlow: pinned });

    const result = await useCase.execute({ ...request, inputs: {} });

    expect(result.data).toEqual({ started: false, reason: "invalid_inputs", message: "hearing_id is required." });
    expect(started).toHaveLength(0);
  });

  it("reports the run-as user as unavailable when their account no longer exists", async () => {
    const { useCase, started } = build({ user: null });

    const result = await useCase.execute(request);

    expect(result.data).toMatchObject({ started: false, reason: "run_as_unavailable" });
    expect(started).toHaveLength(0);
  });

  it("reports the flow as unavailable when it is unpublished or deleted", async () => {
    expect((await build({ liveFlow: flow({ status: "draft" }) }).useCase.execute(request)).data).toMatchObject({
      started: false,
      reason: "flow_unavailable",
    });
    expect((await build({ liveFlow: null }).useCase.execute(request)).data).toMatchObject({
      started: false,
      reason: "flow_unavailable",
    });
  });

  it("keeps a marker rather than the payload when the raw body is too large to store", async () => {
    const { useCase, started } = build();

    await useCase.execute({ ...request, raw: { blob: "x".repeat(300_000) } });

    expect(started[0]!.triggerPayload?.raw).toEqual({ truncated: true, bytes: expect.any(Number) });
  });
});
