import { expect, test } from "@playwright/test";

// E2E for surfacing per-user spend caps on the Usage admin screen
// (enhance-usage-limits-admin-ui). The cap CRUD is the same shared
// SpendCapsCard rendered on the Cost governance dashboard, so this exercises
// the Usage surface specifically: an admin can find and manage caps from
// /admin/usage without visiting the governance dashboard.
//
// Driven by the /e2e (Playwright MCP) skill against a running stack — it is
// excluded from the vitest unit run.

const USAGE_PATH = process.env.E2E_USAGE_PATH ?? "/admin/usage";

test.describe("spend caps on the usage screen", () => {
  test("renders usage metrics and the spend caps card for an admin", async ({ page }) => {
    await page.goto(USAGE_PATH);

    await expect(page.getByText(/usage by model/i)).toBeVisible();
    await expect(page.getByText(/spend caps/i)).toBeVisible();
    await expect(page.locator("#cap-user")).toBeVisible();
  });

  test("an admin can create, toggle and delete a cap from the usage screen", async ({ page }) => {
    await page.goto(USAGE_PATH);

    // Pick the first available user, set a monthly limit, and add the cap.
    await page.locator("#cap-user").selectOption({ index: 1 });
    await page.locator("#cap-period").selectOption("monthly");
    await page.locator("#cap-limit").fill("250");
    await page.getByRole("button", { name: /add cap/i }).click();

    // The new cap appears and can be disabled, then re-enabled.
    const disableButton = page.getByRole("button", { name: /disable/i }).first();
    await expect(disableButton).toBeVisible();
    await disableButton.click();
    const enableButton = page.getByRole("button", { name: /enable/i }).first();
    await expect(enableButton).toBeVisible();

    // And removed.
    await page.getByRole("button", { name: /delete/i }).first().click();
  });
});
