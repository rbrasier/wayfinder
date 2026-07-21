import { test, expect } from "./helpers/base";

// E2E for knowledge-base curation & correction (PRD: knowledge-base-curation).
//
// Driven by the /e2e (Playwright MCP) skill against a running stack — it is
// excluded from the vitest unit run. Two surfaces are exercised:
//   1. Frontline "Fix This Answer" — flag an assistant answer, type a correction,
//      pick a reason, submit, and see the acknowledgement (no RAG vocabulary).
//   2. SME curation grid (/knowledge) — pick a flow, edit a chunk in the drawer,
//      and see the version history gain the prior text (revert is available).
//
// Assumes the seeded e2e fixtures: a session with an assistant message and a
// published flow whose context document has been indexed into kb_document_chunks.
// The acting user holds knowledge:submit_feedback and knowledge:curate.

const SESSION_PATH = process.env.E2E_SESSION_PATH ?? "/chats/e2e-seed-session";

test.describe("frontline fix this answer", () => {
  test("an operator submits a correction and is thanked", async ({ page }) => {
    await page.goto(SESSION_PATH);

    await page.getByRole("button", { name: /fix this answer/i }).first().click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(/fix this answer/i)).toBeVisible();
    // The backend vocabulary must never leak to the frontline.
    await expect(dialog.getByText(/chunk|embedding|vector|RAG/i)).toHaveCount(0);

    await dialog.getByLabel(/what should it say/i).fill("The lead time is three weeks.");
    await dialog.getByLabel(/why is it wrong/i).selectOption("outdated");
    await dialog.getByRole("button", { name: /submit fix/i }).click();

    await expect(dialog.getByText(/thanks for the fix/i)).toBeVisible();
  });

  test("submitting without a correction is blocked by the required field", async ({ page }) => {
    await page.goto(SESSION_PATH);

    await page.getByRole("button", { name: /fix this answer/i }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: /submit fix/i }).click();

    // The native required validation keeps the modal open on the form.
    await expect(dialog.getByLabel(/what should it say/i)).toBeVisible();
  });
});

test.describe("SME curation grid", () => {
  test("an SME edits a chunk and the prior text appears in version history", async ({ page }) => {
    await page.goto("/knowledge");

    await page.getByLabel(/flow/i).selectOption({ index: 1 });

    // Open the first row's drawer.
    await page.getByRole("cell").nth(1).click();
    const drawer = page.getByRole("complementary");
    await expect(drawer.getByText(/edit content/i)).toBeVisible();

    const editor = drawer.getByRole("textbox").first();
    const original = (await editor.inputValue()).trim();
    await editor.fill("Updated curated guidance for procurement officers.");
    await drawer.getByRole("button", { name: /save & re-evaluate/i }).click();

    await expect(drawer.getByText(/version history/i)).toBeVisible();
    await expect(drawer.getByText(original).first()).toBeVisible();
    await expect(drawer.getByRole("button", { name: /revert to this/i }).first()).toBeVisible();
  });

  test("exact-match search highlights the literal term", async ({ page }) => {
    await page.goto("/knowledge");
    await page.getByLabel(/flow/i).selectOption({ index: 1 });

    await page.getByRole("button", { name: /semantic/i }).click();
    await page.getByLabel(/search/i).fill("INV-2024-001");
    await page.getByRole("button", { name: /^search$/i }).click();

    await expect(page.locator("mark").first()).toBeVisible();
  });
});
