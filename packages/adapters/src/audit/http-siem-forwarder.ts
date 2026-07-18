import {
  domainError,
  err,
  isSiemConfigured,
  ok,
  type ILogger,
  type ISiemForwarder,
  type Result,
  type SiemConfig,
  type SiemEvent,
} from "@rbrasier/domain";

// Minimal transport seam so the forwarder is testable without real network I/O.
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number }>;

const toJsonBody = (event: SiemEvent): string =>
  JSON.stringify({
    source: "wayfinder",
    id: event.id,
    sequence: event.sequence,
    time: event.createdAt.toISOString(),
    actorId: event.actorId,
    action: event.action,
    resourceType: event.resourceType,
    resourceId: event.resourceId,
    metadata: event.metadata,
  });

// Minimal ArcSight CEF line. The exact extension mapping is provider-specific
// (ADR-033 leaves it to Build); this covers the common fields a SIEM keys on.
const toCefBody = (event: SiemEvent): string => {
  const extensions = [
    `rt=${event.createdAt.toISOString()}`,
    event.actorId ? `suser=${event.actorId}` : "",
    `act=${event.action}`,
    `cs1Label=resourceType cs1=${event.resourceType}`,
    event.resourceId ? `cs2Label=resourceId cs2=${event.resourceId}` : "",
  ]
    .filter((part) => part.length > 0)
    .join(" ");
  return `CEF:0|Wayfinder|Wayfinder|1|${event.action}|${event.action}|1|${extensions}`;
};

// Best-effort SIEM forwarder (ADR-033 §4). No-op when unconfigured; on a
// configured-but-failing endpoint it logs and returns an error Result the caller
// swallows. It must never throw or block the primary audit write.
export class HttpSiemForwarder implements ISiemForwarder {
  constructor(
    private readonly getConfig: () => Promise<SiemConfig>,
    private readonly logger: ILogger,
    private readonly fetchImpl: FetchLike = (url, init) => fetch(url, init),
  ) {}

  async forward(event: SiemEvent): Promise<Result<true>> {
    let config: SiemConfig;
    try {
      config = await this.getConfig();
    } catch {
      // A config read blip must not fail the audit path.
      return ok(true as const);
    }

    if (!isSiemConfigured(config)) return ok(true as const);

    const isCef = config.format === "cef";
    const headers: Record<string, string> = {
      "content-type": isCef ? "text/plain" : "application/json",
    };
    if (config.token.length > 0) headers.authorization = `Bearer ${config.token}`;

    try {
      const response = await this.fetchImpl(config.endpoint, {
        method: "POST",
        headers,
        body: isCef ? toCefBody(event) : toJsonBody(event),
      });
      if (!response.ok) {
        this.logger.warn("SIEM endpoint returned a non-success status.", {
          status: response.status,
        });
        return err(domainError("INFRA_FAILURE", `SIEM endpoint responded ${response.status}.`));
      }
      return ok(true as const);
    } catch (cause) {
      this.logger.warn("SIEM request failed.", {
        reason: cause instanceof Error ? cause.message : "unknown",
      });
      return err(domainError("INFRA_FAILURE", "SIEM request failed.", cause));
    }
  }
}
