import { describe, expect, it } from "vitest";
import { ok, type Flow, type FlowTrigger, type FlowTriggerSettings, type Result } from "@rbrasier/domain";
import { ConfigureWebhookTrigger, RotateWebhookToken, SetWebhookHmac, type WebhookActor } from "./webhook-trigger";

class InMemoryTriggers {
  row: (FlowTrigger & { tokenHash: string | null; secret: string | null }) | null = null;
  async findByFlow(): Promise<Result<FlowTrigger | null>> {
    return ok(this.row);
  }
  async upsert(flowId: string, _kind: "webhook", settings: FlowTriggerSettings, createdBy: string) {
    this.row = {
      id: "trigger-1",
      flowId,
      kind: "webhook",
      tokenLastFour: this.row?.tokenLastFour ?? null,
      hasHmacSecret: this.row?.hasHmacSecret ?? false,
      createdBy,
      lastTriggeredAt: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
      tokenHash: this.row?.tokenHash ?? null,
      secret: this.row?.secret ?? null,
      ...settings,
    };
    return ok(this.row as FlowTrigger);
  }
  async setToken(_id: string, tokenHash: string, tokenLastFour: string) {
    this.row = { ...this.row!, tokenHash, tokenLastFour };
    return ok(this.row as FlowTrigger);
  }
  async setHmacSecret(_id: string, secret: string | null) {
    this.row = { ...this.row!, secret, hasHmacSecret: secret !== null };
    return ok(this.row as FlowTrigger);
  }
}

const flow = { id: "flow-1", ownerUserId: "owner-1", deletedAt: null } as Flow;

let sequence = 0;
const crypto = {
  generateSecret: () => `secret-${(sequence += 1)}abcd`,
  hashToken: (token: string) => `hash(${token})`,
};

const build = () => {
  const triggers = new InMemoryTriggers();
  const audit: string[] = [];
  const dependencies = {
    flows: { findById: async () => ok(flow) },
    triggers,
    crypto,
    auditLogger: { log: async (entry: { action: string }) => { audit.push(entry.action); return ok(true as const); } },
  };
  return {
    triggers,
    audit,
    configure: new ConfigureWebhookTrigger(dependencies),
    rotate: new RotateWebhookToken(dependencies),
    hmac: new SetWebhookHmac(dependencies),
  };
};

const owner: WebhookActor = { userId: "owner-1", isAdmin: false, canUseWebhooks: true };

describe("ConfigureWebhookTrigger", () => {
  it("issues a token the first time a webhook is enabled, shown this once", async () => {
    const { configure, triggers, audit } = build();

    const result = await configure.execute({ flowId: "flow-1", actor: owner, enabled: true });

    expect(result.data?.token).toMatch(/^wf_wh_secret-/);
    expect(triggers.row?.tokenHash).toBe(`hash(${result.data!.token})`);
    expect(triggers.row?.tokenLastFour).toBe(result.data!.token!.slice(-4));
    expect(triggers.row?.runAsUserId).toBe("owner-1");
    expect(audit).toEqual(["flow_trigger.enabled"]);
  });

  it("does not issue a new token when an existing webhook is re-enabled", async () => {
    const { configure } = build();
    await configure.execute({ flowId: "flow-1", actor: owner, enabled: true });

    const again = await configure.execute({ flowId: "flow-1", actor: owner, enabled: true });

    expect(again.data?.token).toBeNull();
  });

  it("refuses someone without the webhook permission", async () => {
    const { configure } = build();

    const result = await configure.execute({ flowId: "flow-1", actor: { ...owner, canUseWebhooks: false }, enabled: true });

    expect(result.error?.code).toBe("FORBIDDEN");
  });

  it("refuses a Power User on a flow they do not own, but not an admin", async () => {
    const { configure } = build();
    const stranger: WebhookActor = { userId: "someone", isAdmin: false, canUseWebhooks: true };

    expect((await configure.execute({ flowId: "flow-1", actor: stranger, enabled: true })).error?.code).toBe("FORBIDDEN");
    expect(
      (await configure.execute({ flowId: "flow-1", actor: { userId: "admin-1", isAdmin: true, canUseWebhooks: true }, enabled: true })).error,
    ).toBeUndefined();
  });

  it("only lets an admin choose someone else as the run-as user", async () => {
    const { configure, triggers } = build();

    const byOwner = await configure.execute({ flowId: "flow-1", actor: owner, enabled: true, runAsUserId: "someone" });
    expect(byOwner.error?.code).toBe("FORBIDDEN");

    await configure.execute({
      flowId: "flow-1",
      actor: { userId: "admin-1", isAdmin: true, canUseWebhooks: true },
      enabled: true,
      runAsUserId: "someone",
    });
    expect(triggers.row?.runAsUserId).toBe("someone");
  });
});

describe("RotateWebhookToken", () => {
  it("replaces the token so the old one stops working", async () => {
    const { configure, rotate, triggers, audit } = build();
    const first = await configure.execute({ flowId: "flow-1", actor: owner, enabled: true });

    const rotated = await rotate.execute({ flowId: "flow-1", actor: owner });

    expect(rotated.data?.token).not.toBe(first.data?.token);
    expect(triggers.row?.tokenHash).toBe(`hash(${rotated.data!.token})`);
    expect(audit).toContain("flow_trigger.token_rotated");
  });
});

describe("SetWebhookHmac", () => {
  it("returns a new signing secret once when turned on, and clears it when turned off", async () => {
    const { configure, hmac, triggers } = build();
    await configure.execute({ flowId: "flow-1", actor: owner, enabled: true });

    const on = await hmac.execute({ flowId: "flow-1", actor: owner, enabled: true });
    expect(on.data?.secret).toMatch(/^secret-/);
    expect(triggers.row?.secret).toBe(on.data?.secret);

    const off = await hmac.execute({ flowId: "flow-1", actor: owner, enabled: false });
    expect(off.data?.secret).toBeNull();
    expect(triggers.row?.hasHmacSecret).toBe(false);
  });
});
