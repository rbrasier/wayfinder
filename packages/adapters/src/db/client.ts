import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index";

export type Database = ReturnType<typeof createDatabase>;

// The pool size must satisfy `poolMax × instanceCount < Postgres max_connections`
// (default 100), leaving headroom for migrations, the scheduler, and admin tooling.
// Behind a transaction-mode pooler (PgBouncer/RDS Proxy) the real Postgres
// connections are multiplexed, so a per-instance value of ~15–20 is a sane start
// for ~500 concurrent users across a few instances (see the scaling-current-stack phase doc).
// Defaults low so local development never exhausts a dev database.
const DEFAULT_POOL_MAX = 10;

export const createDatabase = (databaseUrl: string, poolMax: number = DEFAULT_POOL_MAX) => {
  const client = postgres(databaseUrl, { max: poolMax });
  return drizzle(client, { schema });
};

export { schema };
