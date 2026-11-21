import { describe, expect, it, vi } from "vitest";
import type { FlowLesson } from "@wayfinder/domain";
import type { getContainer } from "@/lib/container";
import { lessonsForStep } from "./flow-memory-lessons";

type Container = ReturnType<typeof getContainer>;

const lesson = (overrides: Partial<FlowLesson> = {}): FlowLesson => ({
  id: "lesson-1",
  flowId: "flow-1",
  nodeId: "node-1",
  kind: "guidance",
  statement: "Ask for the supplier's registered legal name, not its trading name.",
  status: "accepted",
  evidenceCount: 3,
  firstSeenAt: new Date("2026-01-01T00:00:00Z"),
  lastSeenAt: new Date("2026-02-01T00:00:00Z"),
  acceptedByUserId: "user-1",
  acceptedAt: new Date("2026-02-02T00:00:00Z"),
  supersedesLessonId: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-02-02T00:00:00Z"),
  ...overrides,
});

const containerWith = (result: { data: boolean } | { error: { code: "INTERNAL"; message: string } }) => {
  const execute = vi.fn(async () => result);
  return { container: { useCases: { isFeatureEnabled: { execute } } } as unknown as Container, execute };
};

describe("lessonsForStep", () => {
  it("injects the current step's accepted lessons while flow_memory is on", async () => {
    const { container, execute } = containerWith({ data: true });
    const lessons = [lesson(), lesson({ id: "lesson-2", nodeId: "node-2" })];

    const injected = await lessonsForStep(container, lessons, "node-1");

    expect(execute).toHaveBeenCalledWith("flow_memory");
    expect(injected.map((entry) => entry.statement)).toEqual([lesson().statement]);
  });

  it("injects nothing while flow_memory is off, even for accepted lessons", async () => {
    const { container } = containerWith({ data: false });

    await expect(lessonsForStep(container, [lesson()], "node-1")).resolves.toEqual([]);
  });

  it("injects nothing when the flag cannot be read", async () => {
    const { container } = containerWith({ error: { code: "INTERNAL", message: "down" } });

    await expect(lessonsForStep(container, [lesson()], "node-1")).resolves.toEqual([]);
  });

  it("skips the flag lookup when there is nothing to inject", async () => {
    const { container, execute } = containerWith({ data: true });

    await expect(lessonsForStep(container, [], "node-1")).resolves.toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });
});
