import type { IApprovalRepository } from "./approval-repository";
import type { ISessionMessageRepository } from "./session-message-repository";
import type { ISessionRepository } from "./session-repository";
import type { Result } from "../result";

// Repositories bound to a single transaction. A use case that writes more than
// once takes these from `IUnitOfWork.withTransaction` so its writes commit or
// roll back together rather than leaving a half-applied change. Grow this set as
// more multi-write use cases are wrapped.
export interface TransactionalRepositories {
  sessions: ISessionRepository;
  sessionMessages: ISessionMessageRepository;
  approvals: IApprovalRepository;
}

export interface IUnitOfWork {
  // Runs `work` inside a transaction. Nothing commits unless `work` returns a
  // success Result: an error Result rolls back and is returned as-is, and a
  // thrown exception rolls back and is returned as an INFRA_FAILURE. Keeps the
  // application layer free of any ORM — it sees only ports.
  withTransaction<T>(
    work: (repos: TransactionalRepositories) => Promise<Result<T>>,
  ): Promise<Result<T>>;
}
