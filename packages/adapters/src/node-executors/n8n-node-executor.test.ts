import { createHmac } from "crypto";
import { describe, expect, it, vi } from "vitest";
import type { NodeExecutionInput } from "@wayfinder/domain";
import { N8nNodeExecutor } from "./n8n-node-executor";

const SECRET = "shared-secret";

const baseInput: NodeExecutionInput = {
  nodeId: "node-1",
  sessionId: "session-abc",
  userId: "user-xyz",
  userRole: "user",
  flowId: "flow-001",
  flowSlug: "procurement-flow",
  sessionTitle: "Buy laptops",
  instruction: "Look up the preferred vendor.",
  correlationId: "corr-1",
  webhookUrl: "https://n8n.example.com/webhook/abc",
  fields: { category: "IT Hardware" },
};

const okResponse = () => new Response("{}", { status: 200 });

describe("N8nNodeExecutor", () => {
  it("POSTs a signed request to the node's webhook URL and returns pending", async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse());
    const executor = new N8nNodeExecutor(SECRET, fetchFn as unknown as typeof fetch);

    const result = await executor.execute(baseInput);

    expect(result.error).toBeUndefined();
    expect(result.data!.status).toBe("pending");

    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("https://n8n.example.com/webhook/abc");
    expect(init.method).toBe("POST");

    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      instruction: "Look up the preferred vendor.",
      fields: { category: "IT Hardware" },
      correlationId: "corr-1",
      nodeId: "node-1",
      sessionId: "session-abc",
      flowId: "flow-001",
      flowSlug: "procurement-flow",
      sessionTitle: "Buy laptops",
      userId: "user-xyz",
      userRole: "user",
    });
  });

  it("signs the exact request body with HMAC-SHA256 in the X-N8n-Signature header", async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse());
    const executor = new N8nNodeExecutor(SECRET, fetchFn as unknown as typeof fetch);

    await executor.execute(baseInput);

    const [, init] = fetchFn.mock.calls[0]!;
    const sentBody = init.body as string;
    const expected = "sha256=" + createHmac("sha256", SECRET).update(sentBody).digest("hex");
    expect(init.headers["X-N8n-Signature"]).toBe(expected);
  });

  it("returns an error result when the network call throws (never throws across the boundary)", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const executor = new N8nNodeExecutor(SECRET, fetchFn as unknown as typeof fetch);

    const result = await executor.execute(baseInput);

    expect(result.data).toBeUndefined();
    expect(result.error?.code).toBe("INFRA_FAILURE");
  });

  it("returns an error result on a non-2xx response", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response("nope", { status: 500 }));
    const executor = new N8nNodeExecutor(SECRET, fetchFn as unknown as typeof fetch);

    const result = await executor.execute(baseInput);

    expect(result.error?.code).toBe("INFRA_FAILURE");
  });
});
