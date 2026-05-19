export type JobStatus = "healthy" | "degraded" | "failed" | "unknown";

export interface Job {
  readonly id: string;
  readonly name: string;
  readonly status: JobStatus;
  readonly lastRunAt: Date | null;
  readonly nextRunAt: Date | null;
  readonly errorCount: number;
  readonly lastError: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
