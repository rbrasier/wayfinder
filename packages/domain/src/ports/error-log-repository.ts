import type {
  ErrorLog,
  ErrorLogFilter,
  ErrorLogGroup,
  ErrorLogStatus,
  NewErrorLog,
} from "../entities/error-log";
import type { Result } from "../result";

export interface IErrorLogRepository {
  create(input: NewErrorLog): Promise<Result<ErrorLog>>;
  list(filter?: ErrorLogFilter): Promise<Result<ErrorLog[]>>;
  listGrouped(filter?: ErrorLogFilter): Promise<Result<ErrorLogGroup[]>>;
  listByGroup(message: string, page: string | null): Promise<Result<ErrorLog[]>>;
  updateStatus(id: string, status: ErrorLogStatus): Promise<Result<ErrorLog>>;
  updateGroupStatus(
    message: string,
    page: string | null,
    status: ErrorLogStatus,
  ): Promise<Result<number>>;
}
