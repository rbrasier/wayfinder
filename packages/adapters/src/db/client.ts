import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index";

export type Database = ReturnType<typeof createDatabase>;

export const createDatabase = (databaseUrl: string) => {
  const client = postgres(databaseUrl, { max: 10 });
  return drizzle(client, { schema });
};

export { schema };
