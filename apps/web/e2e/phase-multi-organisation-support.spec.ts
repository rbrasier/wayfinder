import { expect, test } from "@playwright/test";

// E2E for multi-organisation support — organisations as an internal
// sharing/visibility scope (PRD: multi-organisation-support, ADR-038).
//
// Driven by the /e2e (Playwright MCP) skill against a running stack — it is
// excluded from the vitest unit run. The surface under test is the new
// /admin/organisations screen:
//   1. An admin creates an organisation and it appears in the list.
//   2. The admin assigns a user to it, then a delete is guarded — an
//      organisation that still has members cannot be removed (ADR-038 delete
//      guard); it survives the attempt.
//   3. The membership-resolution card switches strategy and persists the choice.
//
// Assumes at least one non-admin user exists (the seeded fixtures provide one).
// Set E2E_ORGANISATIONS_PATH to override the path.

const ORGANISATIONS_PATH = process.env.E2E_ORGANISATIONS_PATH ?? "/admin/organisations";

// A per-run unique name so repeated runs never collide on the unique slug.
const uniqueName = () => `E2E Org ${Date.now()}`;

test.describe("multi-organisation admin", () => {
  test("an admin can create an organisation and see it listed", async ({ page }) => {
    await page.goto(ORGANISATIONS_PATH);

    await expect(page.getByRole("heading", { name: /organisations/i })).toBeVisible();

    const name = uniqueName();
    await page.getByLabel(/new organisation name/i).fill(name);
    await page.getByRole("button", { name: /add organisation/i }).click();

    // The created organisation surfaces as an editable row (its rename field).
    await expect(page.getByLabel(new RegExp(`rename ${name}`, "i"))).toBeVisible();
  });

  test("a member-holding organisation is protected from deletion", async ({ page }) => {
    await page.goto(ORGANISATIONS_PATH);

    // Create a fresh organisation to assign a member to.
    const name = uniqueName();
    await page.getByLabel(/new organisation name/i).fill(name);
    await page.getByRole("button", { name: /add organisation/i }).click();
    const renameField = page.getByLabel(new RegExp(`rename ${name}`, "i"));
    await expect(renameField).toBeVisible();

    // Assign the first available user to it via the Members card.
    const memberSelect = page.locator("select[aria-label^='Organisation for']").first();
    await memberSelect.selectOption({ label: name });

    // Deleting it is rejected: the guard keeps the row present after the attempt.
    await renameField.scrollIntoViewIfNeeded();
    const row = page.locator("li", { has: renameField });
    await row.getByRole("button", { name: /^delete$/i }).click();
    await expect(page.getByLabel(new RegExp(`rename ${name}`, "i"))).toBeVisible();
  });

  test("the resolution strategy can be switched and saved", async ({ page }) => {
    await page.goto(ORGANISATIONS_PATH);

    await expect(page.getByRole("heading", { name: /membership resolution/i })).toBeVisible();

    // Switch to self-nomination and reveal its config, then persist.
    await page.locator("#resolution-strategy").selectOption("self_nomination");
    await expect(page.locator("#nomination-mode")).toBeVisible();
    await page.getByRole("button", { name: /save strategy/i }).click();

    // Reloading shows the saved strategy, proving it round-tripped.
    await page.reload();
    await expect(page.locator("#resolution-strategy")).toHaveValue("self_nomination");
  });
});
