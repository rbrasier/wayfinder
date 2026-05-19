import {
  domainError,
  err,
  ok,
  type IJobRepository,
  type Job,
  type Result,
} from "@rbrasier/domain";
import { eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { job_registry } from "../db/schema/job";

const toEntity = (row: typeof job_registry.$inferSelect): Job => ({
  id: row.id,
  name: row.name,
  status: row.status,
  lastRunAt: row.last_run_at,
  nextRunAt: row.next_run_at,
  errorCount: row.error_count,
  lastError: row.last_error,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class DrizzleJobRepository implements IJobRepository {
  constructor(private readonly db: Database) {}

  async register(name: string): Promise<Result<Job>> {
    try {
      const [row] = await this.db
        .insert(job_registry)
        .values({ name, status: "unknown" })
        .onConflictDoNothing()
        .returning();
      if (!row) {
        const existing = await this.db
          .select()
          .from(job_registry)
          .where(eq(job_registry.name, name))
          .limit(1);
        if (!existing[0]) return err(domainError("INFRA_FAILURE", "Job register failed."));
        return ok(toEntity(existing[0]));
      }
      return ok(toEntity(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to register job.", cause));
    }
  }

  async ping(name: string, nextRunAt?: Date): Promise<Result<Job>> {
    try {
      const [row] = await this.db
        .update(job_registry)
        .set({
          status: "healthy",
          last_run_at: new Date(),
          next_run_at: nextRunAt ?? null,
          error_count: 0,
          last_error: null,
          updated_at: new Date(),
        })
        .where(eq(job_registry.name, name))
        .returning();
      if (!row) return err(domainError("NOT_FOUND", `Job '${name}' not found.`));
      return ok(toEntity(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to ping job.", cause));
    }
  }

  async fail(name: string, error: string): Promise<Result<Job>> {
    try {
      const current = await this.db
        .select({ errorCount: job_registry.error_count })
        .from(job_registry)
        .where(eq(job_registry.name, name))
        .limit(1);
      const prevCount = current[0]?.errorCount ?? 0;

      const [row] = await this.db
        .update(job_registry)
        .set({
          status: "failed",
          last_run_at: new Date(),
          last_error: error,
          error_count: prevCount + 1,
          updated_at: new Date(),
        })
        .where(eq(job_registry.name, name))
        .returning();
      if (!row) return err(domainError("NOT_FOUND", `Job '${name}' not found.`));
      return ok(toEntity(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to mark job as failed.", cause));
    }
  }

  async list(): Promise<Result<Job[]>> {
    try {
      const rows = await this.db.select().from(job_registry);
      return ok(rows.map(toEntity));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to list jobs.", cause));
    }
  }
}
