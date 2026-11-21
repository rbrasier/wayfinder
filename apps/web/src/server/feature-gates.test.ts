import { describe, expect, it, vi } from "vitest";
import type { Container } from "@/lib/container";
import { isFeatureEnabledForCaller, requireFeatureForCaller } from "./feature-gates";

const containerWith = (result: { data: boolean } | { error: { code: "INTERNAL"; message: string } }) => {
  const execute = vi.fn(async () => result);
  const container = { useCases: { isFeatureEnabledForUser: { execute } } } as unknown as Container;
  return { container, execute };
};

const caller = (container: Container) => ({ container, userId: "dana", isAdmin: false });

describe("isFeatureEnabledForCaller", () => {
  it("asks for the caller's own reading of the flag", async () => {
    const { container, execute } = containerWith({ data: true });

    await expect(isFeatureEnabledForCaller(caller(container), "flow_test_runs")).resolves.toBe(true);
    expect(execute).toHaveBeenCalledWith("dana", "flow_test_runs", false);
  });

  it("treats a failed lookup as off", async () => {
    const { container } = containerWith({ error: { code: "INTERNAL", message: "down" } });

    await expect(isFeatureEnabledForCaller(caller(container), "flow_memory")).resolves.toBe(false);
  });
});

describe("requireFeatureForCaller", () => {
  it("passes when the flag is on for the caller", async () => {
    const { container } = containerWith({ data: true });

    await expect(requireFeatureForCaller(caller(container), "flow_memory")).resolves.toBeUndefined();
  });

  it("refuses with FORBIDDEN when the flag is off", async () => {
    const { container } = containerWith({ data: false });

    await expect(requireFeatureForCaller(caller(container), "flow_memory")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
