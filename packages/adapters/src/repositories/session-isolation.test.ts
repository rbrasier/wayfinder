import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { Database } from "../db/client";
import { DrizzleAnalyticsRepository } from "./drizzle-analytics-repository";
import { DrizzleApprovalRepository } from "./drizzle-approval-repository";
import { DrizzleScheduleRunRepository } from "./drizzle-schedule-run-repository";
import { DrizzleSessionRepository } from "./drizzle-session-repository";
import { DrizzleSessionStepOutputRepository } from "./drizzle-session-step-output-repository";

// The isolation predicate is this feature's principal risk: a missed read path
// leaks an author's experiments into a customer's reporting (ADR-048 §4). These
// repositories run against a live database, so — as with the turn lease and the
// retention sweep — the guard here is the generated SQL. A recorder stands in
// for the driver, captures the WHERE clause each method actually builds, and the
// clause is rendered and inspected. That proves the predicate reaches the query,
// not merely that a helper exists.
interface Recorder {
  db: Database;
  clauses: SQL[];
}

const recorder = (): Recorder => {
  const clauses: SQL[] = [];
  const chain: Record<string, unknown> = {};
  const passthrough = () => chain;

  Object.assign(chain, {
    select: passthrough,
    from: passthrough,
    innerJoin: passthrough,
    leftJoin: passthrough,
    orderBy: passthrough,
    limit: passthrough,
    groupBy: passthrough,
    where: (clause: SQL) => {
      clauses.push(clause);
      return chain;
    },
    // Awaiting the builder resolves to no rows; these tests are about the query,
    // not about mapping results.
    then: (resolve: (rows: unknown[]) => unknown) => resolve([]),
  });

  return { db: chain as unknown as Database, clauses };
};

const rendered = (clauses: SQL[]): string => {
  const dialect = new PgDialect();
  return clauses.map((clause) => dialect.sqlToQuery(clause).sql).join(" ");
};

const params = (clauses: SQL[]): unknown[] => {
  const dialect = new PgDialect();
  return clauses.flatMap((clause) => dialect.sqlToQuery(clause).params);
};

const expectExcludesTestSessions = (clauses: SQL[]): void => {
  expect(clauses.length).toBeGreaterThan(0);
  expect(rendered(clauses)).toContain('"mode"');
  expect(params(clauses)).toContain("live");
};

describe("session isolation — DrizzleSessionRepository", () => {
  it("excludes test sessions from listByUser", async () => {
    const { db, clauses } = recorder();
    await new DrizzleSessionRepository(db).listByUser("user-1");
    expectExcludesTestSessions(clauses);
  });

  it("excludes test sessions from listAll", async () => {
    const { db, clauses } = recorder();
    await new DrizzleSessionRepository(db).listAll();
    expectExcludesTestSessions(clauses);
  });

  it("excludes test sessions from listByUserPage", async () => {
    const { db, clauses } = recorder();
    await new DrizzleSessionRepository(db).listByUserPage("user-1", { limit: 20 });
    expectExcludesTestSessions(clauses);
  });

  it("excludes test sessions from listAllPage", async () => {
    const { db, clauses } = recorder();
    await new DrizzleSessionRepository(db).listAllPage({ limit: 20 });
    expectExcludesTestSessions(clauses);
  });

  it("lists test sessions only when a caller asks for them explicitly", async () => {
    const { db, clauses } = recorder();
    await new DrizzleSessionRepository(db).listByUser("user-1", "test");

    expect(params(clauses)).toContain("test");
    expect(params(clauses)).not.toContain("live");
  });

  it("keeps the cursor predicate alongside the mode predicate when paging", async () => {
    const { db, clauses } = recorder();
    await new DrizzleSessionRepository(db).listAllPage({
      limit: 20,
      cursor: "2026-01-01T00:00:00.000Z_session-9",
    });

    expectExcludesTestSessions(clauses);
    expect(params(clauses)).toContain("session-9");
  });
});

describe("session isolation — DrizzleAnalyticsRepository", () => {
  const range = { start: new Date("2026-01-01T00:00:00Z"), end: new Date("2026-02-01T00:00:00Z") };

  it("excludes test sessions from listSessions", async () => {
    const { db, clauses } = recorder();
    await new DrizzleAnalyticsRepository(db).listSessions(range);
    expectExcludesTestSessions(clauses);
  });

  it("excludes test sessions from listSessionsByFlow", async () => {
    const { db, clauses } = recorder();
    await new DrizzleAnalyticsRepository(db).listSessionsByFlow("flow-1");
    expectExcludesTestSessions(clauses);
  });

  it("excludes test sessions from listMessagesByFlow", async () => {
    const { db, clauses } = recorder();
    await new DrizzleAnalyticsRepository(db).listMessagesByFlow("flow-1");
    expectExcludesTestSessions(clauses);
  });

  // This one read app_session_messages with no session join at all. The seed
  // materialises synthetic assistant messages, so before the join was added every
  // dashboard fed by it counted them.
  it("excludes test sessions from listAssistantMessages", async () => {
    const { db, clauses } = recorder();
    await new DrizzleAnalyticsRepository(db).listAssistantMessages(range);
    expectExcludesTestSessions(clauses);
  });

  // Arrived on the release line, where test mode does not exist, so it was
  // written without the join the rest of this class carries.
  it("excludes test sessions from listAllMessages", async () => {
    const { db, clauses } = recorder();
    await new DrizzleAnalyticsRepository(db).listAllMessages(range);
    expectExcludesTestSessions(clauses);
  });
});

describe("session isolation — DrizzleSessionStepOutputRepository", () => {
  // Filtered on flow_id alone and fed GetFlowDeepDive's field report, so a seed's
  // invented values were counted as values a real operator gave.
  it("excludes test sessions from listByFlow", async () => {
    const { db, clauses } = recorder();
    await new DrizzleSessionStepOutputRepository(db).listByFlow("flow-1");
    expectExcludesTestSessions(clauses);
  });

  it("still returns a test session's own step outputs by session id", async () => {
    const { db, clauses } = recorder();
    await new DrizzleSessionStepOutputRepository(db).listBySession("session-1");

    // The modal reads its own run back through this path, so it must not filter.
    expect(params(clauses)).not.toContain("live");
  });
});

describe("session isolation — DrizzleApprovalRepository", () => {
  it("excludes test sessions from the pending approver queue", async () => {
    const { db, clauses } = recorder();
    await new DrizzleApprovalRepository(db).listPendingForApprover({
      approverUserId: "approver-1",
      groupIds: [],
    });
    expectExcludesTestSessions(clauses);
  });

  it("excludes test sessions from the approver's combined list", async () => {
    const { db, clauses } = recorder();
    await new DrizzleApprovalRepository(db).listForApprover({
      approverUserId: "approver-1",
      groupIds: [],
      scope: "all",
    });
    expectExcludesTestSessions(clauses);
  });
});

describe("session isolation — DrizzleScheduleRunRepository", () => {
  it("excludes test sessions from the admin-facing run history", async () => {
    const { db, clauses } = recorder();
    await new DrizzleScheduleRunRepository(db).listRecent(50);
    expectExcludesTestSessions(clauses);
  });
});
