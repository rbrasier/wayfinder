import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Resolves to packages/adapters/drizzle/ in the template workspace and to
// node_modules/@rbrasier/adapters/drizzle/ when installed as an npm package —
// both locations contain the generated SQL migration files.
export async function runMigrations(databaseUrl: string): Promise<void> {
  const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), "..", "drizzle");
  const client = postgres(databaseUrl, { max: 1 });
  const db = drizzle(client);
  await migrate(db, { migrationsFolder });
  await client.end();
}
