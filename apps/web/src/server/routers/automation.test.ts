import { describe, expect, it, vi } from "vitest";
import type { PermissionKey } from "@wayfinder/domain";
import type { Container } from "@/lib/container";
import { createCallerFactory, router, type TrpcContext } from "../trpc";
import { automationRouter } from "./automation";

const createCaller = createCallerFactory(router({ automation: automationRouter }));

const FLOW = "11111111-1111-4111-8111-111111111111";
const OWNER = "22222222-2222-4222-8222-222222222222";

const makeContainer = () => {
  const setTriggerInputs = { execute: vi.fn(async () => ({ data: { triggerInputs: [] } })) };
  const findFlow = vi.fn(async () => ({ data: { triggerInputs: [] } }));
  const container = {
    env: { BETTER_AUTH_URL: "https://wayfinder.example.gov" },
    services: { errorLogger: { log: async () => undefined } },
    repos: {
      flows: { findById: findFlow },
      flowTriggers: { findByFlow: async () => ({ data: null }) },
    },
    useCases: {
      getFlowCanvas: {
        execute: async () => ({ data: { flow: { id: FLOW, ownerUserId: OWNER, permissions: [] } } }),
      },
      setTriggerInputs,
    },
  } as unknown as Container;
  return { container, setTriggerInputs, findFlow };
};

const ownerWith = (container: Container, permissions: PermissionKey[], isAdmin = false) =>
  createCaller({
    container,
    userId: OWNER,
    authSessionId: null,
    impersonatorId: null,
    impersonationCookie: null,
    isAdmin,
    permissions: new Set(permissions),
    headers: new Headers(),
  } satisfies TrpcContext);

// The Triggers dialog governs how a flow is started from outside, so the
// "Start flows via webhook" permission is what opens it — owning the flow is
// not enough on its own (ADR-064 §3).
describe("automation router — Start flows via webhook", () => {
  it("refuses a flow owner without the permission, before reading the flow", async () => {
    const { container, setTriggerInputs, findFlow } = makeContainer();
    const caller = ownerWith(container, []);

    await expect(caller.automation.flowTriggers({ flowId: FLOW })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.automation.setTriggerInputs({ flowId: FLOW, inputs: [] })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(caller.automation.webhookRuns({ flowId: FLOW })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(findFlow).not.toHaveBeenCalled();
    expect(setTriggerInputs.execute).not.toHaveBeenCalled();
  });

  it("opens the triggers to a flow owner holding flow:webhook_trigger", async () => {
    const { container, setTriggerInputs } = makeContainer();
    const caller = ownerWith(container, ["flow:webhook_trigger"]);

    await expect(caller.automation.flowTriggers({ flowId: FLOW })).resolves.toMatchObject({ triggerInputs: [] });
    await caller.automation.setTriggerInputs({ flowId: FLOW, inputs: [] });
    expect(setTriggerInputs.execute).toHaveBeenCalled();
  });

  it("opens the triggers to an admin without the explicit permission", async () => {
    const { container } = makeContainer();
    const caller = ownerWith(container, [], true);

    await expect(caller.automation.webhookRuns({ flowId: FLOW })).resolves.toEqual([]);
  });
});
