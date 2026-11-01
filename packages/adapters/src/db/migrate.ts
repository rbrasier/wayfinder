import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { reconcileReleaseLine } from "./release-line-reconciliation";

// Chosen once and never changed: every process that migrates must agree on this
// number or the lock does not serialise anything.
const MIGRATION_ADVISORY_LOCK_KEY = 4_179_255_310;

const DEFAULT_LOCK_WAIT_MS = 120_000;
const LOCK_POLL_INTERVAL_MS = 500;

const DUPLICATE_SCHEMA_NOTICE = "42P06";
const DUPLICATE_TABLE_NOTICE = "42P07";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));

// Ordered by how specific the guess is. The workspace layout comes first because
// it is the one contributors hit; the container sets MIGRATIONS_DIR and never
// reaches these at all.
function defaultCandidateFolders(): string[] {
  return [
    // packages/adapters/src/db → packages/adapters/drizzle (workspace)
    join(moduleDirectory, "..", "..", "drizzle"),
    // <package>/db → <package>/drizzle (published package, compiled layout)
    join(moduleDirectory, "..", "drizzle"),
    join(process.cwd(), "drizzle"),
    join(process.cwd(), "packages", "adapters", "drizzle"),
  ];
}

export type ResolveMigrationsFolderOptions = {
  explicitFolder?: string;
  environmentFolder?: string;
  candidateFolders?: string[];
};

/**
 * The generated SQL lives outside the compiled output, so its location differs
 * between the workspace, a published package and a container image. Bundling the
 * API collapses `import.meta.url` to the bundle's own path, which is why the
 * image sets MIGRATIONS_DIR rather than relying on a relative guess.
 */
export function resolveMigrationsFolder(options: ResolveMigrationsFolderOptions = {}): string {
  if (options.explicitFolder) return options.explicitFolder;
  if (options.environmentFolder) return options.environmentFolder;

  const candidates = options.candidateFolders ?? defaultCandidateFolders();
  const found = candidates.find((candidate) => existsSync(join(candidate, "meta", "_journal.json")));
  if (found) return resolve(found);

  throw new Error(
    `Could not locate the generated migrations. Set MIGRATIONS_DIR to the folder ` +
      `containing meta/_journal.json. Tried:\n  ${candidates.join("\n  ")}`,
  );
}

export type MigrationReport = {
  migrationsFolder: string;
  /** Migrations already recorded before this run. */
  alreadyAppliedCount: number;
  /** Migrations this run applied. Zero means the database was already current. */
  appliedCount: number;
  durationMs: number;
  /** True when another process held the lock and this run waited for it. */
  waitedForLock: boolean;
};

export type RunMigrationsOptions = {
  migrationsFolder?: string;
  /** How long to wait for a concurrent migration to finish before giving up. */
  lockWaitMs?: number;
  onProgress?: (message: string) => void;
};

async function countAppliedMigrations(database: ReturnType<typeof drizzle>): Promise<number> {
  // Two queries rather than one guarded by CASE: the table does not exist until
  // the first migration runs, and Postgres fails at planning time on a subquery
  // naming a missing relation no matter what the CASE would have evaluated to.
  const existence = await database.execute<{ present: boolean }>(
    sql`select to_regclass('drizzle.__drizzle_migrations') is not null as present`,
  );
  if (!existence[0]?.present) return 0;

  const counted = await database.execute<{ count: string }>(
    sql`select count(*)::text as count from drizzle.__drizzle_migrations`,
  );
  return Number.parseInt(counted[0]?.count ?? "0", 10);
}

async function acquireMigrationLock(
  database: ReturnType<typeof drizzle>,
  lockWaitMs: number,
  onProgress?: (message: string) => void,
): Promise<boolean> {
  const deadline = Date.now() + lockWaitMs;
  let waited = false;

  for (;;) {
    const result = await database.execute<{ acquired: boolean }>(
      sql`select pg_try_advisory_lock(${MIGRATION_ADVISORY_LOCK_KEY}) as acquired`,
    );
    if (result[0]?.acquired) return waited;

    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out after ${lockWaitMs}ms waiting for another process to finish migrating. ` +
          `If no migration is running, an earlier one may have died holding the lock — ` +
          `check for idle connections on the database.`,
      );
    }

    if (!waited) {
      waited = true;
      onProgress?.("Another process is migrating — waiting for it to finish.");
    }
    await new Promise((resolveTimer) => setTimeout(resolveTimer, LOCK_POLL_INTERVAL_MS));
  }
}

/**
 * Applies any pending migrations and reports what it did.
 *
 * Safe to run concurrently: instances serialise on a Postgres advisory lock, so a
 * rolling deploy that starts several containers at once applies each migration
 * exactly once instead of racing. Running it against an already-current database
 * is a no-op.
 */
export async function runMigrations(
  databaseUrl: string,
  options: RunMigrationsOptions = {},
): Promise<MigrationReport> {
  const migrationsFolder = resolveMigrationsFolder({
    explicitFolder: options.migrationsFolder,
    environmentFolder: process.env.MIGRATIONS_DIR,
  });

  const startedAt = Date.now();
  const client = postgres(databaseUrl, {
    max: 1,
    onnotice: (notice) => {
      // Drizzle creates its bookkeeping schema and table with IF NOT EXISTS on
      // every run, so these two fire on every migration after the first. Any
      // other notice comes from the migration SQL itself and is worth seeing.
      if (notice.code === DUPLICATE_SCHEMA_NOTICE || notice.code === DUPLICATE_TABLE_NOTICE) return;
      options.onProgress?.(`${notice.severity}: ${notice.message}`);
    },
  });
  const database = drizzle(client);

  try {
    const waitedForLock = await acquireMigrationLock(
      database,
      options.lockWaitMs ?? DEFAULT_LOCK_WAIT_MS,
      options.onProgress,
    );

    try {
      const alreadyAppliedCount = await countAppliedMigrations(database);
      await reconcileReleaseLine(database, migrationsFolder, options.onProgress);
      await migrate(database, { migrationsFolder });
      const totalAppliedCount = await countAppliedMigrations(database);

      return {
        migrationsFolder,
        alreadyAppliedCount,
        appliedCount: totalAppliedCount - alreadyAppliedCount,
        durationMs: Date.now() - startedAt,
        waitedForLock,
      };
    } finally {
      // Releasing explicitly rather than relying on disconnect keeps the lock's
      // lifetime obvious, and matters when a pooler holds the session open.
      await database.execute(sql`select pg_advisory_unlock(${MIGRATION_ADVISORY_LOCK_KEY})`);
    }
  } finally {
    await client.end();
  }
}
