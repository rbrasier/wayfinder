import { test, expect } from "./helpers/base";

// E2E for the bug fix: the extraction_flows feature flag was never seeded on
// fresh installs, so the "Synthesise Information" nav entry never appeared and
// the flag was absent from /admin/flags. Migration
// 0039_seed_extraction_flows_flag now inserts it enabled=true, and the sidebar
// reads featureFlag.isEnabledForMe to gate the entry.
// (docs/development/implemented/alpha-2/v2.14.1/fix-seed-extraction-flows-flag.md)
//
// Driven by the /e2e (Playwright MCP) skill against a running signed-in stack
// as an admin user. Admins resolve the flag via the wildcard, so the entry
// renders once the flag row exists and is enabled.

const ADMIN_HOME_PATH = process.env.E2E_ADMIN_HOME_PATH ?? "/admin/sessions";

test.describe("seeded extraction_flows flag surfaces the Synthesise nav entry", () => {
  test("Synthesise Information nav entry appears for a seeded admin", async ({ page }) => {
    await page.goto(ADMIN_HOME_PATH);

    // The entry sits in the main admin group (not collapsed). Before the seed
    // fix the flag defaulted to false so the link was never rendered.
    await expect(
      page.getByRole("link", { name: "Synthesise Information", exact: true }).first(),
    ).toBeVisible();
  });

  test("extraction_flows appears in the admin Flags list", async ({ page }) => {
    await page.goto("/admin/flags");

    await expect(page.getByText("extraction_flows", { exact: true })).toBeVisible();
  });
});
