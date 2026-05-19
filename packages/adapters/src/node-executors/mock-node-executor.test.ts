import { describe, expect, it } from "vitest";
import { MockNodeExecutor } from "./mock-node-executor";

describe("MockNodeExecutor", () => {
  const executor = new MockNodeExecutor();

  const baseInput = {
    nodeId: "node-1",
    sessionId: "session-abc",
    userId: "user-xyz",
    userRole: "user" as const,
    flowId: "flow-001",
    fields: { category: "IT Hardware", value: 50000 },
  };

  it("returns completed status for any nodeId", async () => {
    const result = await executor.execute(baseInput);

    expect(result.error).toBeUndefined();
    expect(result.data).toBeDefined();
    expect(result.data!.status).toBe("completed");
  });

  it("returns a data record", async () => {
    const result = await executor.execute(baseInput);

    expect(result.data).toBeDefined();
    expect(typeof result.data!.data).toBe("object");
  });

  it("includes an optional message in the output", async () => {
    const result = await executor.execute(baseInput);

    expect(result.data).toBeDefined();
    if (result.data!.message !== undefined) {
      expect(typeof result.data!.message).toBe("string");
    }
  });

  it("accepts admin role", async () => {
    const result = await executor.execute({ ...baseInput, userRole: "admin" });

    expect(result.error).toBeUndefined();
    expect(result.data!.status).toBe("completed");
  });

  it("reflects the nodeId in the output data", async () => {
    const result = await executor.execute({ ...baseInput, nodeId: "custom-node-42" });

    expect(result.data).toBeDefined();
    expect(result.data!.data["nodeId"]).toBe("custom-node-42");
  });
});
