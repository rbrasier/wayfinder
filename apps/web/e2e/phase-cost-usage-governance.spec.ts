import { test, expect } from "./helpers/base";

// E2E for cost / usage governance (PRD: cost-usage-governance, ADR-026).
//
// Driven by the /e2e (Playwright MCP) skill against a running stack — it is
// excluded from the vitest unit run. Two surfaces are exercised:
//   1. Admin governance dashboard: spend-by-user / spend-by-flow charts, the cap
//      utilisation table, and per-user cap CRUD (create + enable/disable).
//   2. The blocked-session UX: a user whose enabled cap is at its limit gets a
//      clear "usage cap reached" system message instead of a normal AI reply,
//      and the session stays active so raising the cap resumes it.
//
// The blocked-session test assumes a seeded session for a user already over an
// enabled cap. Set E2E_BLOCKED_SESSION_PATH to override the path.

const GOVERNANCE_PATH = process.env.E2E_GOVERNANCE_PATH ?? "/admin/dashboards/governance";
const BLOCKED_SESSION_PATH =
  process.env.E2E_BLOCKED_SESSION_PATH ?? "/chats/e2e-seed-quota-blocked-session";

test.describe("cost / usage governance dashboard", () => {
  test.beforeEach(() => {
    test.skip(!process.env.E2E_GOVERNANCE_PATH, "Needs seeded governance spend data the CI seed does not create yet — runs via the /e2e skill with E2E_GOVERNANCE_PATH set; skipped in CI (tracked in the e2e seed backlog).");
  });
  test("renders spend breakdowns and cap utilisation for an admin", async ({ page }) => {
    await page.goto(GOVERNANCE_PATH);

    await expect(page.getByText(/total spend/i)).toBeVisible();
    await expect(page.getByText(/spend by user/i)).toBeVisible();
    await expect(page.getByText(/spend by flow/i)).toBeVisible();
    await expect(page.getByText(/cap utilisation/i)).toBeVisible();
    await expect(page.getByText(/spend caps/i)).toBeVisible();
  });

  test("an admin can create and toggle a per-user spend cap", async ({ page }) => {
    await page.goto(GOVERNANCE_PATH);

    // Pick the first available user, set a monthly limit, and add the cap.
    await page.locator("#cap-user").selectOption({ index: 1 });
    await page.locator("#cap-period").selectOption("monthly");
    await page.locator("#cap-limit").fill("500");
    await page.getByRole("button", { name: /add cap/i }).click();

    // The new cap appears in the caps table and can be disabled.
    const disableButton = page.getByRole("button", { name: /disable/i }).first();
    await expect(disableButton).toBeVisible();
    await disableButton.click();
    await expect(page.getByRole("button", { name: /enable/i }).first()).toBeVisible();
  });
});

test.describe("blocked-session UX", () => {
  test.beforeEach(() => {
    test.skip(!process.env.E2E_BLOCKED_SESSION_PATH, "Needs a quota-blocked session the CI seed does not create yet — runs via the /e2e skill with E2E_BLOCKED_SESSION_PATH set; skipped in CI (tracked in the e2e seed backlog).");
  });
  test("a user at their cap sees a usage-cap message instead of an AI reply", async ({ page }) => {
    await page.goto(BLOCKED_SESSION_PATH);

    const composer = page.getByRole("textbox");
    await expect(composer).toBeEnabled();
    await composer.fill("Please continue.");
    await composer.press("Enter");

    // The block surfaces a clear system message and does not crash the session.
    await expect(page.getByText(/usage cap/i)).toBeVisible();
  });
});
