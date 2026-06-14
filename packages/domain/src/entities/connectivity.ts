// A live "is this integration actually reachable with the saved credentials?"
// probe result. Distinct from system-health (ServiceStatus): connectivity is an
// on-demand admin action per external dependency, not a passive health summary.

export type ConnectivityTarget =
  | "ai"
  | "storage"
  | "email"
  | "n8n"
  | "embeddings"
  | "entra";

export const CONNECTIVITY_TARGETS: readonly ConnectivityTarget[] = [
  "ai",
  "storage",
  "email",
  "n8n",
  "embeddings",
  "entra",
];

export interface ConnectivityResult {
  readonly target: ConnectivityTarget;
  readonly ok: boolean;
  // Round-trip time of the live probe, omitted when the probe never ran.
  readonly latencyMs?: number;
  // Sanitised, human-readable reason on failure (e.g. "401 Unauthorized") or a
  // short note on success/skip. Never contains secret material.
  readonly message?: string;
  // True when the target has no usable configuration, so no live probe was made.
  readonly skipped?: boolean;
}
