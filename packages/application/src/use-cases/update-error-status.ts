import {
  type ErrorLog,
  type ErrorLogStatus,
  type IErrorLogRepository,
  type Result,
  domainError,
  err,
} from "@rbrasier/domain";

export class UpdateErrorStatus {
  constructor(private readonly repo: IErrorLogRepository) {}

  byId(id: string, status: ErrorLogStatus): Promise<Result<ErrorLog>> {
    return this.repo.updateStatus(id, status);
  }

  byGroup(
    message: string,
    page: string | null,
    status: ErrorLogStatus,
  ): Promise<Result<number>> {
    if (!message) {
      return Promise.resolve(
        err(domainError("VALIDATION_FAILED", "message is required for group status update.")),
      );
    }
    return this.repo.updateGroupStatus(message, page, status);
  }
}
