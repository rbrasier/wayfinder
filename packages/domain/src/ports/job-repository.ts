import type { Job } from "../entities/job";
import type { Result } from "../result";

export interface IJobRepository {
  register(name: string): Promise<Result<Job>>;
  ping(name: string, nextRunAt?: Date): Promise<Result<Job>>;
  fail(name: string, error: string): Promise<Result<Job>>;
  list(): Promise<Result<Job[]>>;
}
