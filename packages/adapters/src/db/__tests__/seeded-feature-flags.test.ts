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
});
