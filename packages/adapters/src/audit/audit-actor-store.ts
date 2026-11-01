import { AsyncLocalStorage } from "node:async_hooks";
import type { AuditActorContext } from "@wayfinder/domain";

// The request-scoped actor behind every audit write (ADR-060 §3).
//
// The audit logger is built once in a process-wide container, and the use cases
// that call it are constructed at boot with it already bound — so there is no
// parameter to thread an impersonator through without touching every use case.
// AsyncLocalStorage propagates through awaits and is isolated per async context,
// so two overlapping requests cannot see each other's actor.
//
// Attribution only. Nothing that makes an authorisation decision may read this
// (ADR-060 §6), and nothing outside the audit logger should read it at all.
const store = new AsyncLocalStorage<AuditActorContext>();

export const runWithAuditActor = <T>(
  context: AuditActorContext,
  fn: () => Promise<T>,
): Promise<T> => store.run(context, fn);

// Null outside any scope — a background job, a webhook, a migration. That means
// "acted as themselves", never an error (ADR-060 §4).
export const currentAuditActor = (): AuditActorContext | null => store.getStore() ?? null;

/**
 * Merges the ambient impersonator into an audit payload's metadata.
 *
 * An explicit `impersonatorId` on the payload wins and is left alone, so the
 * `impersonation.started` / `stopped` / `extended` rows — whose actor is already
 * the admin — do not get stamped as impersonating themselves (ADR-060 §5).
 */
export const withImpersonationMetadata = (
  metadata: Record<string, unknown> | null,
  actor: AuditActorContext | null,
): Record<string, unknown> | null => {
  if (!actor?.impersonatorId) return metadata;
  if (metadata && "impersonatorId" in metadata) return metadata;

  return { ...(metadata ?? {}), impersonated: true, impersonatorId: actor.impersonatorId };
};
