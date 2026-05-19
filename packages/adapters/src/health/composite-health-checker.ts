import type { IHealthChecker, IJobRepository, Result, SystemHealth } from "@rbrasier/domain";
import { ok, err, domainError } from "@rbrasier/domain";
import type { AiHealthChecker } from "./ai-health-checker";
import type { DbHealthChecker } from "./db-health-checker";
import type { RedisHealthChecker } from "./redis-health-checker";

export class CompositeHealthChecker implements IHealthChecker {
  constructor(
    private readonly db: DbHealthChecker,
    private readonly redis: RedisHealthChecker,
    private readonly ai: AiHealthChecker,
    private readonly jobs: IJobRepository,
  ) {}

  async check(): Promise<Result<SystemHealth>> {
    try {
      const [dbStatus, redisStatus, jobsResult] = await Promise.all([
        this.db.check(),
        this.redis.check(),
        this.jobs.list(),
      ]);

      const aiStatus = this.ai.check();

      const jobList = jobsResult.error ? [] : jobsResult.data;
      const worstJobStatus = jobList.some((j) => j.status === "failed")
        ? "failed"
        : jobList.some((j) => j.status === "degraded")
          ? "degraded"
          : "healthy";
      const jobsOk = worstJobStatus !== "failed";

      const jobsStatus = {
        ok: jobsOk,
        jobs: jobList.map((j) => ({ name: j.name, status: j.status, lastRunAt: j.lastRunAt })),
        ...(jobsResult.error && { error: "Could not load job registry" }),
      };

      const allOk = dbStatus.ok && redisStatus.ok && aiStatus.ok && jobsOk;

      return ok({
        ok: allOk,
        timestamp: new Date().toISOString(),
        services: {
          db: dbStatus,
          redis: redisStatus,
          ai: aiStatus,
          jobs: jobsStatus,
        },
      });
    } catch (e) {
      return err(
        domainError("INFRA_FAILURE", "Health check threw unexpectedly.", e),
      );
    }
  }
}
