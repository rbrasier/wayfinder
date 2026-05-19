import type { ServiceStatus } from "@rbrasier/domain";
import { sql } from "drizzle-orm";
import type { Database } from "../db/client";

export class DbHealthChecker {
  constructor(private readonly db: Database) {}

  async check(): Promise<ServiceStatus> {
    const start = Date.now();
    try {
      await this.db.execute(sql`SELECT 1`);
      return { ok: true, latencyMs: Date.now() - start };
    } catch (e) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: e instanceof Error ? e.message : "unknown",
      };
    }
  }
}
