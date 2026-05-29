import type { NewSessionStepOutput, SessionStepOutput } from "../entities/session-step-output";
import type { Result } from "../result";

export interface ISessionStepOutputRepository {
  create(input: NewSessionStepOutput): Promise<Result<SessionStepOutput>>;
  listByFlow(flowId: string): Promise<Result<SessionStepOutput[]>>;
}
