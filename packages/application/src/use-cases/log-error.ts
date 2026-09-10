import {
  type ErrorLogPayload,
  type IErrorLogger,
  type Result,
} from "@wayfinder/domain";

export class LogError {
  constructor(private readonly logger: IErrorLogger) {}

  execute(payload: ErrorLogPayload): Promise<Result<true>> {
    return this.logger.log(payload);
  }
}
