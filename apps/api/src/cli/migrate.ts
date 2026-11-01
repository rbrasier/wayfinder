/**
 * Applies pending database migrations, then exits.
 *
 * This is the supported way to migrate a deployment. Running it as a discrete
 * step — an ECS one-off task, a Container Apps job, a compose service the app
 * services wait on — means a migration failure is a failed step with an exit
 * code rather than a crash-looping web container (ADR-047).
 *
 * Safe to run repeatedly and safe to run concurrently: instances serialise on a
 * Postgres advisory lock, and an already-current database is a no-op.
 *
 * Usage:
 *   pnpm --filter @wayfinder/api migrate
 *   docker run --rm -e DATABASE_URL=… ghcr.io/rbrasier/wayfinder migrate
 */

import "dotenv/config";
// The narrow `/db` subpath, not the package barrel. The barrel pulls the AI and
// embeddings adapters — onnxruntime and transformers — which migrating has no
// use for. Loading them here cost seconds on every dev and e2e boot.
import { runMigrations } from "@wayfinder/adapters/db";

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("[migrate] DATABASE_URL is not set. Nothing to migrate against.");
    process.exit(1);
  }

  console.log("[migrate] Checking for pending migrations…");

  const report = await runMigrations(databaseUrl, {
    onProgress: (message) => console.log(`[migrate] ${message}`),
  });

  if (report.appliedCount === 0) {
    console.log(
      `[migrate] Database is already up to date — ${report.alreadyAppliedCount} migration(s) applied previously.`,
    );
    return;
  }

  console.log(
    `[migrate] Applied ${report.appliedCount} migration(s) in ${report.durationMs}ms ` +
      `(${report.alreadyAppliedCount} were already applied).`,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[migrate] Migration failed: ${message}`);

  // The driver reports a failed query, and buries the reason it failed —
  // "connection refused", "password authentication failed" — in the cause. That
  // reason is the entire diagnostic value of this message to an operator.
  const cause = error instanceof Error ? error.cause : undefined;
  if (cause) console.error(`[migrate] Caused by: ${cause instanceof Error ? cause.message : String(cause)}`);

  if (error instanceof Error && error.stack) console.error(error.stack);
  process.exit(1);
});
