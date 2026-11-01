import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveMigrationsFolder, runMigrations } from "./migrate";
import { ALPHA_2_MIGRATIONS } from "./release-line-reconciliation";

// Rehearses the upgrade every alpha-2 deployment will run: migrate a database
// exactly as release/alpha-2 left it, put alpha-2-shaped rows in it, then run
// this branch's migrations and require the result to match a fresh database
// column for column. Needs a real Postgres, so it runs from `db:rehearse-upgrade`
// (validate.sh §29, CI's validate job), not from the unit suite.

const adminUrl = process.env.DATABASE_URL ?? "";
const mainFolder = resolveMigrationsFolder();
const alpha2Fixture = join(mainFolder, "..", "drizzle-fixtures", "alpha-2");
const suffix = randomBytes(4).toString("hex");
const alpha2Database = `wayfinder_rehearsal_alpha2_${suffix}`;
const freshDatabase = `wayfinder_rehearsal_fresh_${suffix}`;

const urlFor = (database: string): string => {
  const url = new URL(adminUrl);
  url.pathname = `/${database}`;
  return url.toString();
};

type JournalEntry = { tag: string; when: number };
const journalOf = (folder: string): JournalEntry[] =>
  (JSON.parse(readFileSync(join(folder, "meta", "_journal.json"), "utf8")) as { entries: JournalEntry[] }).entries;

// Alpha-2's history is main's SQL up to the fork plus the fixture's own files.
const assembleAlpha2Folder = (): string => {
  const folder = mkdtempSync(join(tmpdir(), "alpha-2-migrations-"));
  mkdirSync(join(folder, "meta"));
  copyFileSync(join(alpha2Fixture, "meta", "_journal.json"), join(folder, "meta", "_journal.json"));
  for (const { tag } of journalOf(alpha2Fixture)) {
    const fromFixture = join(alpha2Fixture, `${tag}.sql`);
    copyFileSync(existsSync(fromFixture) ? fromFixture : join(mainFolder, `${tag}.sql`), join(folder, `${tag}.sql`));
  }
  return folder;
};

const SCHEMA_QUERIES = {
  columns: `select table_name, column_name, data_type, udt_name, is_nullable, coalesce(column_default, '') as column_default
            from information_schema.columns where table_schema = 'public' order by table_name, column_name`,
  indexes: `select tablename, indexname, indexdef from pg_indexes where schemaname = 'public' order by tablename, indexname`,
  constraints: `select conrelid::regclass::text as table_name, conname, pg_get_constraintdef(oid) as definition
                from pg_constraint where connamespace = 'public'::regnamespace order by 1, 2`,
} as const;

const describeSchema = async (database: string) => {
  const client = postgres(urlFor(database), { max: 1, onnotice: () => {} });
  try {
    return {
      columns: await client.unsafe(SCHEMA_QUERIES.columns),
      indexes: await client.unsafe(SCHEMA_QUERIES.indexes),
      constraints: await client.unsafe(SCHEMA_QUERIES.constraints),
    };
  } finally {
    await client.end();
  }
};

const withClient = async <T>(database: string, work: (client: postgres.Sql) => Promise<T>): Promise<T> => {
  const client = postgres(urlFor(database), { max: 1, onnotice: () => {} });
  try {
    return await work(client);
  } finally {
    await client.end();
  }
};

const ledgerOf = (database: string) =>
  withClient(database, async (client) => {
    const rows = await client`select created_at::text as created_at from drizzle.__drizzle_migrations`;
    return new Set(rows.map((row) => Number(row.created_at)));
  });

describe("upgrading an alpha-2 database to this branch", () => {
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  let alpha2Folder = "";
  let upgradeAppliedCount = 0;

  beforeAll(async () => {
    await admin.unsafe(`create database ${alpha2Database}`);
    await admin.unsafe(`create database ${freshDatabase}`);
    alpha2Folder = assembleAlpha2Folder();

    await runMigrations(urlFor(alpha2Database), { migrationsFolder: alpha2Folder });
    await withClient(alpha2Database, async (client) => {
      await client`insert into admin_mcp_servers (label, url, credential_encrypted)
                   values ('Bearer server', 'https://bearer.example/mcp', 'bearer-ciphertext')`;
      await client`insert into admin_mcp_servers (label, url, oauth_token_url, oauth_client_id,
                     oauth_client_secret_encrypted, oauth_client_auth_method)
                   values ('OAuth server', 'https://oauth.example/mcp', 'https://idp.example/token', 'wayfinder',
                     'oauth-secret-ciphertext', 'client_secret_post')`;
    });

    const upgrade = await runMigrations(urlFor(alpha2Database), { migrationsFolder: mainFolder });
    upgradeAppliedCount = upgrade.appliedCount;
    await runMigrations(urlFor(freshDatabase), { migrationsFolder: mainFolder });
  }, 120_000);

  afterAll(async () => {
    await admin.unsafe(`drop database if exists ${alpha2Database} with (force)`);
    await admin.unsafe(`drop database if exists ${freshDatabase} with (force)`);
    await admin.end();
    if (alpha2Folder) rmSync(alpha2Folder, { recursive: true, force: true });
  });

  it("applies main's migrations rather than skipping them", () => {
    expect(upgradeAppliedCount).toBeGreaterThan(1);
  });

  it("ends with exactly the schema a fresh database gets", async () => {
    const upgraded = await describeSchema(alpha2Database);
    const fresh = await describeSchema(freshDatabase);

    expect(upgraded.columns).toEqual(fresh.columns);
    expect(upgraded.indexes).toEqual(fresh.indexes);
    expect(upgraded.constraints).toEqual(fresh.constraints);
  });

  it("records every main migration, keeping alpha-2's own entries alongside", async () => {
    const ledger = await ledgerOf(alpha2Database);

    for (const { when } of journalOf(mainFolder)) expect(ledger.has(when)).toBe(true);
    for (const when of Object.values(ALPHA_2_MIGRATIONS)) expect(ledger.has(when)).toBe(true);
  });

  it("keeps an alpha-2 bearer token, so nobody has to re-enter it", async () => {
    const rows = await withClient(
      alpha2Database,
      (client) => client`select credential_ciphertext from admin_mcp_servers where label = 'Bearer server'`,
    );

    expect(rows[0]?.credential_ciphertext).toBe("bearer-ciphertext");
  });

  it("keeps an alpha-2 OAuth client-credentials configuration and its secret", async () => {
    const rows = await withClient(
      alpha2Database,
      (client) => client`select oauth_token_url, oauth_client_id, oauth_client_secret_ciphertext, oauth_client_auth_method
                         from admin_mcp_servers where label = 'OAuth server'`,
    );

    expect(rows[0]).toEqual({
      oauth_token_url: "https://idp.example/token",
      oauth_client_id: "wayfinder",
      oauth_client_secret_ciphertext: "oauth-secret-ciphertext",
      oauth_client_auth_method: "client_secret_post",
    });
  });

  it("is a no-op when run again", async () => {
    const rerun = await runMigrations(urlFor(alpha2Database), { migrationsFolder: mainFolder });

    expect(rerun.appliedCount).toBe(0);
  });
});
