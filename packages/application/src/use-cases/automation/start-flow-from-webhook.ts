import { ok, type IAuditLogger, type IFlowTriggerRepository, type Result } from "@rbrasier/domain";
import type { StartUnattendedRun } from "./start-unattended-run";

export interface WebhookVerification {
  hashToken: (token: string) => string;
  // Constant-time comparison, so a caller cannot learn a hash byte by byte.
  hashesMatch: (left: string, right: string) => boolean;
  verifySignature: (secret: string, rawBody: string, signature: string) => boolean;
}

export interface StartFlowFromWebhookDependencies {
  triggers: Pick<IFlowTriggerRepository, "findByFlow" | "getTokenHash" | "getHmacSecret" | "markTriggered">;
  crypto: WebhookVerification;
  startUnattendedRun: Pick<StartUnattendedRun, "execute">;
  auditLogger: IAuditLogger;
  now: () => Date;
}

export interface StartFlowFromWebhookInput {
  flowId: string;
  token: string | null;
  signature: string | null;
  rawBody: string;
  body: unknown;
}

export type StartFlowFromWebhookOutput =
  | { outcome: "started"; sessionId: string }
  | { outcome: "not_found" }
  | { outcome: "unauthorized" }
  | { outcome: "invalid"; message: string };

// `{ "inputs": { … } }` is the documented shape; a plain object of inputs is
// accepted too, because low-code callers rarely nest.
const inputsOf = (body: unknown): unknown => {
  if (typeof body === "object" && body !== null && "inputs" in body) {
    return (body as { inputs: unknown }).inputs;
  }
  return body;
};

// An outside system starting a flow through its webhook (ADR-064 §3). Unknown,
// disabled or unpublished flows all answer "not found" so the address reveals
// nothing about whether a flow exists. Does not drive the run; the route kicks
// AdvanceUnattendedRun after answering.
export class StartFlowFromWebhook {
  constructor(private readonly dependencies: StartFlowFromWebhookDependencies) {}

  async execute(input: StartFlowFromWebhookInput): Promise<Result<StartFlowFromWebhookOutput>> {
    const trigger = await this.dependencies.triggers.findByFlow(input.flowId, "webhook");
    if (trigger.error) return trigger;
    if (!trigger.data || !trigger.data.enabled || !trigger.data.runAsUserId) return ok({ outcome: "not_found" });

    const authorised = await this.authorised(trigger.data.id, trigger.data.hasHmacSecret, input);
    if (authorised.error) return authorised;
    if (!authorised.data) return ok({ outcome: "unauthorized" });

    const started = await this.dependencies.startUnattendedRun.execute({
      flowId: input.flowId,
      runAsUserId: trigger.data.runAsUserId,
      origin: "webhook",
      triggerSourceId: trigger.data.id,
      sourceName: null,
      inputs: inputsOf(input.body),
      raw: input.body,
    });
    if (started.error) return started;
    if (!started.data.started) {
      if (started.data.reason === "invalid_inputs") return ok({ outcome: "invalid", message: started.data.message });
      return ok({ outcome: "not_found" });
    }

    await this.dependencies.triggers.markTriggered(trigger.data.id, this.dependencies.now());
    await this.dependencies.auditLogger.log({
      actorId: trigger.data.runAsUserId,
      action: "flow_trigger.fired",
      resourceType: "session",
      resourceId: started.data.session.id,
      metadata: { flowId: input.flowId, triggerId: trigger.data.id },
    });
    return ok({ outcome: "started", sessionId: started.data.session.id });
  }

  private async authorised(
    triggerId: string,
    requiresSignature: boolean,
    input: StartFlowFromWebhookInput,
  ): Promise<Result<boolean>> {
    if (!input.token) return ok(false);
    const stored = await this.dependencies.triggers.getTokenHash(triggerId);
    if (stored.error) return stored;
    if (!stored.data || !this.dependencies.crypto.hashesMatch(this.dependencies.crypto.hashToken(input.token), stored.data)) {
      return ok(false);
    }
    if (!requiresSignature) return ok(true);

    const secret = await this.dependencies.triggers.getHmacSecret(triggerId);
    if (secret.error) return secret;
    if (!secret.data || !input.signature) return ok(false);
    return ok(this.dependencies.crypto.verifySignature(secret.data, input.rawBody, input.signature));
  }
}
