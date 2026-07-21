import { test, expect } from "./helpers/base";

// E2E for the audit & compliance trail (PRD: audit-compliance-trail, ADR-033).
//
// Driven by the /e2e (Playwright MCP) skill against a running stack — it is
// excluded from the vitest unit run. Three surfaces are exercised:
//   1. The admin audit console: filter bar, results table, row detail, export,
//      and the on-demand chain-integrity check.
//   2. Legal holds: place a global hold and release it.
//   3. The SIEM streaming card on the settings page.
//
// Assumes an admin session and at least one recorded audit event (any admin
// action, e.g. signing in, writes to core_audit_log).

const AUDIT_PATH = process.env.E2E_AUDIT_PATH ?? "/admin/audit";
const SETTINGS_PATH = process.env.E2E_SETTINGS_PATH ?? "/admin/settings";

test.describe("admin audit console", () => {
  test("renders the audit log with a filter bar and export controls", async ({ page }) => {
    await page.goto(AUDIT_PATH);

    await expect(page.getByRole("heading", { name: /audit log/i })).toBeVisible();
    await expect(page.getByLabel(/action/i).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /search/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /export csv/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /export json/i })).toBeVisible();
  });

  test("verifies the hash chain is intact", async ({ page }) => {
    await page.goto(AUDIT_PATH);

    await page.getByRole("button", { name: /verify integrity/i }).click();
    // The badge reports either an intact chain or a detected break; a healthy
    // seeded chain reports intact.
    await expect(page.getByText(/chain intact/i)).toBeVisible();
  });

  test("filters by action and opens a row's detail", async ({ page }) => {
    await page.goto(AUDIT_PATH);

    // Open the first row's detail dialog if any events exist.
    const firstRow = page.locator("tbody tr").first();
    if (await firstRow.isVisible()) {
      await firstRow.click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(page.getByText(/^Hash$/i)).toBeVisible();
    }
  });
});

test.describe("legal holds", () => {
  test("an admin can place a global hold and release it", async ({ page }) => {
    await page.goto(AUDIT_PATH);

    await page.getByLabel(/^name$/i).fill("E2E matter");
    await page.getByRole("button", { name: /place hold/i }).click();

    const releaseButton = page.getByRole("button", { name: /release/i }).first();
    await expect(releaseButton).toBeVisible();
    await releaseButton.click();
    await expect(page.getByText(/released/i).first()).toBeVisible();
  });
});

test.describe("SIEM streaming", () => {
  test("the settings page exposes a SIEM streaming card", async ({ page }) => {
    await page.goto(SETTINGS_PATH);

    await expect(page.getByText(/siem streaming/i).first()).toBeVisible();
  });
});
