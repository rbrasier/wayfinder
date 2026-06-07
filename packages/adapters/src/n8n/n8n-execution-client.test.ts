import { describe, expect, it, vi } from "vitest";
import type { N8nConfig } from "@rbrasier/domain";
import { N8nHttpExecutionClient } from "./n8n-execution-client";

const config: N8nConfig = { baseUrl: "https://n8n.example.com", apiKey: "secret-key" };

const jsonResponse = (body: unknown, ok = true, status = 200): Response =>
  ({
    ok,
    status,
    json: async () => body,
  }) as unknown as Response;

const executionPayload = {
  data: [
    {
      id: 42,
      finished: true,
      data: {
        resultData: {
          runData: {
            Webhook: [{ data: { main: [[{ json: { category: "tools", budget: 500 } }]] } }],
            Output: [{ data: { main: [[{ json: { vendor: "Acme", approved: true } }]] } }],
          },
        },
      },
    },
  ],
  nextCursor: null,
};

describe("N8nHttpExecutionClient", () => {
  it("requests the latest execution with data included for the workflow", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(executionPayload));
    const client = new N8nHttpExecutionClient(async () => config, fetchFn as unknown as typeof fetch);

    await client.getLatestExecution("wf-1");

    const url = fetchFn.mock.calls[0]![0] as string;
    expect(url).toContain("/api/v1/executions");
    expect(url).toContain("workflowId=wf-1");
    expect(url).toContain("includeData=true");
    const init = fetchFn.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)["X-N8N-API-KEY"]).toBe("secret-key");
  });

  it("returns each node's JSON output keyed by node name and flags executions present", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(executionPayload));
    const client = new N8nHttpExecutionClient(async () => config, fetchFn as unknown as typeof fetch);

    const result = await client.getLatestExecution("wf-1");

    expect(result.error).toBeUndefined();
    expect(result.data?.hasExecutions).toBe(true);
    expect(result.data?.nodeOutputs).toEqual({
      Webhook: { category: "tools", budget: 500 },
      Output: { vendor: "Acme", approved: true },
    });
  });

  it("reports no executions when the list is empty", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ data: [], nextCursor: null }));
    const client = new N8nHttpExecutionClient(async () => config, fetchFn as unknown as typeof fetch);

    const result = await client.getLatestExecution("wf-1");

    expect(result.data?.hasExecutions).toBe(false);
    expect(result.data?.nodeOutputs).toEqual({});
  });

  it("returns a validation error when n8n is not configured", async () => {
    const client = new N8nHttpExecutionClient(async () => ({ baseUrl: "", apiKey: "" }));
    const result = await client.getLatestExecution("wf-1");
    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("returns an infra error on a non-2xx response", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({}, false, 403));
    const client = new N8nHttpExecutionClient(async () => config, fetchFn as unknown as typeof fetch);

    const result = await client.getLatestExecution("wf-1");
    expect(result.error?.code).toBe("INFRA_FAILURE");
  });

  it("returns an infra error when the fetch throws", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("network down"));
    const client = new N8nHttpExecutionClient(async () => config, fetchFn as unknown as typeof fetch);

    const result = await client.getLatestExecution("wf-1");
    expect(result.error?.code).toBe("INFRA_FAILURE");
  });
});
