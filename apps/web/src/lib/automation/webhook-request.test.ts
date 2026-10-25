import { describe, expect, it } from "vitest";
import { bearerTokenOf, parseWebhookBody, webhookResponseFor } from "./webhook-request";

describe("bearerTokenOf", () => {
  it("reads a bearer token and ignores anything else", () => {
    expect(bearerTokenOf("Bearer wf_wh_abc")).toBe("wf_wh_abc");
    expect(bearerTokenOf("bearer   wf_wh_abc ")).toBe("wf_wh_abc");
    expect(bearerTokenOf("Basic dXNlcg==")).toBeNull();
    expect(bearerTokenOf(null)).toBeNull();
  });
});

describe("parseWebhookBody", () => {
  it("treats an empty body as no inputs", () => {
    expect(parseWebhookBody("  ")).toEqual({ ok: true, body: {} });
  });

  it("parses JSON and refuses anything else", () => {
    expect(parseWebhookBody('{"inputs":{"a":1}}')).toEqual({ ok: true, body: { inputs: { a: 1 } } });
    expect(parseWebhookBody("hearing=1")).toEqual({ ok: false });
  });
});

describe("webhookResponseFor", () => {
  it("maps each outcome to the status the caller can act on", async () => {
    const started = webhookResponseFor({ outcome: "started", sessionId: "session-1" });
    expect(started.status).toBe(202);
    expect(await started.json()).toEqual({ sessionId: "session-1" });

    expect(webhookResponseFor({ outcome: "not_found" }).status).toBe(404);
    expect(webhookResponseFor({ outcome: "unauthorized" }).status).toBe(401);

    const invalid = webhookResponseFor({ outcome: "invalid", message: "hearing_id is required." });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "hearing_id is required." });
  });
});
