import type { SystemHealth } from "../entities/system-health";
import type { Result } from "../result";

export interface IHealthChecker {
  check(): Promise<Result<SystemHealth>>;
}
