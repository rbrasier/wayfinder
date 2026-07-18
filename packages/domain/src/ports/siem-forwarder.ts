import type { Result } from "../result";

// The audit event shape delivered to an external SIEM. Mirrors the persisted row
// minus the chain internals, which are meaningless outside Wayfinder.
export interface SiemEvent {
  readonly id: string;
  readonly actorId: string | null;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string | null;
  readonly metadata: Record<string, unknown> | null;
  readonly createdAt: Date;
  readonly sequence: number;
}

// Best-effort forwarder (ADR-033 §4). A no-op when unconfigured; never throws.
// A configured-but-failing endpoint returns an error Result the caller logs and
// swallows — it must never fail the primary audit write.
export interface ISiemForwarder {
  forward(event: SiemEvent): Promise<Result<true>>;
}
