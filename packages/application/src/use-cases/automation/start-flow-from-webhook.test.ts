import { describe, expect, it } from "vitest";
import { ok, type FlowTrigger, type Session } from "@rbrasier/domain";
import { StartFlowFromWebhook } from "./start-flow-from-webhook";
import type { StartUnattendedRunInput, StartUnattendedRunOutput } from "./start-unattended-run";

const trigger = (overrides: Partial<FlowTrigger> = {}): FlowTrigger => ({
  id: "trigger-1",
  flowId: "flow-1",
  kind: "webhook",
  enabled: true,
  tokenLastFour: "abcd",
  hasHmacSecret: false,
  runAsUserId: "owner-1",
  createdBy: "owner-1",
  lastTriggeredAt: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...overrides,
});

const build = (
  options: { trigger?: FlowTrigger | null; startOutcome?: StartUnattendedRunOutput; hmacSecret?: string | null } = {},
) => {
  const starts: StartUnattendedRunInput[] = [];
  const marked: string[] = [];
  const useCase = new StartFlowFromWebhook({
    triggers: {
      findByFlow: async () => ok(options.trigger === undefined ? trigger() : options.trigger),
      getTokenHash: async () => ok("hash(wf_wh_good)"),
      getHmacSecret: async () => ok(options.hmacSecret ?? null),
      markTriggered: async (id) => {
        marked.push(id);
        return ok(undefined);
      },
    },
    crypto: {
      hashToken: (token) => `hash(${token})`,
      hashesMatch: (left, right) => left === right,
      verifySignature: (secret, rawBody, signature) => signature === `sig(${secret}:${rawBody})`,
    },
    startUnattendedRun: {
      execute: async (input) => {
        starts.push(input);
        return ok(options.startOutcome ?? { started: true, session: { id: "session-1" } as Session });
      },
    },
    auditLogger: { log: async () => ok(true as const) },
    now: () => new Date("2026-10-22T00:00:00.000Z"),
  });
  return { useCase, starts, marked };
};

const call = { flowId: "flow-1", token: "wf_wh_good", signature: null, rawBody: '{"inputs":{"hearing_id":"H-1"}}' };

describe("StartFlowFromWebhook", () => {
  it("starts a run as the trigger's run-as user with the posted inputs", async () => {
    const { useCase, starts, marked } = build();

    const result = await useCase.execute({ ...call, body: { inputs: { hearing_id: "H-1" } } });

    expect(result.data).toEqual({ outcome: "started", sessionId: "session-1" });
    expect(starts[0]).toMatchObject({
      flowId: "flow-1",
      runAsUserId: "owner-1",
      origin: "webhook",
      triggerSourceId: "trigger-1",
      inputs: { hearing_id: "H-1" },
    });
    expect(marked).toEqual(["trigger-1"]);
  });

  it("answers not found for a flow without an enabled webhook, before looking at the token", async () => {
    expect((await build({ trigger: null }).useCase.execute({ ...call, body: {} })).data).toEqual({ outcome: "not_found" });
    expect((await build({ trigger: trigger({ enabled: false }) }).useCase.execute({ ...call, body: {} })).data).toEqual({
      outcome: "not_found",
    });
  });

  it("refuses a wrong or missing token", async () => {
    const { useCase, starts } = build();

    expect((await useCase.execute({ ...call, token: "wf_wh_bad", body: {} })).data).toEqual({ outcome: "unauthorized" });
    expect((await useCase.execute({ ...call, token: null, body: {} })).data).toEqual({ outcome: "unauthorized" });
    expect(starts).toHaveLength(0);
  });

  it("requires a valid signature once HMAC is on, even with a good token", async () => {
    const signed = build({ trigger: trigger({ hasHmacSecret: true }), hmacSecret: "s3cret" });

    const unsigned = await signed.useCase.execute({ ...call, body: {} });
    const good = await signed.useCase.execute({ ...call, signature: `sig(s3cret:${call.rawBody})`, body: {} });

    expect(unsigned.data).toEqual({ outcome: "unauthorized" });
    expect(good.data).toMatchObject({ outcome: "started" });
  });

  it("reports invalid inputs without starting a run", async () => {
    const { useCase } = build({
      startOutcome: { started: false, reason: "invalid_inputs", message: "hearing_id is required." },
    });

    const result = await useCase.execute({ ...call, body: { inputs: {} } });

    expect(result.data).toEqual({ outcome: "invalid", message: "hearing_id is required." });
  });

  it("answers not found when the flow or its run-as user is no longer available", async () => {
    const { useCase } = build({
      startOutcome: { started: false, reason: "flow_unavailable", message: "The flow is not published." },
    });

    expect((await useCase.execute({ ...call, body: {} })).data).toEqual({ outcome: "not_found" });
  });

  it("treats a body without an inputs object as the inputs themselves", async () => {
    const { useCase, starts } = build();

    await useCase.execute({ ...call, body: { hearing_id: "H-9" } });

    expect(starts[0]!.inputs).toEqual({ hearing_id: "H-9" });
  });
});
