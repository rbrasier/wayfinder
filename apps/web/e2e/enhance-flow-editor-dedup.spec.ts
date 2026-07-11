import { expect, test } from "@playwright/test";

// E2E for the flow-editor consolidation (phase: flow-editor-consolidation).
//
// Driven by the /e2e (Playwright MCP) skill against a running stack — excluded
// from the vitest unit run. There is now a single canonical canvas editor at
// /flows/[id]/config. The former admin editor route redirects there, and the
// admin flows list links straight to it.
//
//   1. The admin flows list's "Configure Flow" action lands on the canonical
//      /flows/[id]/config editor (not the retired /admin/flows/[id] editor).
//   2. Visiting the old /admin/flows/[id] path redirects to the canonical
//      editor, so existing links/bookmarks keep resolving.
//   3. The canonical editor's "Add step" opens the shared node-type picker —
//      the same picker the drag-out-connector flow now uses.

const ADMIN_FLOWS_PATH = process.env.E2E_ADMIN_FLOWS_PATH ?? "/admin/flows";
const CANONICAL_EDITOR = /\/flows\/[0-9a-f-]+\/config$/i;

test.describe("flow editor consolidation", () => {
  test("admin 'Configure Flow' opens the canonical /flows/[id]/config editor", async ({ page }) => {
    await page.goto(ADMIN_FLOWS_PATH);

    await page.getByRole("link", { name: "Configure Flow" }).first().click();

    await expect(page).toHaveURL(CANONICAL_EDITOR);
    await expect(page.getByRole("button", { name: /add step/i })).toBeVisible();
  });

  test("the retired /admin/flows/[id] path redirects to the canonical editor", async ({ page }) => {
    await page.goto(ADMIN_FLOWS_PATH);
    const href = await page
      .getByRole("link", { name: "Configure Flow" })
      .first()
      .getAttribute("href");
    const flowId = href?.match(/\/flows\/([0-9a-f-]+)\/config/i)?.[1];
    expect(flowId).toBeTruthy();

    await page.goto(`/admin/flows/${flowId}`);

    await expect(page).toHaveURL(new RegExp(`/flows/${flowId}/config$`, "i"));
  });

  test("'Add step' on the canonical editor opens the node-type picker", async ({ page }) => {
    await page.goto(ADMIN_FLOWS_PATH);
    await page.getByRole("link", { name: "Configure Flow" }).first().click();
    await expect(page).toHaveURL(CANONICAL_EDITOR);

    await page.getByRole("button", { name: /add step/i }).click();

    // The shared picker (also used when a connector is dragged into blank space)
    // offers the conversational step type.
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByText(/conversational/i).first()).toBeVisible();
  });
});
