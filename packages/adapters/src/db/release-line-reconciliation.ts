import { sql } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/postgres-js";
import { readMigrationFiles } from "drizzle-orm/migrator";

/**
 * Brings a database migrated by the alpha-2 release line onto main's migration
 * history, so the next drizzle `migrate()` sees it as an ordinary main database.
 *
 * Drizzle applies a migration only when its journal timestamp is later than the
 * newest one the database has recorded. Alpha-2 numbered its migrations
 * independently after 0043 and its last one is newer than most of main's, so a
 * plain `migrate()` on an alpha-2 database silently skips main's 0044–0058.
 * This replays them, records the ones alpha-2 already ran under another name,
 * and moves alpha-2-only state into main's shape.
 *
 * Every alpha-2 migration that main carries is listed here by its journal
 * timestamp, which never changes once generated. A migration added to a release
 * line later must be added here before it is forward-ported.
 */

export type JournalMigration = {
  folderMillis: number;
  hash: string;
  sql: string[];
};

export type ReconciliationStep =
  | { kind: "apply"; migration: JournalMigration }
  | { kind: "record"; migration: JournalMigration; preparation: string[] }
  | { kind: "carry"; reason: string; statements: string[] };

export const ALPHA_2_MIGRATIONS = {
  sessionManualEstimate: 1_787_603_937_303, // 0044_hesitant_monster_badoon
  welcomeTour: 1_788_540_895_241, // 0045_welcome_tour
  unattendedAutomation: 1_792_663_388_206, // 0046_unattended_automation
  seedUnattendedAutomation: 1_792_663_390_398, // 0047_seed_unattended_automation
  mcpStoredCredentials: 1_792_835_928_941, // 0048_mcp_stored_credentials
  entraAccountIdOid: 1_793_173_435_658, // 0049_entra_account_id_oid
  globalAdminRoleName: 1_793_176_887_677, // 0050_global_admin_role_name
  mcpOAuthClientCredentials: 1_793_187_118_836, // 0051_mcp_oauth_client_credentials
} as const;

export const MAIN_MIGRATIONS = {
  sessionManualEstimate: 1_787_655_460_044, // 0046_session_manual_estimate
  welcomeTour: 1_788_710_737_427, // 0049_welcome_tour
  mcpPublicDataReaders: 1_792_208_591_285, // 0055_mcp_public_data_readers
  unattendedAutomation: 1_792_915_432_301, // 0057_unattended_automation
  seedUnattendedAutomation: 1_792_915_442_553, // 0058_seed_unattended_automation
  entraAccountIdOid: 1_793_306_597_824, // 0059_entra_account_id_oid
  mcpOAuthClientCredentials: 1_793_496_780_690, // 0060_mcp_oauth_client_credentials
  globalAdminRoleName: 1_793_496_787_024, // 0061_global_admin_role_name
} as const;

type Counterpart = { alpha2Millis: number; preparation: string[] };

// Main migrations that alpha-2 already ran under its own number. All but the
// OAuth one are byte-identical (asserted in the tests); alpha-2 named the OAuth
// secret column `_encrypted` where main says `_ciphertext`, and both lines
// encrypt it with the same SettingsEncryptionService.
const COUNTERPARTS = new Map<number, Counterpart>([
  [MAIN_MIGRATIONS.sessionManualEstimate, { alpha2Millis: ALPHA_2_MIGRATIONS.sessionManualEstimate, preparation: [] }],
  [MAIN_MIGRATIONS.welcomeTour, { alpha2Millis: ALPHA_2_MIGRATIONS.welcomeTour, preparation: [] }],
  [MAIN_MIGRATIONS.unattendedAutomation, { alpha2Millis: ALPHA_2_MIGRATIONS.unattendedAutomation, preparation: [] }],
  [
    MAIN_MIGRATIONS.seedUnattendedAutomation,
    { alpha2Millis: ALPHA_2_MIGRATIONS.seedUnattendedAutomation, preparation: [] },
  ],
  [MAIN_MIGRATIONS.entraAccountIdOid, { alpha2Millis: ALPHA_2_MIGRATIONS.entraAccountIdOid, preparation: [] }],
  [MAIN_MIGRATIONS.globalAdminRoleName, { alpha2Millis: ALPHA_2_MIGRATIONS.globalAdminRoleName, preparation: [] }],
  [
    MAIN_MIGRATIONS.mcpOAuthClientCredentials,
    {
      alpha2Millis: ALPHA_2_MIGRATIONS.mcpOAuthClientCredentials,
      preparation: [
        `ALTER TABLE "admin_mcp_servers" RENAME COLUMN "oauth_client_secret_encrypted" TO "oauth_client_secret_ciphertext"`,
      ],
    },
  ],
]);

// Alpha-2's 0048 stored bearer tokens in `credential_encrypted`; main's 0055
// added `credential_ciphertext` for the same purpose with the same encryption,
// so the ciphertext moves across unchanged and nobody re-enters a token.
const BEARER_TOKEN_CARRY: ReconciliationStep = {
  kind: "carry",
  reason: "alpha-2 MCP bearer tokens",
  statements: [
    `UPDATE "admin_mcp_servers" SET "credential_ciphertext" = "credential_encrypted" WHERE "credential_encrypted" IS NOT NULL AND "credential_ciphertext" IS NULL`,
    `ALTER TABLE "admin_mcp_servers" DROP COLUMN "credential_encrypted"`,
  ],
};

const ALPHA_2_ONLY_MILLIS = new Set<number>(Object.values(ALPHA_2_MIGRATIONS));

export function isAlpha2Ledger(appliedMillis: ReadonlySet<number>): boolean {
  return [...appliedMillis].some((millis) => ALPHA_2_ONLY_MILLIS.has(millis));
}

function stepFor(migration: JournalMigration, appliedMillis: ReadonlySet<number>): ReconciliationStep {
  const counterpart = COUNTERPARTS.get(migration.folderMillis);
  if (counterpart && appliedMillis.has(counterpart.alpha2Millis)) {
    return { kind: "record", migration, preparation: counterpart.preparation };
  }
  return { kind: "apply", migration };
}

function carriesAfter(step: ReconciliationStep, appliedMillis: ReadonlySet<number>): ReconciliationStep[] {
  if (step.kind !== "apply") return [];
  if (step.migration.folderMillis !== MAIN_MIGRATIONS.mcpPublicDataReaders) return [];
  if (!appliedMillis.has(ALPHA_2_MIGRATIONS.mcpStoredCredentials)) return [];
  return [BEARER_TOKEN_CARRY];
}

/**
 * Pure: the steps that bring an alpha-2 database onto main's history, in journal
 * order. Empty for any database that has not run an alpha-2-only migration —
 * fresh, main-only, or alpha-2 from before the lines diverged — because drizzle
 * already handles those correctly.
 */
export function planReleaseLineReconciliation(
  journal: readonly JournalMigration[],
  appliedMillis: ReadonlySet<number>,
): ReconciliationStep[] {
  if (!isAlpha2Ledger(appliedMillis)) return [];

  return journal
    .filter((migration) => !appliedMillis.has(migration.folderMillis))
    .flatMap((migration) => {
      const step = stepFor(migration, appliedMillis);
      return [step, ...carriesAfter(step, appliedMillis)];
    });
}

type Database = ReturnType<typeof drizzle>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

async function readAppliedMillis(database: Database): Promise<Set<number>> {
  const existence = await database.execute<{ present: boolean }>(
    sql`select to_regclass('drizzle.__drizzle_migrations') is not null as present`,
  );
  if (!existence[0]?.present) return new Set();

  const rows = await database.execute<{ created_at: string }>(
    sql`select created_at::text as created_at from drizzle.__drizzle_migrations`,
  );
  return new Set(rows.map((row) => Number(row.created_at)));
}

async function runStatements(transaction: Transaction, statements: readonly string[]): Promise<void> {
  for (const statement of statements) {
    if (statement.trim() === "") continue;
    await transaction.execute(sql.raw(statement));
  }
}

async function recordMigration(transaction: Transaction, migration: JournalMigration): Promise<void> {
  await transaction.execute(
    sql`insert into drizzle.__drizzle_migrations ("hash", "created_at") values (${migration.hash}, ${migration.folderMillis})`,
  );
}

async function executeStep(transaction: Transaction, step: ReconciliationStep): Promise<void> {
  if (step.kind === "carry") {
    await runStatements(transaction, step.statements);
    return;
  }
  const statements = step.kind === "apply" ? step.migration.sql : step.preparation;
  await runStatements(transaction, statements);
  await recordMigration(transaction, step.migration);
}

/**
 * Runs the plan in one transaction, so a failure leaves the alpha-2 database
 * exactly as it was. Must be called while holding the migration advisory lock.
 * Returns how many migrations it recorded.
 */
export async function reconcileReleaseLine(
  database: Database,
  migrationsFolder: string,
  onProgress?: (message: string) => void,
): Promise<number> {
  const appliedMillis = await readAppliedMillis(database);
  const steps = planReleaseLineReconciliation(readMigrationFiles({ migrationsFolder }), appliedMillis);
  if (steps.length === 0) return 0;

  onProgress?.("This database was migrated by the alpha-2 release line — bringing it onto main's migration history.");
  await database.transaction(async (transaction) => {
    for (const step of steps) await executeStep(transaction, step);
  });

  return steps.filter((step) => step.kind !== "carry").length;
}
