import type { FlowTrigger, FlowTriggerKind } from "../entities/flow-trigger";
import type { Result } from "../result";

export interface FlowTriggerSettings {
  enabled: boolean;
  runAsUserId: string | null;
}

// A flow's inbound start addresses (ADR-064 §3). The token is only ever stored
// as a hash and the HMAC secret only encrypted; neither appears on FlowTrigger.
export interface IFlowTriggerRepository {
  findByFlow(flowId: string, kind: FlowTriggerKind): Promise<Result<FlowTrigger | null>>;
  findByTokenHash(tokenHash: string): Promise<Result<FlowTrigger | null>>;
  // Creates the row on first use; later calls change only the given settings.
  upsert(
    flowId: string,
    kind: FlowTriggerKind,
    settings: FlowTriggerSettings,
    createdBy: string,
  ): Promise<Result<FlowTrigger>>;
  setToken(triggerId: string, tokenHash: string, tokenLastFour: string): Promise<Result<FlowTrigger>>;
  // Plaintext in, encrypted at rest; null turns HMAC off.
  setHmacSecret(triggerId: string, secret: string | null): Promise<Result<FlowTrigger>>;
  getHmacSecret(triggerId: string): Promise<Result<string | null>>;
  markTriggered(triggerId: string, at: Date): Promise<Result<void>>;
}
