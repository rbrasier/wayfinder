import type { IHealthChecker, Result, SystemHealth } from "@rbrasier/domain";

export class GetSystemHealth {
  constructor(private readonly checker: IHealthChecker) {}

  execute(): Promise<Result<SystemHealth>> {
    return this.checker.check();
  }
}
