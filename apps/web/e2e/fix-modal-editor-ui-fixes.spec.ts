import { test, expect } from "./helpers/base";
import { loadSeedFixtures } from "./helpers/seed";

// E2E regression guards for the v2.11.1 modal-editor UI fixes.
//
// Driven by the /e2e (Playwright MCP) skill against a running, seeded stack —
// excluded from the vitest unit run. Each block maps to one reported defect and
// is written to fail on the pre-fix code:
//   A. Icon picker panel clipped inside the flow modal (opened downward).
//   B. Single-select / Multi-select field type reverting to Text.
//   C. Groups & Organisations rows carrying inline edit controls.

test.describe("flow modal — icon picker", () => {
  test("opens the icon panel above its trigger, inside the dialog", async ({ page }) => {
    await page.goto("/admin/flows");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /new flow/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    const trigger = dialog.getByRole("button", { name: /more/i });
    await trigger.click();

    const search = dialog.getByPlaceholder(/search icons/i);
    await expect(search).toBeVisible();

    const searchBox = await search.boundingBox();
    const triggerBox = await trigger.boundingBox();
    const dialogBox = await dialog.boundingBox();
    expect(searchBox).not.toBeNull();
    expect(triggerBox).not.toBeNull();
    expect(dialogBox).not.toBeNull();
    if (!searchBox || !triggerBox || !dialogBox) return;

    // The panel opens upward: its search field sits above the "More…" trigger.
    // On the pre-fix downward panel the search field sat below the trigger.
    expect(searchBox.y).toBeLessThan(triggerBox.y);

    // And the whole panel stays within the dialog rather than being clipped by
    // its overflow-hidden bottom edge.
    expect(searchBox.y).toBeGreaterThanOrEqual(dialogBox.y - 1);
    expect(searchBox.y + searchBox.height).toBeLessThanOrEqual(dialogBox.y + dialogBox.height + 1);
  });
});

test.describe("node config — structured fields", () => {
  test("keeps Single-select selected with no options entered", async ({ page }) => {
    const structuredFlowId = loadSeedFixtures()?.structuredFlowId;
    if (!structuredFlowId) {
      test.skip(true, "No seeded structured flow — run the seed setup to enable this test");
      return;
    }
    await page.goto(`/flows/${structuredFlowId}/config`);
    await page.waitForLoadState("networkidle");

    await page.getByText(/record intake decision/i).click();
    const modal = page.getByRole("dialog").first();
    await modal.getByText("Structured conversation").first().click();
    await expect(modal.getByText(/fields to capture/i)).toBeVisible();

    // Give the first field a label, then switch its type to Single-select. With
    // no options entered yet, the pre-fix controlled editor re-derived the type
    // from a serialised line that omits the (options) annotation and snapped it
    // back to Text; the fix holds the choice in local state.
    const label = modal.getByPlaceholder(/preferred vendor/i).first();
    await label.fill("Category");
    const typeSelect = modal.getByLabel(/field 1 type/i);
    await typeSelect.selectOption("select");
    await expect(typeSelect).toHaveValue("select");

    // Multi-select behaves the same way.
    await typeSelect.selectOption("multiselect");
    await expect(typeSelect).toHaveValue("multiselect");
  });
});

test.describe("admin — organisations rows", () => {
  test("shows read-only rows with Edit/Delete and edits via the modal", async ({ page }) => {
    await page.goto("/admin/organisations");
    await page.waitForLoadState("networkidle");

    // Create one through the modal so the test is self-contained.
    await page.getByRole("button", { name: /new organisation/i }).click();
    let dialog = page.getByRole("dialog");
    const name = `E2E Org ${Date.now()}`;
    await dialog.getByLabel(/^name$/i).fill(name);
    await dialog.getByLabel(/email domain/i).fill("acme.example");
    await dialog.getByRole("button", { name: /create organisation/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 10_000 });

    // The row is now plain text (no inline rename input) with Edit + Delete.
    // Identify it by the Edit button so it never collides with the Members
    // card, whose user rows list this organisation inside a <select>.
    const row = page
      .getByRole("listitem")
      .filter({ has: page.getByRole("button", { name: /^edit$/i }) })
      .filter({ hasText: name });
    await expect(row).toBeVisible();
    await expect(row).toContainText(name);
    await expect(page.getByLabel(new RegExp(`rename ${name}`, "i"))).toHaveCount(0);
    await expect(row.getByRole("button", { name: /^delete$/i })).toBeVisible();

    // Edit opens the same modal, prefilled with the record's values.
    await row.getByRole("button", { name: /^edit$/i }).click();
    dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: /edit organisation/i })).toBeVisible();
    await expect(dialog.getByLabel(/^name$/i)).toHaveValue(name);
    await expect(dialog.getByLabel(/email domain/i)).toHaveValue("acme.example");
  });
});

test.describe("admin — groups rows", () => {
  test("shows read-only rows with Edit/Delete and edits via the modal", async ({ page }) => {
    await page.goto("/admin/groups");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /new group/i }).click();
    let dialog = page.getByRole("dialog");
    const name = `E2E Group ${Date.now()}`;
    await dialog.getByLabel(/^name$/i).fill(name);
    await dialog.getByRole("button", { name: /create group/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 10_000 });

    // Identify the row by its Edit button so the group's Members panel (which
    // renders its own listitems) can never be mistaken for it.
    const row = page
      .getByRole("listitem")
      .filter({ has: page.getByRole("button", { name: /^edit$/i }) })
      .filter({ hasText: name });
    await expect(row).toBeVisible();
    await expect(row).toContainText(name);
    await expect(row.getByRole("button", { name: /^delete$/i })).toBeVisible();

    await row.getByRole("button", { name: /^edit$/i }).click();
    dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: /edit group/i })).toBeVisible();
    await expect(dialog.getByLabel(/^name$/i)).toHaveValue(name);
  });
});
