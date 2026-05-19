import type { IJobRepository, Job, Result } from "@rbrasier/domain";

export class RegisterJob {
  constructor(private readonly repo: IJobRepository) {}

  execute(name: string): Promise<Result<Job>> {
    return this.repo.register(name);
  }
}

export class PingJob {
  constructor(private readonly repo: IJobRepository) {}

  execute(name: string, nextRunAt?: Date): Promise<Result<Job>> {
    return this.repo.ping(name, nextRunAt);
  }
}

export class FailJob {
  constructor(private readonly repo: IJobRepository) {}

  execute(name: string, error: string): Promise<Result<Job>> {
    return this.repo.fail(name, error);
  }
}

export class ListJobs {
  constructor(private readonly repo: IJobRepository) {}

  execute(): Promise<Result<Job[]>> {
    return this.repo.list();
  }
}
