import { expect, test } from "@playwright/test";

// The mcp and skills feature flags now default OFF on a fresh install
// (ADR-041 §4): they are surfaced in admin UI as toggles but are not enabled
// until an admin turns them on (e.g. from the first-run setup wizard). Their
// gated nav entries (Skills, MCP Servers) therefore stay HIDDEN by default.
//
// Driven by the /e2e (Playwright MCP) skill against a running signed-in stack
// as an admin user, on an install where the flags have not been enabled.

const ADMIN_HOME_PATH = process.env.E2E_ADMIN_HOME_PATH ?? "/admin/sessions";

test.describe("mcp + skills feature flags default off", () => {
  test("Skills and MCP Servers nav entries are hidden until an admin enables the flags", async ({
    page,
  }) => {
    await page.goto(ADMIN_HOME_PATH);

    // With the flags off, neither gated nav entry should render.
    await expect(page.getByRole("link", { name: "Skills", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "MCP Servers", exact: true })).toHaveCount(0);
  });
});
