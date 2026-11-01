import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { Database } from "../db/client";
import { DrizzleFlowTestFixtureRepository } from "./drizzle-flow-test-fixture-repository";

// A fixture can hold real values cloned from a live session, so the ownership
// check has to be part of the query rather than a branch after the fetch — a
// check that runs after loading the row has already loaded it. These tests
// capture the WHERE clause each method builds and assert the creator is in it.
const recorder = (): { db: Database; clauses: SQL[] } => {
  const clauses: SQL[] = [];
  const chain: Record<string, unknown> = {};
  const passthrough = () => chain;

  Object.assign(chain, {
    select: passthrough,
    from: passthrough,
    insert: passthrough,
    values: passthrough,
    update: passthrough,
    set: passthrough,
    delete: passthrough,
    returning: passthrough,
    orderBy: passthrough,
    where: (clause: SQL) => {
      clauses.push(clause);
      return chain;
    },
    then: (resolve: (rows: unknown[]) => unknown) => resolve([]),
  });

  return { db: chain as unknown as Database, clauses };
};

const params = (clauses: SQL[]): unknown[] => {
  const dialect = new PgDialect();
  return clauses.flatMap((clause) => dialect.sqlToQuery(clause).params);
};

describe("DrizzleFlowTestFixtureRepository", () => {
  it("scopes listByFlow to the requesting user, not just the flow", async () => {
    const { db, clauses } = recorder();
    await new DrizzleFlowTestFixtureRepository(db).listByFlow("flow-1", "author-1");

    expect(params(clauses)).toContain("flow-1");
    expect(params(clauses)).toContain("author-1");
  });

  it("scopes findById to the requesting user", async () => {
    const { db, clauses } = recorder();
    await new DrizzleFlowTestFixtureRepository(db).findById("fixture-1", "author-1");

    expect(params(clauses)).toContain("author-1");
  });

  it("scopes update to the requesting user", async () => {
    const { db, clauses } = recorder();
    await new DrizzleFlowTestFixtureRepository(db).update("fixture-1", "author-1", {
      name: "Renamed",
    });

    expect(params(clauses)).toContain("author-1");
  });

  it("scopes delete to the requesting user", async () => {
    const { db, clauses } = recorder();
    await new DrizzleFlowTestFixtureRepository(db).delete("fixture-1", "author-1");

    expect(params(clauses)).toContain("author-1");
  });

  it("reports another user's fixture as not found rather than forbidden", async () => {
    const { db } = recorder();
    const result = await new DrizzleFlowTestFixtureRepository(db).update(
      "fixture-1",
      "someone-else",
      { name: "Renamed" },
    );

    // The recorder returns no rows, which is what a scoped update against
    // someone else's fixture returns from the database.
    expect(result.error?.code).toBe("NOT_FOUND");
  });

  it("reports a delete that matched nothing as not found", async () => {
    const { db } = recorder();
    const result = await new DrizzleFlowTestFixtureRepository(db).delete("fixture-1", "nobody");

    expect(result.error?.code).toBe("NOT_FOUND");
  });
});
