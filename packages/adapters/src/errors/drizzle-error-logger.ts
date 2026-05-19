import {
  ok,
  type ErrorLogPayload,
  type IErrorLogRepository,
  type IErrorLogger,
  type Result,
} from "@rbrasier/domain";

/**
 * Writes errors to the `app_error_log` table via IErrorLogRepository.
 * Never throws — if persistence itself fails, falls back to console.error
 * so the original failure path is never blocked by a logger failure.
 */
export class DrizzleErrorLogger implements IErrorLogger {
  constructor(private readonly repo: IErrorLogRepository) {}

  async log(payload: ErrorLogPayload): Promise<Result<true>> {
    const result = await this.repo.create({
      level: payload.level,
      message: payload.message,
      stack: payload.stack ?? null,
      userId: payload.userId ?? null,
      page: payload.page ?? null,
      metadata: payload.metadata ?? null,
    });
    if (result.error) {
      // eslint-disable-next-line no-console
      console.error("[DrizzleErrorLogger] failed to persist:", payload.message, result.error);
    }
    return ok(true as const);
  }
}
