import type { FlowNodeType } from "./flow-node";
import type { SessionOrigin, SessionRunError, SessionStatus } from "./session";

// What run history shows for an unattended session (ADR-065 §5). Derived on
// read, never stored, so it cannot drift from the session it describes.
export type UnattendedRunStatus =
  | "running"
  | "waiting_on_person"
  | "failed"
  | "completed"
  | "cancelled"
  | "abandoned";

export interface DeriveRunStatusInput {
  sessionStatus: SessionStatus;
  runError: SessionRunError | null | undefined;
  currentNodeType: FlowNodeType | null;
  // An AI task whose result is with a reviewer.
  hasPendingReview: boolean;
}

const HUMAN_NODE_TYPES: readonly FlowNodeType[] = ["conversational", "approval"];

export const deriveRunStatus = (input: DeriveRunStatusInput): UnattendedRunStatus => {
  if (input.sessionStatus === "complete") return "completed";
  if (input.sessionStatus === "cancelled") return "cancelled";
  if (input.sessionStatus === "abandoned") return "abandoned";
  if (input.runError) return "failed";
  if (input.hasPendingReview) return "waiting_on_person";
  if (input.currentNodeType && HUMAN_NODE_TYPES.includes(input.currentNodeType)) {
    return "waiting_on_person";
  }
  return "running";
};

export const isUnattendedOrigin = (origin: SessionOrigin | undefined): boolean =>
  origin === "watch" || origin === "webhook";
