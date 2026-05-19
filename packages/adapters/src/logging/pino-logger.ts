import type { ILogger } from "@rbrasier/domain";
import pino from "pino";

const createPinoInstance = (isDev: boolean) =>
  pino(
    isDev
      ? {
          transport: {
            target: "pino-pretty",
            options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname" },
          },
        }
      : {},
  );

export class PinoLogger implements ILogger {
  private readonly pino: pino.Logger;

  constructor(isDev = process.env["NODE_ENV"] !== "production") {
    this.pino = createPinoInstance(isDev);
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.pino.debug(meta ?? {}, message);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.pino.info(meta ?? {}, message);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.pino.warn(meta ?? {}, message);
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.pino.error(meta ?? {}, message);
  }

  fatal(message: string, meta?: Record<string, unknown>): void {
    this.pino.fatal(meta ?? {}, message);
  }
}
