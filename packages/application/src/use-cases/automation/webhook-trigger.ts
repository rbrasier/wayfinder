import {
  domainError,
  err,
  ok,
  type Flow,
  type FlowTrigger,
  type IAuditLogger,
  type IFlowRepository,
  type IFlowTriggerRepository,
  type Result,
} from "@rbrasier/domain";

// Randomness and hashing for webhook credentials, supplied by the app so this
// layer stays free of runtime crypto imports.
export interface WebhookCrypto {
  // A URL-safe random string of at least 32 bytes of entropy.
  generateSecret: () => string;
  // A stable one-way hash (SHA-256 hex) of a bearer token.
  hashToken: (token: string) => string;
}

// Who is asking, as the router resolved them. `canUseWebhooks` is the
// `flow:webhook_trigger` permission (ADR-064 §3).
export interface WebhookActor {
  userId: string;
  isAdmin: boolean;
  canUseWebhooks: boolean;
}

export interface WebhookTriggerDependencies {
  flows: Pick<IFlowRepository, "findById">;
  triggers: Pick<IFlowTriggerRepository, "findByFlow" | "upsert" | "setToken" | "setHmacSecret">;
  crypto: WebhookCrypto;
  auditLogger: IAuditLogger;
}

export const WEBHOOK_TOKEN_PREFIX = "wf_wh_";

const authorise = async (
  dependencies: WebhookTriggerDependencies,
  flowId: string,
  actor: WebhookActor,
): Promise<Result<Flow>> => {
  if (!actor.isAdmin && !actor.canUseWebhooks) {
    return err(domainError("FORBIDDEN", "You do not have permission to start flows via webhook."));
  }
  const flow = await dependencies.flows.findById(flowId);
  if (flow.error) return flow;
  if (!flow.data || flow.data.deletedAt) return err(domainError("NOT_FOUND", "Flow not found."));
  if (!actor.isAdmin && flow.data.ownerUserId !== actor.userId) {
    return err(domainError("FORBIDDEN", "Only the flow's owner or an admin can manage its webhook."));
  }
  return ok(flow.data);
};

// Issues a fresh token and stores only its hash; the plaintext goes back to the
// caller once and is never readable again.
const issueToken = async (
  dependencies: WebhookTriggerDependencies,
  trigger: FlowTrigger,
): Promise<Result<string>> => {
  const token = `${WEBHOOK_TOKEN_PREFIX}${dependencies.crypto.generateSecret()}`;
  const stored = await dependencies.triggers.setToken(
    trigger.id,
    dependencies.crypto.hashToken(token),
    token.slice(-4),
  );
  return stored.error ? stored : ok(token);
};

const audit = (
  dependencies: WebhookTriggerDependencies,
  actor: WebhookActor,
  action: string,
  trigger: FlowTrigger,
  metadata: Record<string, unknown> = {},
) =>
  dependencies.auditLogger.log({
    actorId: actor.userId,
    action,
    resourceType: "flow_trigger",
    resourceId: trigger.id,
    metadata: { flowId: trigger.flowId, ...metadata },
  });

export interface ConfigureWebhookTriggerInput {
  flowId: string;
  actor: WebhookActor;
  enabled: boolean;
  // Admin-only; anyone else runs the webhook's sessions as themselves.
  runAsUserId?: string;
}

export class ConfigureWebhookTrigger {
  constructor(private readonly dependencies: WebhookTriggerDependencies) {}

  async execute(
    input: ConfigureWebhookTriggerInput,
  ): Promise<Result<{ trigger: FlowTrigger; token: string | null }>> {
    const flow = await authorise(this.dependencies, input.flowId, input.actor);
    if (flow.error) return flow;
    if (input.runAsUserId && input.runAsUserId !== input.actor.userId && !input.actor.isAdmin) {
      return err(domainError("FORBIDDEN", "Only an admin can run a webhook's sessions as someone else."));
    }

    const existing = await this.dependencies.triggers.findByFlow(input.flowId, "webhook");
    if (existing.error) return existing;
    const runAsUserId = input.runAsUserId ?? existing.data?.runAsUserId ?? input.actor.userId;

    const saved = await this.dependencies.triggers.upsert(
      input.flowId,
      "webhook",
      { enabled: input.enabled, runAsUserId },
      input.actor.userId,
    );
    if (saved.error) return saved;
    await audit(this.dependencies, input.actor, input.enabled ? "flow_trigger.enabled" : "flow_trigger.disabled", saved.data, {
      runAsUserId,
    });

    if (!input.enabled || saved.data.tokenLastFour) return ok({ trigger: saved.data, token: null });
    const token = await issueToken(this.dependencies, saved.data);
    if (token.error) return token;
    return ok({ trigger: { ...saved.data, tokenLastFour: token.data.slice(-4) }, token: token.data });
  }
}

export class RotateWebhookToken {
  constructor(private readonly dependencies: WebhookTriggerDependencies) {}

  async execute(input: { flowId: string; actor: WebhookActor }): Promise<Result<{ token: string }>> {
    const flow = await authorise(this.dependencies, input.flowId, input.actor);
    if (flow.error) return flow;
    const trigger = await this.dependencies.triggers.findByFlow(input.flowId, "webhook");
    if (trigger.error) return trigger;
    if (!trigger.data) return err(domainError("NOT_FOUND", "This flow has no webhook yet."));

    const token = await issueToken(this.dependencies, trigger.data);
    if (token.error) return token;
    await audit(this.dependencies, input.actor, "flow_trigger.token_rotated", trigger.data);
    return ok({ token: token.data });
  }
}

export class SetWebhookHmac {
  constructor(private readonly dependencies: WebhookTriggerDependencies) {}

  async execute(input: {
    flowId: string;
    actor: WebhookActor;
    enabled: boolean;
  }): Promise<Result<{ secret: string | null }>> {
    const flow = await authorise(this.dependencies, input.flowId, input.actor);
    if (flow.error) return flow;
    const trigger = await this.dependencies.triggers.findByFlow(input.flowId, "webhook");
    if (trigger.error) return trigger;
    if (!trigger.data) return err(domainError("NOT_FOUND", "This flow has no webhook yet."));

    const secret = input.enabled ? this.dependencies.crypto.generateSecret() : null;
    const saved = await this.dependencies.triggers.setHmacSecret(trigger.data.id, secret);
    if (saved.error) return saved;
    await audit(this.dependencies, input.actor, input.enabled ? "flow_trigger.hmac_enabled" : "flow_trigger.hmac_disabled", trigger.data);
    return ok({ secret });
  }
}
