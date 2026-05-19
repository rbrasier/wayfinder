import {
  type ErrorLog,
  type ErrorLogFilter,
  type ErrorLogGroup,
  type IErrorLogRepository,
  type Result,
} from "@rbrasier/domain";

export class ListErrors {
  constructor(private readonly repo: IErrorLogRepository) {}

  listGrouped(filter?: ErrorLogFilter): Promise<Result<ErrorLogGroup[]>> {
    return this.repo.listGrouped(filter);
  }

  listInGroup(message: string, page: string | null): Promise<Result<ErrorLog[]>> {
    return this.repo.listByGroup(message, page);
  }
}
