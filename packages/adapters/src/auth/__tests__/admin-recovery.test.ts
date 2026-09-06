/**
 * Regression cover for the lockout described in
 * docs/development/to-be-implemented/fix-entra-admin-recovery.md.
 *
 * `applyEntraPrecedence` deletes an account's password the moment a Microsoft
 * identity links to it. That is deliberate and stays. What was missing is the
 * way back in when Entra later fails: every administrator has been through the
 * link at least once, so no password survives anywhere, and /admin/settings —
 * the only place email/password can be turned back on — is behind the login
 * that no longer works.
 *
 * These tests pin the break-glass path: a restored credential row in exactly
 * the shape Better Auth's sign-in reads, sessions cleared, email/password
 * forced back on, and an audit trail.
 */

import { describe, expect, it } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  AUTH_CONFIG_SETTING_KEY,
  type AuthConfig,
  type IAuditLogger,
  type IUserRepository,
  type ISystemSettingsRepository,
  type NewAuditLog,
  type Result,
  type SystemSetting,
  type User,
} from "@rbrasier/domain";
import type { Database } from "../../db/client";
import { core_accounts, core_sessions } from "../../db/schema/core";
import type { Auth } from "../better-auth";
import { BetterAuthAdminRecovery } from "../admin-recovery";

const ADMIN_ID = "9c2f0a10-0000-4000-8000-000000000001";

const adminUser = (overrides: Partial<User> = {}): User => ({
  id: ADMIN_ID,
  email: "ada@example.com",
  name: "Ada Lovelace",
  role: null,
  team: null,
  organisationId: null,
  emailVerified: false,
  isAdmin: true,
  welcomeTourCompletedAt: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  ...overrides,
});

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

const makeRecordingDatabase = (): { database: Database; writes: RecordedWrite[] } => {
  const writes: RecordedWrite[] = [];
  const recorder = {
    delete: (table: unknown) => ({
      where: async (condition: SQL): Promise<void> => {
        writes.push({ kind: "delete", table, condition });
      },
    }),
    insert: (table: unknown) => ({
      values: async (row: Record<string, unknown>): Promise<void> => {
        writes.push({ kind: "insert", table, row });
      },
    }),
  };
  return { database: recorder as unknown as Database, writes };
};

const renderCondition = (condition: SQL): { sql: string; params: unknown[] } => {
  const query = new PgDialect().sqlToQuery(condition);
  return { sql: query.sql, params: query.params };
};

const makeUsers = (user: User | null): IUserRepository => {
  const lookedUp: string[] = [];
  const repository = {
    findByEmail: async (email: string): Promise<Result<User | null>> => {
      lookedUp.push(email);
      return { data: user && user.email === email ? user : null };
    },
    lookedUp,
  };
  return repository as unknown as IUserRepository;
};

const makeSettings = (
  stored: AuthConfig | null,
): { settings: ISystemSettingsRepository; written: Map<string, string> } => {
  const written = new Map<string, string>();
  const settings: ISystemSettingsRepository = {
    get: async (key: string): Promise<Result<SystemSetting | null>> => {
      const value = written.get(key) ?? (stored && key === AUTH_CONFIG_SETTING_KEY ? JSON.stringify(stored) : null);
      if (value === null) return { data: null };
      return { data: { key, value, updatedAt: new Date() } as unknown as SystemSetting };
    },
    set: async (key: string, value: string): Promise<Result<SystemSetting>> => {
      written.set(key, value);
      return { data: { key, value, updatedAt: new Date() } as unknown as SystemSetting };
    },
    delete: async (): Promise<Result<void>> => ({ data: undefined }),
  };
  return { settings, written };
};

const makeAuditLogger = (): { auditLogger: IAuditLogger; entries: NewAuditLog[] } => {
  const entries: NewAuditLog[] = [];
  const auditLogger: IAuditLogger = {
    log: async (payload: NewAuditLog): Promise<Result<true>> => {
      entries.push(payload);
      return { data: true };
    },
  };
  return { auditLogger, entries };
};

// The provider's own hasher is what a restored row has to be written with; the
// fake stands in for it and makes the call observable.
const makeAuth = (): { getAuth: () => Promise<Auth>; hashed: string[] } => {
  const hashed: string[] = [];
  const auth = {
    handler: async () => new Response(),
    api: {},
    $context: Promise.resolve({
      password: {
        hash: async (password: string): Promise<string> => {
          hashed.push(password);
          return `scrypt$${password}`;
        },
      },
    }),
  };
  return { getAuth: async () => auth as unknown as Auth, hashed };
};

const entraOnlyConfig: AuthConfig = {
  emailPasswordEnabled: false,
  entraEnabled: true,
  entra: { tenantId: "tenant", clientId: "client", clientSecret: "secret" },
};

const makeRecovery = (
  user: User | null,
  storedConfig: AuthConfig | null = entraOnlyConfig,
) => {
  const { database, writes } = makeRecordingDatabase();
  const { settings, written } = makeSettings(storedConfig);
  const { auditLogger, entries } = makeAuditLogger();
  const { getAuth, hashed } = makeAuth();
  const recovery = new BetterAuthAdminRecovery({
    database,
    users: makeUsers(user),
    settings,
    auditLogger,
    getAuth,
  });
  return { recovery, writes, written, entries, hashed };
};

describe("BetterAuthAdminRecovery", () => {
  it("writes a credential row Better Auth's sign-in can read", async () => {
    const { recovery, writes, hashed } = makeRecovery(adminUser());

    const result = await recovery.recoverAdminAccess({
      email: "ada@example.com",
      password: "BreakGlass!2345",
    });

    expect(result.error).toBeUndefined();
    expect(hashed).toEqual(["BreakGlass!2345"]);

    const insert = writes.find((write) => write.kind === "insert");
    expect(insert).toBeDefined();
    expect(insert!.table).toBe(core_accounts);
    // Sign-in looks the account up by provider_id "credential" and verifies the
    // `password` column; sign-up writes account_id = the user's own id.
    expect((insert as RecordedInsert).row).toMatchObject({
      user_id: ADMIN_ID,
      account_id: ADMIN_ID,
      provider_id: "credential",
      password: "scrypt$BreakGlass!2345",
    });
  });

  it("clears any stale credential row before writing the new one", async () => {
    const { recovery, writes } = makeRecovery(adminUser());

    await recovery.recoverAdminAccess({ email: "ada@example.com", password: "BreakGlass!2345" });

    const accountWrites = writes.filter((write) => write.table === core_accounts);
    expect(accountWrites.map((write) => write.kind)).toEqual(["delete", "insert"]);

    const rendered = renderCondition((accountWrites[0] as RecordedDelete).condition);
    expect(rendered.params).toEqual([ADMIN_ID, "credential"]);
  });

  it("revokes the recovered user's existing sessions", async () => {
    const { recovery, writes } = makeRecovery(adminUser());

    await recovery.recoverAdminAccess({ email: "ada@example.com", password: "BreakGlass!2345" });

    const sessionDelete = writes.find((write) => write.table === core_sessions);
    expect(sessionDelete).toBeDefined();

    const rendered = renderCondition((sessionDelete as RecordedDelete).condition);
    expect(rendered.params).toEqual([ADMIN_ID]);
  });

  // Restoring the row is not enough on its own: with emailPasswordEnabled false
  // the provider never reaches the credential, and the settings page that would
  // flip it back is behind the broken login.
  it("re-enables email/password sign-in without disturbing the Entra settings", async () => {
    const { recovery, written } = makeRecovery(adminUser());

    const result = await recovery.recoverAdminAccess({
      email: "ada@example.com",
      password: "BreakGlass!2345",
    });

    expect(result.data?.emailPasswordReEnabled).toBe(true);

    const saved = JSON.parse(written.get(AUTH_CONFIG_SETTING_KEY)!) as AuthConfig;
    expect(saved.emailPasswordEnabled).toBe(true);
    expect(saved.entraEnabled).toBe(true);
    expect(saved.entra).toEqual(entraOnlyConfig.entra);
  });

  it("leaves the stored config alone when email/password is already enabled", async () => {
    const alreadyEnabled: AuthConfig = { ...entraOnlyConfig, emailPasswordEnabled: true };
    const { recovery, written } = makeRecovery(adminUser(), alreadyEnabled);

    const result = await recovery.recoverAdminAccess({
      email: "ada@example.com",
      password: "BreakGlass!2345",
    });

    expect(result.data?.emailPasswordReEnabled).toBe(false);
    expect(written.has(AUTH_CONFIG_SETTING_KEY)).toBe(false);
  });

  it("records the reset in the audit log", async () => {
    const { recovery, entries } = makeRecovery(adminUser());

    await recovery.recoverAdminAccess({ email: "ada@example.com", password: "BreakGlass!2345" });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: "admin.recovery.password_reset",
      resourceType: "user",
      resourceId: ADMIN_ID,
    });
    expect(JSON.stringify(entries[0])).not.toContain("BreakGlass!2345");
  });

  it("matches the address case-insensitively, as every other lookup does", async () => {
    const { recovery, writes } = makeRecovery(adminUser());

    const result = await recovery.recoverAdminAccess({
      email: "  Ada@Example.COM ",
      password: "BreakGlass!2345",
    });

    expect(result.error).toBeUndefined();
    expect(writes.some((write) => write.kind === "insert")).toBe(true);
  });

  it("reports that a recovered non-admin did not restore admin access", async () => {
    const { recovery } = makeRecovery(adminUser({ isAdmin: false }));

    const result = await recovery.recoverAdminAccess({
      email: "ada@example.com",
      password: "BreakGlass!2345",
    });

    expect(result.data?.wasAdmin).toBe(false);
  });

  it("returns NOT_FOUND for an address with no user, writing nothing", async () => {
    const { recovery, writes, written, entries } = makeRecovery(null);

    const result = await recovery.recoverAdminAccess({
      email: "nobody@example.com",
      password: "BreakGlass!2345",
    });

    expect(result.error?.code).toBe("NOT_FOUND");
    expect(writes).toEqual([]);
    expect(written.size).toBe(0);
    expect(entries).toEqual([]);
  });

  it("rejects an empty password rather than writing an unusable credential", async () => {
    const { recovery, writes } = makeRecovery(adminUser());

    const result = await recovery.recoverAdminAccess({ email: "ada@example.com", password: "" });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(writes).toEqual([]);
  });
});
