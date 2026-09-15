import type { IErrorLogRepository, Result } from "@wayfinder/domain";

export class DeleteAllErrors {
  constructor(private readonly repo: IErrorLogRepository) {}

  execute(): Promise<Result<number>> {
    return this.repo.deleteAll();
  }
}
