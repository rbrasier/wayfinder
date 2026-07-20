import { expect, test } from "@playwright/test";

// E2E for the require-confirmation-before-completing-a-step toggle
// (PRD: step-confirmation-toggle, ADR-026).
//
// Driven by the /e2e (Playwright MCP) skill against a running stack — it is
// excluded from the vitest unit run. The flow under test:
//   1. A seeded session whose first conversational step has requireConfirmation
//      on has reached its threshold and is parked awaiting confirmation.
//   2. The pinned ConfirmStepCard renders and the composer stays enabled, so the
//      operator can keep chatting without being advanced automatically.
//   3. Clicking Proceed advances the step and the card disappears.
//
// Assumes the seeded confirmation session (see apps/web/src/lib/e2e-fixtures.ts:
// seedConfirmationSession). Set E2E_CONFIRM_SESSION_PATH to override the path.

const SESSION_PATH =
  process.env.E2E_CONFIRM_SESSION_PATH ?? "/chats/e2e-seed-confirmation-session";

test.describe("step confirmation toggle", () => {
  test("the awaiting step shows the Proceed card while the composer stays enabled", async ({
    page,
  }) => {
    await page.goto(SESSION_PATH);

    // The pinned confirmation card is visible for the awaiting step.
    await expect(page.getByText(/ready to continue/i)).toBeVisible();
    const proceed = page.getByRole("button", { name: /^proceed$/i });
    await expect(proceed).toBeVisible();

    // Unlike the approval gate, the composer is not disabled — the operator can
    // still type while the step is held open.
    const composer = page.getByRole("textbox");
    await expect(composer).toBeEnabled();
  });

  test("clicking Proceed advances the step and removes the card", async ({ page }) => {
    await page.goto(SESSION_PATH);

    const proceed = page.getByRole("button", { name: /^proceed$/i });
    await expect(proceed).toBeVisible();
    await proceed.click();

    // Once advanced, the awaiting state clears and the card is gone.
    await expect(page.getByText(/ready to continue/i)).toBeHidden();
  });
});
