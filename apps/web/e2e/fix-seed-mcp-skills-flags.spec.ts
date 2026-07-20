import { expect, test } from "@playwright/test";

// E2E for the bug fix: the mcp and skills feature flags were never seeded on
// fresh installs, so their admin nav entries (Skills, MCP Servers) never
// appeared. Migration 0032_seed_mcp_skills_flags now inserts them enabled=true,
// and the sidebar reads featureFlag.isEnabledForMe to gate the entries.
// (docs/development/implemented/alpha-2/v2.5.1/fix-seed-mcp-skills-feature-flags.md)
//
// Driven by the /e2e (Playwright MCP) skill against a running signed-in stack
// as an admin user. Any admin page is enough to render the admin sidebar.

const ADMIN_HOME_PATH = process.env.E2E_ADMIN_HOME_PATH ?? "/admin/sessions";

test.describe("seeded mcp + skills feature flags surface admin nav", () => {
  test("Skills and MCP Servers nav entries appear for a seeded admin", async ({ page }) => {
    await page.goto(ADMIN_HOME_PATH);

    // Both nav entries live under the "Flow Settings" group. Before the fix
    // the flags defaulted to false so neither link was rendered.
    await expect(page.getByRole("link", { name: "Skills", exact: true }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "MCP Servers", exact: true }).first()).toBeVisible();
  });
});
