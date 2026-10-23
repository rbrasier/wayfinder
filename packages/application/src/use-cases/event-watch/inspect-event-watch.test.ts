import { describe, expect, it } from "vitest";
import { domainError, err, ok, type NewAuditLog, type OutboundJsonRequest, type Result } from "@rbrasier/domain";
import { PreviewEventWatch, TestEventWatch } from "./inspect-event-watch";

const connection = {
  url: "https://api.example.gov.au/hearings",
  method: "GET" as const,
  requestBody: null,
  authType: "bearer" as const,
  apiKeyPlacement: null,
};

const build = (response: Result<{ status: number; json: unknown }> = ok({ status: 200, json: { hearings: [] } })) => {
  const requests: OutboundJsonRequest[] = [];
  const audits: NewAuditLog[] = [];
  const useCase = new TestEventWatch({
    watches: { getSecret: async () => ok("stored-token") },
    http: {
      requestJson: async (request) => {
        requests.push(request);
        return response;
      },
    },
    loadAutomationConfig: async () => ({ watchAllowedHosts: ["intranet"], emailAllowedDomains: [] }),
    auditLogger: {
      log: async (entry) => {
        audits.push(entry);
        return ok(true as const);
      },
    },
  });
  return { useCase, requests, audits };
};

describe("TestEventWatch", () => {
  it("fetches a sample with the secret typed into the editor", async () => {
    const { useCase, requests } = build();

    const result = await useCase.execute({ connection, secret: "typed-token", actorId: "admin-1" });

    expect(requests[0]).toMatchObject({ headers: { Authorization: "Bearer typed-token" }, allowedHosts: ["intranet"] });
    expect(result.data).toEqual({ status: 200, sample: { hearings: [] }, truncated: false });
  });

  it("falls back to the stored secret of the watch being edited", async () => {
    const { useCase, requests } = build();

    await useCase.execute({ watchId: "watch-1", connection, secret: undefined, actorId: "admin-1" });

    expect(requests[0]!.headers).toEqual({ Authorization: "Bearer stored-token" });
  });

  it("passes the API's failure back and audits the test without the secret", async () => {
    const { useCase, audits } = build(err(domainError("INFRA_FAILURE", "The API answered HTTP 401.")));

    const result = await useCase.execute({ connection, secret: "typed-token", actorId: "admin-1" });

    expect(result.error?.message).toBe("The API answered HTTP 401.");
    expect(audits[0]).toMatchObject({ action: "event_watch.tested", metadata: { host: "api.example.gov.au", succeeded: false } });
    expect(JSON.stringify(audits)).not.toContain("typed-token");
  });
});

describe("PreviewEventWatch", () => {
  const sample = { hearings: [{ id: "H-1", status: "finished" }, { id: "H-2", status: "live" }] };

  it("lists the items that would start a run", () => {
    const result = new PreviewEventWatch().execute({
      sample,
      itemsPath: "hearings",
      itemIdPath: "id",
      condition: { kind: "transition", fieldPath: "status", from: null, to: "finished" },
    });

    expect(result.data).toEqual({ itemCount: 2, wouldFire: ["H-1"], skippedWithoutId: 0 });
  });

  it("says when the items path does not lead to a list", () => {
    const result = new PreviewEventWatch().execute({
      sample,
      itemsPath: "missing",
      itemIdPath: "id",
      condition: { kind: "new_item" },
    });

    expect(result.error?.message).toBe("The response has no list at missing.");
  });
});
