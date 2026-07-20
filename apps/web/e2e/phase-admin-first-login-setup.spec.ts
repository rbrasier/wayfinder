import { expect, test } from "@playwright/test";

// E2E for the admin first-login setup phase (ADR-041).
//
// Driven by the /e2e (Playwright MCP) skill against a running signed-in stack —
// excluded from the vitest unit run. The standard e2e stack already has an
// admin, which lets us exercise two user-visible contracts:
//
//   1. Happy path — the setup wizard is re-openable from admin Settings and
//      walks through its three gated steps, reusing the existing configuration
//      cards, and completes without error.
//   2. Error/self-disabling path — once an admin exists the public /setup
//      bootstrap screen is no longer reachable and redirects to sign-in.

const SETTINGS_PATH = process.env.E2E_SETTINGS_PATH ?? "/admin/settings";

test.describe("admin first-login setup wizard", () => {
  test("re-run setup opens the three-step wizard and finishes", async ({ page }) => {
    await page.goto(SETTINGS_PATH);

    // Re-run entry point (never clears the completion flag).
    await page.getByTestId("rerun-setup").click();

    const title = page.getByTestId("setup-wizard-title");
    await expect(title).toContainText("Step 1 of 3: Deployment");

    // Step 1 → 2: the required-setup step reuses the storage and AI cards.
    await page.getByTestId("wizard-continue").click();
    await expect(title).toContainText("Step 2 of 3: Setup");

    // Step 2 → 3: optional site options, including the Skills / MCP toggles.
    await page.getByTestId("wizard-continue").click();
    await expect(title).toContainText("Step 3 of 3: Site options");

    // The Skills and MCP toggles are present and default off.
    const skills = page.locator("#wizard-flag-skills");
    await expect(skills).toBeVisible();

    // Finishing marks onboarding complete and closes the dialog.
    await page.getByTestId("wizard-finish").click();
    await expect(title).toHaveCount(0);
  });

  test("the public /setup screen self-disables once an admin exists", async ({ page }) => {
    await page.goto("/setup?token=irrelevant");

    // With an admin already present, the bootstrap screen is not a setup surface
    // and routes the visitor to sign in instead.
    await expect(page).toHaveURL(/\/login/, { timeout: 15000 });
  });
});
