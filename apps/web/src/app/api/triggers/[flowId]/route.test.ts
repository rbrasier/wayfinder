import { beforeEach, describe, expect, it, vi } from "vitest";

const { container } = vi.hoisted(() => ({
  container: {
    services: {
      webhookRateLimiter: { consume: vi.fn() },
      errorLogger: { log: vi.fn() },
    },
    useCases: { startFlowFromWebhook: { execute: vi.fn() } },
  },
}));

vi.mock("@/lib/container", () => ({ getContainer: () => container }));
vi.mock("@/lib/automation/unattended-runs", () => ({ kickUnattendedRun: vi.fn() }));

import { JSON_BODY_LIMIT_BYTES } from "@/lib/request-body-limit";
import { POST } from "./route";

const flowId = "4b7a1f2e-9c3d-4e5f-8a6b-1c2d3e4f5a6b";
const params = { params: Promise.resolve({ flowId }) };

const triggerRequest = (body: string): Request =>
  new Request(`http://localhost:3000/api/triggers/${flowId}`, {
    method: "POST",
    headers: { authorization: "Bearer wf_wh_abc", "content-type": "application/json" },
    body,
  });

describe("/api/triggers/[flowId]", () => {
  beforeEach(() => {
    container.services.webhookRateLimiter.consume.mockResolvedValue({ data: { allowed: true, retryAfterMs: 0 } });
    container.useCases.startFlowFromWebhook.execute.mockReset();
    container.useCases.startFlowFromWebhook.execute.mockResolvedValue({ data: { outcome: "not_found" } });
  });

  it("rejects a body over the limit before the run is started", async () => {
    const response = await POST(triggerRequest(`"${"a".repeat(JSON_BODY_LIMIT_BYTES)}"`), params);

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "Body too large." });
    expect(container.useCases.startFlowFromWebhook.execute).not.toHaveBeenCalled();
  });

  it("hands a body under the limit to the use case as both raw text and parsed JSON", async () => {
    const body = '{"inputs":{"hearing":"2026-11-02"}}';

    await POST(triggerRequest(body), params);

    expect(container.useCases.startFlowFromWebhook.execute).toHaveBeenCalledWith(
      expect.objectContaining({ flowId, token: "wf_wh_abc", rawBody: body, body: JSON.parse(body) }),
    );
  });
});
