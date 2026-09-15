// Migrations as a one-shot invocation (ADR-047). The deploy pipeline invokes
// this and waits for it to succeed before the new web version is pointed at
// traffic; a failure here is a failed pipeline step, which is the whole point
// of migrations being a discrete command.
//
// `runMigrations` takes a Postgres advisory lock, so a concurrent invocation
// waits rather than racing.

import { runMigrations } from "../../../packages/adapters/src/db/migrate";

export interface MigrateResult {
  readonly migrated: true;
}

export const handler = async (): Promise<MigrateResult> => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set — the migrate function cannot reach the database.");
  }

  await runMigrations(databaseUrl);
  return { migrated: true };
};
