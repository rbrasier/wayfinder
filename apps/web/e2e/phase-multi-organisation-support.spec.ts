import { test, expect } from "./helpers/base";

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
  // Creates an organisation through the modal (the create form is no longer an
  // inline header field).
  const createOrganisation = async (
    page: import("@playwright/test").Page,
    name: string,
  ): Promise<void> => {
    await page.getByRole("button", { name: /new organisation/i }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/^name$/i).fill(name);
    await dialog.getByRole("button", { name: /create organisation/i }).click();
  };

  // Locates an organisation's row by its Edit button, so the Members card —
  // whose user rows list every organisation inside a <select> — is never a
  // false match (v2.11.1: rows are read-only text edited through a modal).
  const organisationRow = (page: import("@playwright/test").Page, name: string) =>
    page
      .getByRole("listitem")
      .filter({ has: page.getByRole("button", { name: /^edit$/i }) })
      .filter({ hasText: name });

  test("an admin can create an organisation and see it listed", async ({ page }) => {
    await page.goto(ORGANISATIONS_PATH);

    await expect(page.getByRole("heading", { name: /organisations/i })).toBeVisible();

    const name = uniqueName();
    await createOrganisation(page, name);

    // The created organisation surfaces as a read-only row with Edit/Delete.
    await expect(organisationRow(page, name)).toBeVisible();
  });

  test("a member-holding organisation is protected from deletion", async ({ page }) => {
    await page.goto(ORGANISATIONS_PATH);

    // Create a fresh organisation to assign a member to.
    const name = uniqueName();
    await createOrganisation(page, name);
    const row = organisationRow(page, name);
    await expect(row).toBeVisible();

    // Assign the first available user to it via the Members card.
    const memberSelect = page.locator("select[aria-label^='Organisation for']").first();
    await memberSelect.selectOption({ label: name });

    // Deleting it is rejected: the guard keeps the row present after the attempt.
    await row.scrollIntoViewIfNeeded();
    await row.getByRole("button", { name: /^delete$/i }).click();
    await expect(organisationRow(page, name)).toBeVisible();
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
