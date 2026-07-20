import { expect, test } from "@playwright/test";

// E2E for the admin Document Generation settings card
// (phase: document-generation-settings).
//
// Driven by the /e2e (Playwright MCP) skill against a running stack — excluded
// from the vitest unit run. The feature under test:
//   1. An admin can edit the document-generation budgets on /admin/settings and
//      the saved value is reflected on the card (persists on the next request).
//   2. An out-of-range value (field batch size 0) is rejected with an error and
//      nothing is saved.
//
// The card's defaults equal the built-in v1.49.0 limits, so the readout starts
// at field batch size 12 on a deployment that has never edited it.

const SETTINGS_PATH = process.env.E2E_SETTINGS_PATH ?? "/admin/settings";

test.describe("document generation settings", () => {
  test("an admin can change the field batch size and the card reflects it", async ({ page }) => {
    await page.goto(SETTINGS_PATH);

    await page.getByTestId("document-generation-edit").click();

    const batchInput = page.locator("#doc-gen-batch");
    await expect(batchInput).toBeVisible();
    await batchInput.fill("6");
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.getByText("Document generation settings saved")).toBeVisible();
    await expect(page.getByTestId("document-generation-batch")).toHaveText("6");
  });

  test("rejects an out-of-range field batch size and does not save", async ({ page }) => {
    await page.goto(SETTINGS_PATH);

    const before = await page.getByTestId("document-generation-batch").textContent();

    await page.getByTestId("document-generation-edit").click();
    await page.locator("#doc-gen-batch").fill("0");
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.getByText("Field batch size must be a positive whole number")).toBeVisible();

    // Dialog stays open and the persisted readout is unchanged.
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByTestId("document-generation-batch")).toHaveText(before ?? "");
  });
});
