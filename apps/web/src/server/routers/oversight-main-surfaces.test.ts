import { ok, type PermissionKey } from "@wayfinder/domain";
import { describe, expect, it, vi } from "vitest";
import type { Container } from "@/lib/container";
import { createCallerFactory, router, type TrpcContext } from "../trpc";
import { flowMemoryRouter } from "./flow-memory";
import { flowRouter } from "./flow";
import { flowTestRouter } from "./flow-test";

// ADR-066 §4 applied to the surfaces main added after the split was designed on
// alpha-2: flow memory, flow test runs and flow duplicate all mean "may edit any
// flow" by their use cases' `isAdmin`, which an oversight holder has and a
// Technical or User Admin does not.

const createCaller = createCallerFactory(
  router({ flow: flowRouter, flowMemory: flowMemoryRouter, flowTest: flowTestRouter }),
);

const FLOW_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";

const makeContainer = () => {
  const getFlowMemoryPanel = { execute: vi.fn().mockResolvedValue(ok({ lessons: [] })) };
  const getTestRunReport = { execute: vi.fn().mockResolvedValue(ok({ steps: [] })) };
  const duplicateFlow = { execute: vi.fn().mockResolvedValue(ok({ id: "copy" })) };
  const container = {
    useCases: { getFlowMemoryPanel, getTestRunReport, duplicateFlow },
  } as unknown as Container;
  return { container, getFlowMemoryPanel, getTestRunReport, duplicateFlow };
};

const callerWith = (container: Container, permissions: PermissionKey[]) =>
  createCaller({
    container,
    userId: "viewer",
    authSessionId: null,
    impersonatorId: null,
    impersonationCookie: null,
    isAdmin: false,
    permissions: new Set(permissions),
    headers: new Headers(),
  } satisfies TrpcContext);

describe("oversight on main's flow surfaces", () => {
  it("opens another author's flow memory for an oversight holder only", async () => {
    const { container, getFlowMemoryPanel } = makeContainer();

    await callerWith(container, ["admin:oversight"]).flowMemory.panel({ flowId: FLOW_ID });
    await callerWith(container, ["admin:technical", "admin:users"]).flowMemory.panel({ flowId: FLOW_ID });

    expect(getFlowMemoryPanel.execute).toHaveBeenNthCalledWith(1, expect.objectContaining({ isAdmin: true }));
    expect(getFlowMemoryPanel.execute).toHaveBeenNthCalledWith(2, expect.objectContaining({ isAdmin: false }));
  });

  it("opens another author's test run report for an oversight holder only", async () => {
    const { container, getTestRunReport } = makeContainer();

    await callerWith(container, ["admin:oversight"]).flowTest.report({ sessionId: SESSION_ID });
    await callerWith(container, ["admin:technical"]).flowTest.report({ sessionId: SESSION_ID });

    expect(getTestRunReport.execute).toHaveBeenNthCalledWith(1, expect.objectContaining({ isAdmin: true }));
    expect(getTestRunReport.execute).toHaveBeenNthCalledWith(2, expect.objectContaining({ isAdmin: false }));
  });

  it("lets an oversight holder duplicate a flow they do not own, and not a User Admin", async () => {
    const { container, duplicateFlow } = makeContainer();

    await callerWith(container, ["admin:oversight"]).flow.duplicate({ flowId: FLOW_ID });
    await callerWith(container, ["admin:users"]).flow.duplicate({ flowId: FLOW_ID });

    expect(duplicateFlow.execute).toHaveBeenNthCalledWith(1, expect.objectContaining({ isAdmin: true }));
    expect(duplicateFlow.execute).toHaveBeenNthCalledWith(2, expect.objectContaining({ isAdmin: false }));
  });
});
