import { describe, expect, it } from "vitest";
import type { PermissionKey } from "@wayfinder/domain";
import type { Container } from "@/lib/container";
import { createCallerFactory, router, type TrpcContext } from "../trpc";
import { flowTestRouter } from "./flow-test";

const testRouter = router({ flowTest: flowTestRouter });
const createCaller = createCallerFactory(testRouter);

const FLOW = "11111111-1111-1111-1111-111111111111";
const NODE = "22222222-2222-2222-2222-222222222222";
const SESSION = "33333333-3333-3333-3333-333333333333";
const FIXTURE = "44444444-4444-4444-4444-444444444444";
const OWNER = "55555555-5555-5555-5555-555555555555";
const STRANGER = "66666666-6666-6666-6666-666666666666";

// A container stub whose flow carries a real owner, so `canEditFlow` runs its
// genuine rule rather than a stubbed yes/no. Every use-case records the userId
// it was handed, which is what the scoping assertions inspect.
const containerFor = (calls: { seen: Record<string, unknown>[] }): Container =>
  ({
    services: { errorLogger: { log: async () => undefined } },
    repos: {
      sessions: {
        listAll: async (mode: string) => {
          calls.seen.push({ method: "listAll", mode });
          return { data: [] };
        },
      },
      flowTestFixtures: {
        listByFlow: async (flowId: string, userId: string) => {
          calls.seen.push({ method: "fixture.listByFlow", flowId, userId });
          return { data: [] };
        },
        create: async (input: Record<string, unknown>) => {
          calls.seen.push({ method: "fixture.create", ...input });
          return { data: { id: FIXTURE } };
        },
        update: async (id: string, userId: string) => {
          calls.seen.push({ method: "fixture.update", id, userId });
          return { data: { id } };
        },
        delete: async (id: string, userId: string) => {
          calls.seen.push({ method: "fixture.delete", id, userId });
          return { data: undefined };
        },
      },
    },
    useCases: {
      getFlowCanvas: {
        execute: async () => ({
          data: { flow: { id: FLOW, ownerUserId: OWNER, permissions: [] } },
        }),
      },
      startTestRun: {
        execute: async (input: Record<string, unknown>) => {
          calls.seen.push({ method: "startTestRun", ...input });
          return { data: { session: { id: SESSION }, rejects: [] } };
        },
      },
      getTestRunReport: {
        execute: async (input: Record<string, unknown>) => {
          calls.seen.push({ method: "getTestRunReport", ...input });
          return { data: { sessionId: SESSION, steps: [] } };
        },
      },
      deleteTestSession: {
        execute: async (input: Record<string, unknown>) => {
          calls.seen.push({ method: "deleteTestSession", ...input });
          return { data: undefined };
        },
      },
      buildSeedFromSession: {
        execute: async (input: Record<string, unknown>) => {
          calls.seen.push({ method: "buildSeedFromSession", ...input });
          return { data: { seed: { gatheredContext: [], stepOutputs: [] }, sourceSessionId: SESSION } };
        },
      },
      generateSeed: {
        execute: async (input: Record<string, unknown>) => {
          calls.seen.push({ method: "generateSeed", ...input });
          return { data: { seed: { gatheredContext: [], stepOutputs: [] }, rejects: [], failureReason: null } };
        },
      },
    },
  }) as unknown as Container;

const contextFor = (
  userId: string,
  calls: { seen: Record<string, unknown>[] },
  isAdmin = false,
): TrpcContext => ({
  container: containerFor(calls),
  userId,
  isAdmin,
  permissions: new Set<PermissionKey>(),
  headers: new Headers(),
});

const freshCalls = () => ({ seen: [] as Record<string, unknown>[] });

describe("flowTest router — authorisation boundary", () => {
  it("lets the flow owner start a test run", async () => {
    const calls = freshCalls();
    const caller = createCaller(contextFor(OWNER, calls));

    await expect(caller.flowTest.start({ flowId: FLOW })).resolves.toMatchObject({
      session: { id: SESSION },
    });
  });

  it("refuses a stranger starting a test run", async () => {
    const calls = freshCalls();
    const caller = createCaller(contextFor(STRANGER, calls));

    await expect(caller.flowTest.start({ flowId: FLOW })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(calls.seen).toEqual([]);
  });

  it("lets an admin start a test run on a flow they do not own", async () => {
    const calls = freshCalls();
    const caller = createCaller(contextFor(STRANGER, calls, true));

    await expect(caller.flowTest.start({ flowId: FLOW })).resolves.toBeTruthy();
  });

  it("refuses a stranger generating a seed, before the model is called", async () => {
    const calls = freshCalls();
    const caller = createCaller(contextFor(STRANGER, calls));

    await expect(
      caller.flowTest.generateSeed({ flowId: FLOW, startNodeId: NODE }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(calls.seen).toEqual([]);
  });

  it("refuses a stranger listing seedable sessions", async () => {
    const calls = freshCalls();
    const caller = createCaller(contextFor(STRANGER, calls));

    await expect(caller.flowTest.listSeedableSessions({ flowId: FLOW })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("offers only live sessions as clone sources", async () => {
    const calls = freshCalls();
    const caller = createCaller(contextFor(OWNER, calls));

    await caller.flowTest.listSeedableSessions({ flowId: FLOW });

    expect(calls.seen).toContainEqual({ method: "listAll", mode: "live" });
  });

  it("passes the caller through to the use-case rather than trusting the input", async () => {
    const calls = freshCalls();
    const caller = createCaller(contextFor(OWNER, calls));

    await caller.flowTest.start({ flowId: FLOW, startNodeId: NODE });

    expect(calls.seen[0]).toMatchObject({ method: "startTestRun", userId: OWNER, isAdmin: false });
  });

  it("scopes report and delete to the caller, leaving the use-case to authorise", async () => {
    const calls = freshCalls();
    const caller = createCaller(contextFor(OWNER, calls));

    await caller.flowTest.report({ sessionId: SESSION });
    await caller.flowTest.delete({ sessionId: SESSION });

    expect(calls.seen[0]).toMatchObject({ method: "getTestRunReport", userId: OWNER });
    expect(calls.seen[1]).toMatchObject({ method: "deleteTestSession", userId: OWNER });
  });

  it("scopes a clone to the caller", async () => {
    const calls = freshCalls();
    const caller = createCaller(contextFor(OWNER, calls));

    await caller.flowTest.cloneSeed({ sessionId: SESSION, upToNodeId: NODE });

    expect(calls.seen[0]).toMatchObject({ method: "buildSeedFromSession", userId: OWNER });
  });
});

describe("flowTest router — fixtures are private to their creator", () => {
  it("scopes a fixture listing to the caller, not just the flow", async () => {
    const calls = freshCalls();
    const caller = createCaller(contextFor(OWNER, calls));

    await caller.flowTest.fixture.list({ flowId: FLOW });

    expect(calls.seen).toContainEqual({
      method: "fixture.listByFlow",
      flowId: FLOW,
      userId: OWNER,
    });
  });

  it("stamps a new fixture with its creator rather than accepting one from the client", async () => {
    const calls = freshCalls();
    const caller = createCaller(contextFor(OWNER, calls));

    await caller.flowTest.fixture.create({ flowId: FLOW, name: "Realistic", startNodeId: NODE });

    expect(calls.seen[0]).toMatchObject({ method: "fixture.create", createdByUserId: OWNER });
  });

  it("scopes an update to the caller", async () => {
    const calls = freshCalls();
    const caller = createCaller(contextFor(OWNER, calls));

    await caller.flowTest.fixture.update({ id: FIXTURE, name: "Renamed" });

    expect(calls.seen[0]).toMatchObject({ method: "fixture.update", userId: OWNER });
  });

  it("scopes a delete to the caller", async () => {
    const calls = freshCalls();
    const caller = createCaller(contextFor(OWNER, calls));

    await caller.flowTest.fixture.delete({ id: FIXTURE });

    expect(calls.seen[0]).toMatchObject({ method: "fixture.delete", userId: OWNER });
  });

  it("refuses a stranger listing another author's fixtures", async () => {
    const calls = freshCalls();
    const caller = createCaller(contextFor(STRANGER, calls));

    await expect(caller.flowTest.fixture.list({ flowId: FLOW })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
