import { describe, expect, it } from "vitest";
import { domainError, err, ok } from "@rbrasier/domain";
import { DrizzleUnitOfWork } from "./drizzle-unit-of-work";
import type { Database } from "./client";

// A stand-in for the drizzle pool that mimics the one behaviour withTransaction
// depends on: the callback runs, and if it throws the transaction rolls back and
// the error propagates. `rolledBack` records whether a rollback fired so the
// tests can prove the error path actually aborts the transaction.
const makeFakeDatabase = () => {
  const state = { rolledBack: false };
  const db = {
    transaction: async <T>(callback: (tx: unknown) => Promise<T>): Promise<T> => {
      try {
        return await callback({});
      } catch (cause) {
        state.rolledBack = true;
        throw cause;
      }
    },
  } as unknown as Database;
  return { db, state };
};

describe("DrizzleUnitOfWork", () => {
  it("commits and returns the data when the work succeeds", async () => {
    const { db, state } = makeFakeDatabase();
    const unitOfWork = new DrizzleUnitOfWork(db);

    const result = await unitOfWork.withTransaction(async () => ok("done"));

    expect(result.error).toBeUndefined();
    expect(result.data).toBe("done");
    expect(state.rolledBack).toBe(false);
  });

  it("rolls back and returns the domain error when the work returns an error", async () => {
    const { db, state } = makeFakeDatabase();
    const unitOfWork = new DrizzleUnitOfWork(db);

    const result = await unitOfWork.withTransaction(async () =>
      err(domainError("VALIDATION_FAILED", "nope")),
    );

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    // The failing Result must abort the transaction, not silently commit.
    expect(state.rolledBack).toBe(true);
  });

  it("rolls back and reports INFRA_FAILURE when the work throws", async () => {
    const { db, state } = makeFakeDatabase();
    const unitOfWork = new DrizzleUnitOfWork(db);

    const result = await unitOfWork.withTransaction(async () => {
      throw new Error("boom");
    });

    expect(result.error?.code).toBe("INFRA_FAILURE");
    expect(state.rolledBack).toBe(true);
  });
});
