import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The MCP and Skills features are hidden across the app when their flag rows
// are missing (falls through to DEFAULT_ENABLED_FLAGS which excludes them).
// Only migration 0015 ever inserts a flag row (auto_node), so on any fresh
// install those features vanish. This test locks in that a migration seeds
// them so we don't regress into the same silent-hide behaviour.
describe("core_feature_flag seed migrations", () => {
  const drizzleDir = join(__dirname, "..", "..", "..", "drizzle");
  const migrationSql = readdirSync(drizzleDir)
    .filter((name) => name.endsWith(".sql"))
    .map((name) => readFileSync(join(drizzleDir, name), "utf8"))
    .join("\n");

  const seedsFlag = (key: string): boolean => {
    const pattern = new RegExp(
      `INSERT\\s+INTO\\s+"core_feature_flag"[\\s\\S]*?'${key}'`,
      "i",
    );
    return pattern.test(migrationSql);
  };

  it("seeds the mcp flag so MCP UI surfaces on fresh installs", () => {
    expect(seedsFlag("mcp")).toBe(true);
  });

  it("seeds the skills flag so Skills UI surfaces on fresh installs", () => {
    expect(seedsFlag("skills")).toBe(true);
  });

  it("seeds the extraction_flows flag so the Synthesise UI surfaces on fresh installs", () => {
    expect(seedsFlag("extraction_flows")).toBe(true);
  });

  it.each(["event_watch", "ai_task_node", "email_node"])(
    "seeds the %s flag on so unattended automation surfaces on fresh installs",
    (key) => {
      expect(seedsFlag(key)).toBe(true);
    },
  );

  // seed-roles.ts only scopes flags and grants defaults for roles it creates, so
  // an install whose system roles already exist needs the migration to do it.
  it("backfills role scoping for the unattended-automation flags on upgraded installs", () => {
    const backfill =
      /INSERT\s+INTO\s+"admin_feature_flag_roles"[\s\S]*?'event_watch',\s*'admins'[\s\S]*?'ai_task_node',\s*'power_users'[\s\S]*?'email_node',\s*'power_users'/i;

    expect(backfill.test(migrationSql)).toBe(true);
  });

  it("backfills the webhook-trigger permission to Power Users on upgraded installs", () => {
    const backfill =
      /INSERT\s+INTO\s+"admin_role_permissions"[\s\S]*?'flow:webhook_trigger'[\s\S]*?'power_users'/i;

    expect(backfill.test(migrationSql)).toBe(true);
  });
});
