import type { IErrorLogRepository, Result } from "@rbrasier/domain";

export class DeleteAllErrors {
  constructor(private readonly repo: IErrorLogRepository) {}

  execute(): Promise<Result<number>> {
    return this.repo.deleteAll();
  }
}
