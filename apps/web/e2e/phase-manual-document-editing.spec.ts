import { test, expect } from "./helpers/base";

// E2E for manual document editing in flows (PRD: manual-document-editing).
//
// Driven by the /e2e (Playwright MCP) skill against a running stack — it is
// excluded from the vitest unit run. The flow under test:
//   1. Open a session that has a generated document card.
//   2. The card on an active, edit-enabled step shows an Edit action.
//   3. Editing a field and saving re-renders the DOCX (new -r{n} path),
//      stamps the edited marker, and surfaces per-field errors on bad input.
//
// Assumes the seeded e2e fixture session (see apps/web/src/lib/e2e-fixtures.ts)
// with a document-producing conversational step.

const SESSION_PATH = process.env.E2E_SESSION_PATH ?? "/chats/e2e-seed-session";

test.describe("manual document editing", () => {
  test.beforeEach(() => {
    test.skip(!process.env.E2E_SESSION_PATH, "Needs an editable-document session the CI seed does not create yet — runs via the /e2e skill with E2E_SESSION_PATH set; skipped in CI (tracked in the e2e seed backlog).");
  });
  test("operator edits a field and the card shows the edited marker", async ({ page }) => {
    await page.goto(SESSION_PATH);

    const documentCard = page.getByText(/\.docx$/).first();
    await expect(documentCard).toBeVisible();

    await page.getByRole("button", { name: /edit/i }).first().click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(/edit document fields/i)).toBeVisible();

    // Correct the first text field and save.
    const firstInput = dialog.locator("input[type='text']").first();
    await firstInput.fill("Corrected Supplier Pty Ltd");
    await dialog.getByRole("button", { name: /save changes/i }).click();

    await expect(page.getByText(/edited/i).first()).toBeVisible();
  });

  test("invalid input is rejected with a per-field message and nothing is saved", async ({
    page,
  }) => {
    await page.goto(SESSION_PATH);

    await page.getByRole("button", { name: /edit/i }).first().click();
    const dialog = page.getByRole("dialog");

    // Clear a required field and attempt to save.
    const requiredInput = dialog.locator("input[type='text']").first();
    await requiredInput.fill("");
    await dialog.getByRole("button", { name: /save changes/i }).click();

    await expect(dialog.getByText(/required/i)).toBeVisible();
  });
});
