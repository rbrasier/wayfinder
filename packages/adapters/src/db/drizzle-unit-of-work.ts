import {
  domainError,
  err,
  ok,
  type DomainError,
  type IUnitOfWork,
  type Result,
  type TransactionalRepositories,
} from "@rbrasier/domain";
import type { Database } from "./client";
import { DrizzleSessionRepository } from "../repositories/drizzle-session-repository";
import { DrizzleSessionMessageRepository } from "../repositories/drizzle-session-message-repository";
import { DrizzleApprovalRepository } from "../repositories/drizzle-approval-repository";

// Drizzle only rolls a transaction back when its callback throws, but the
// application layer signals failure with an error Result, never an exception.
// This carries a domain error out of the callback so the rollback fires, then
// `withTransaction` unwraps it back into a Result — the Result-pattern boundary
// stays intact for callers.
class TransactionRollback extends Error {
  constructor(readonly domainError: DomainError) {
    super("transaction rolled back");
  }
}

export class DrizzleUnitOfWork implements IUnitOfWork {
  constructor(private readonly db: Database) {}

  async withTransaction<T>(
    work: (repos: TransactionalRepositories) => Promise<Result<T>>,
  ): Promise<Result<T>> {
    try {
      const data = await this.db.transaction(async (tx) => {
        // The transaction handle exposes the same query interface as the pool,
        // so the repositories run their statements on this connection and commit
        // together. The cast is safe: repositories only use insert/select/
        // update/execute, all present on the transaction.
        const scoped = tx as unknown as Database;
        const repositories: TransactionalRepositories = {
          sessions: new DrizzleSessionRepository(scoped),
          sessionMessages: new DrizzleSessionMessageRepository(scoped),
          approvals: new DrizzleApprovalRepository(scoped),
        };
        const result = await work(repositories);
        if (result.error) throw new TransactionRollback(result.error);
        return result.data;
      });
      return ok(data);
    } catch (cause) {
      if (cause instanceof TransactionRollback) return err(cause.domainError);
      return err(domainError("INFRA_FAILURE", "Transaction failed.", cause));
    }
  }
}
