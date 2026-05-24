import {
  ok,
  type ErrorLogPayload,
  type IErrorLogRepository,
  type IErrorLogger,
  type Result,
} from "@rbrasier/domain";

const formatPayload = (payload: ErrorLogPayload): string => {
  const parts: string[] = [];
  if (payload.page) parts.push(`[${payload.page}]`);
  parts.push(payload.message);
  if (payload.metadata && Object.keys(payload.metadata).length > 0) {
    parts.push(`metadata=${JSON.stringify(payload.metadata)}`);
  }
  if (payload.stack) parts.push(`\n${payload.stack}`);
  return parts.join(" ");
};

const mirrorToConsole = (payload: ErrorLogPayload): void => {
  const line = `[errorLogger:${payload.level}] ${formatPayload(payload)}`;
  if (payload.level === "warn") {
    console.warn(line);
    return;
  }
  console.error(line);
};

export class DrizzleErrorLogger implements IErrorLogger {
  constructor(private readonly repo: IErrorLogRepository) {}

  async log(payload: ErrorLogPayload): Promise<Result<true>> {
    mirrorToConsole(payload);

    const result = await this.repo.create({
      level: payload.level,
      message: payload.message,
      stack: payload.stack ?? null,
      userId: payload.userId ?? null,
      page: payload.page ?? null,
      metadata: payload.metadata ?? null,
    });
    if (result.error) {
      console.error("[errorLogger:persist-failed]", payload.message, result.error);
    }
    return ok(true as const);
  }
}
