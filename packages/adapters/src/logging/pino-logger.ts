import { createRequire } from "module";
import path from "node:path";
import type { ILogger } from "@rbrasier/domain";
import pino from "pino";

const createPinoInstance = (isDev: boolean): pino.Logger => {
  if (!isDev) {
    return pino();
  }

  try {
    // pino's transport target mechanism resolves module names via the call-stack
    // file paths, which are webpack chunk paths in Next.js — not resolvable.
    // Using pino-pretty as a synchronous stream (required from process.cwd())
    // sidesteps worker threads and the bundled-path resolution problem entirely.
    const _require = createRequire(path.join(process.cwd(), "index.js"));
    const pretty = _require("pino-pretty") as (opts: Record<string, unknown>) => pino.DestinationStream;
    return pino(pretty({ colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname" }));
  } catch {
    return pino();
  }
};

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
