import type { NewSessionUpload, SessionUpload } from "../entities/session-upload";
import type { Result } from "../result";

export interface ISessionUploadRepository {
  create(upload: NewSessionUpload): Promise<Result<SessionUpload>>;
  listBySession(sessionId: string): Promise<Result<SessionUpload[]>>;
  delete(id: string): Promise<Result<void>>;
}
