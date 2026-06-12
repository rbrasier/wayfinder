import type {
  NewSessionStepOutput,
  SessionStepOutput,
  StepOutputField,
} from "../entities/session-step-output";
import type { Result } from "../result";

export interface ISessionStepOutputRepository {
  create(input: NewSessionStepOutput): Promise<Result<SessionStepOutput>>;
  listByFlow(flowId: string): Promise<Result<SessionStepOutput[]>>;
  listBySession(sessionId: string): Promise<Result<SessionStepOutput[]>>;
  // The step output captured for a document message, linked by message_id.
  findByMessageId(messageId: string): Promise<Result<SessionStepOutput | null>>;
  // Replace the stored field values for a row (and bump updated_at).
  updateFields(id: string, fields: StepOutputField[]): Promise<Result<SessionStepOutput>>;
}
