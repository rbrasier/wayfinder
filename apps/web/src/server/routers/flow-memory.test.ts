import { ok, type PermissionKey } from "@wayfinder/domain";
import { describe, expect, it, vi } from "vitest";
import type { Container } from "@/lib/container";
import { createCallerFactory, router, type TrpcContext } from "../trpc";
import { flowMemoryRouter } from "./flow-memory";

const createCaller = createCallerFactory(router({ flowMemory: flowMemoryRouter }));

const FLOW_ID = "11111111-1111-4111-8111-111111111111";
const LESSON_ID = "22222222-2222-4222-8222-222222222222";

const makeContainer = (flowMemoryEnabled: boolean) => {
  const getFlowMemoryPanel = { execute: vi.fn().mockResolvedValue(ok({ lessons: [] })) };
  const acceptLesson = { execute: vi.fn().mockResolvedValue(ok({ id: LESSON_ID })) };
  const isFeatureEnabledForUser = {
    execute: vi.fn(async (_userId: string, key: string) => ok(key === "flow_memory" && flowMemoryEnabled)),
  };
  const container = {
    services: { errorLogger: { log: async () => undefined } },
    useCases: { getFlowMemoryPanel, acceptLesson, isFeatureEnabledForUser },
  } as unknown as Container;
  return { container, getFlowMemoryPanel, acceptLesson };
};

const callerWith = (container: Container) =>
  createCaller({
    container,
    userId: "author",
    authSessionId: null,
    impersonatorId: null,
    impersonationCookie: null,
    isAdmin: false,
    permissions: new Set<PermissionKey>(),
    headers: new Headers(),
  } satisfies TrpcContext);

describe("flowMemory router — flow_memory flag", () => {
  it("serves the panel while the flag is on", async () => {
    const { container, getFlowMemoryPanel } = makeContainer(true);

    await expect(callerWith(container).flowMemory.panel({ flowId: FLOW_ID })).resolves.toEqual({ lessons: [] });
    expect(getFlowMemoryPanel.execute).toHaveBeenCalled();
  });

  it("refuses every procedure while the flag is off, before any use-case runs", async () => {
    const { container, getFlowMemoryPanel, acceptLesson } = makeContainer(false);

    await expect(callerWith(container).flowMemory.panel({ flowId: FLOW_ID })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(callerWith(container).flowMemory.accept({ lessonId: LESSON_ID })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(getFlowMemoryPanel.execute).not.toHaveBeenCalled();
    expect(acceptLesson.execute).not.toHaveBeenCalled();
  });
});
