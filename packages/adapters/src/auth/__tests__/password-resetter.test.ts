/**
 * Cover for administrator-initiated password reset.
 *
 * The credential row has to land in exactly the shape Better Auth's sign-in
 * reads, hashed by the provider's own hasher — anything else produces a row
 * that looks right and never authenticates. Sessions are cleared in the same
 * transaction, because a reset that leaves the user signed in somewhere has not
 * actually taken their access away.
 *
 * Distinct from break-glass recovery in one respect these tests pin: this path
 * must never touch the stored auth config.
 */

import { describe, expect, it } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { Database } from "../../db/client";
import { core_accounts, core_sessions } from "../../db/schema/core";
import type { Auth } from "../better-auth";
import { CREDENTIAL_PROVIDER_ID } from "../entra-precedence";
import { BetterAuthPasswordResetter } from "../password-resetter";

const USER_ID = "9c2f0a10-0000-4000-8000-0000000000aa";

interface RecordedDelete {
  readonly kind: "delete";
  readonly table: unknown;
  readonly condition: SQL;
}

interface RecordedInsert {
  readonly kind: "insert";
  readonly table: unknown;
  readonly row: Record<string, unknown>;
}

type RecordedWrite = RecordedDelete | RecordedInsert;

interface RecordingDatabase {
  readonly database: Database;
  readonly writes: RecordedWrite[];
  readonly transactions: number;
}

// Sessions are deleted with RETURNING so the count is driver-independent; the
// fake hands back one row per id it is seeded with.
const makeRecordingDatabase = (sessionIds: string[] = []): RecordingDatabase => {
  const writes: RecordedWrite[] = [];
  const state = { transactions: 0 };

  const recorder = {
    delete: (table: unknown) => ({
      where: (condition: SQL) => {
        const record = (): void => {
          writes.push({ kind: "delete", table, condition });
        };
        const rows = table === core_sessions ? sessionIds.map((id) => ({ id })) : [];
        return {
          returning: async (): Promise<{ id: string }[]> => {
            record();
            return rows;
          },
          then: (resolve: (value: unknown) => unknown) => {
            record();
            return Promise.resolve(resolve(undefined));
          },
        };
      },
    }),
    insert: (table: unknown) => ({
      values: async (row: Record<string, unknown>): Promise<void> => {
        writes.push({ kind: "insert", table, row });
      },
    }),
  };

  const database = {
    ...recorder,
    transaction: async <T>(callback: (tx: unknown) => Promise<T>): Promise<T> => {
      state.transactions += 1;
      return callback(recorder);
    },
  };

  return {
    database: database as unknown as Database,
    writes,
    get transactions() {
      return state.transactions;
    },
  };
};

const renderCondition = (condition: SQL): { sql: string; params: unknown[] } => {
  const query = new PgDialect().sqlToQuery(condition);
  return { sql: query.sql, params: query.params };
};

const makeAuth = (
  hash: (password: string) => Promise<string> = async (password) => `hashed:${password}`,
): { getAuth: () => Promise<Auth>; hashed: string[] } => {
  const hashed: string[] = [];
  const auth = {
    handler: async () => new Response(),
    api: {},
    $context: Promise.resolve({
      password: {
        hash: async (password: string): Promise<string> => {
          hashed.push(password);
          return hash(password);
        },
      },
    }),
  } as unknown as Auth;
  return { getAuth: async () => auth, hashed };
};

describe("BetterAuthPasswordResetter", () => {
  it("hashes the new password with the provider's own hasher", async () => {
    const { database } = makeRecordingDatabase();
    const { getAuth, hashed } = makeAuth();
    const resetter = new BetterAuthPasswordResetter({ database, getAuth });

    await resetter.resetPassword({ userId: USER_ID, password: "a-new-password" });

    expect(hashed).toEqual(["a-new-password"]);
  });

  it("replaces the credential row in the shape sign-in reads", async () => {
    const { database, writes } = makeRecordingDatabase();
    const { getAuth } = makeAuth();
    const resetter = new BetterAuthPasswordResetter({ database, getAuth });

    await resetter.resetPassword({ userId: USER_ID, password: "a-new-password" });

    const inserted = writes.find((write) => write.kind === "insert");
    expect(inserted).toBeDefined();
    expect(inserted?.table).toBe(core_accounts);
    expect((inserted as RecordedInsert).row).toEqual({
      user_id: USER_ID,
      account_id: USER_ID,
      provider_id: CREDENTIAL_PROVIDER_ID,
      password: "hashed:a-new-password",
    });
  });

  it("deletes the existing credential row before inserting the replacement", async () => {
    const { database, writes } = makeRecordingDatabase();
    const { getAuth } = makeAuth();
    const resetter = new BetterAuthPasswordResetter({ database, getAuth });

    await resetter.resetPassword({ userId: USER_ID, password: "a-new-password" });

    const credentialDelete = writes.findIndex(
      (write) => write.kind === "delete" && write.table === core_accounts,
    );
    const credentialInsert = writes.findIndex((write) => write.kind === "insert");
    expect(credentialDelete).toBeGreaterThanOrEqual(0);
    expect(credentialDelete).toBeLessThan(credentialInsert);

    const condition = renderCondition((writes[credentialDelete] as RecordedDelete).condition);
    expect(condition.params).toContain(USER_ID);
    expect(condition.params).toContain(CREDENTIAL_PROVIDER_ID);
  });

  it("revokes every session for the user and reports how many", async () => {
    const { database, writes } = makeRecordingDatabase(["s1", "s2", "s3"]);
    const { getAuth } = makeAuth();
    const resetter = new BetterAuthPasswordResetter({ database, getAuth });

    const result = await resetter.resetPassword({
      userId: USER_ID,
      password: "a-new-password",
    });

    expect(result.data).toEqual({ userId: USER_ID, sessionsRevoked: 3 });

    const sessionDelete = writes.find(
      (write) => write.kind === "delete" && write.table === core_sessions,
    );
    expect(sessionDelete).toBeDefined();
    expect(renderCondition((sessionDelete as RecordedDelete).condition).params).toContain(
      USER_ID,
    );
  });

  it("reports zero revoked sessions for a user who was not signed in", async () => {
    const { database } = makeRecordingDatabase([]);
    const { getAuth } = makeAuth();
    const resetter = new BetterAuthPasswordResetter({ database, getAuth });

    const result = await resetter.resetPassword({
      userId: USER_ID,
      password: "a-new-password",
    });

    expect(result.data?.sessionsRevoked).toBe(0);
  });

  it("performs the credential replacement and session purge in one transaction", async () => {
    const recording = makeRecordingDatabase(["s1"]);
    const { getAuth } = makeAuth();
    const resetter = new BetterAuthPasswordResetter({
      database: recording.database,
      getAuth,
    });

    await resetter.resetPassword({ userId: USER_ID, password: "a-new-password" });

    expect(recording.transactions).toBe(1);
  });

  it("wraps a driver failure as INFRA_FAILURE rather than throwing", async () => {
    const failing = {
      transaction: async () => {
        throw new Error("connection terminated");
      },
    } as unknown as Database;
    const { getAuth } = makeAuth();
    const resetter = new BetterAuthPasswordResetter({ database: failing, getAuth });

    const result = await resetter.resetPassword({
      userId: USER_ID,
      password: "a-new-password",
    });

    expect(result.error?.code).toBe("INFRA_FAILURE");
    expect(result.data).toBeUndefined();
  });

  it("wraps a hashing failure as INFRA_FAILURE and writes nothing", async () => {
    const { database, writes } = makeRecordingDatabase();
    const { getAuth } = makeAuth(async () => {
      throw new Error("hasher unavailable");
    });
    const resetter = new BetterAuthPasswordResetter({ database, getAuth });

    const result = await resetter.resetPassword({
      userId: USER_ID,
      password: "a-new-password",
    });

    expect(result.error?.code).toBe("INFRA_FAILURE");
    expect(writes).toHaveLength(0);
  });
});
