import { test, expect } from "./helpers/base";
import { loadSeedFixtures } from "./helpers/seed";

// E2E for the require-confirmation-before-completing-a-step toggle
// (PRD: step-confirmation-toggle, ADR-026).
//
// The flow under test:
//   1. A seeded session whose first conversational step has requireConfirmation
//      on has reached its threshold and is parked awaiting confirmation.
//   2. The pinned ConfirmStepCard renders and the composer stays enabled, so the
//      operator can keep chatting without being advanced automatically.
//   3. Clicking Proceed advances the step and the card disappears.
//
// Uses the seeded confirmation session (see apps/web/src/lib/e2e-fixtures.ts:
// seedConfirmationSession), navigated to by its real id from the seed fixtures.
// E2E_CONFIRM_SESSION_PATH overrides the path; the test skips when neither is
// available (unseeded environment).

// Resolve the seeded confirmation session path, or null when there is nothing
// to drive against.
function confirmationSessionPath(): string | null {
  if (process.env.E2E_CONFIRM_SESSION_PATH) return process.env.E2E_CONFIRM_SESSION_PATH;
  const confirmationSessionId = loadSeedFixtures()?.confirmationSessionId;
  return confirmationSessionId ? `/chats/${confirmationSessionId}` : null;
}

test.describe("step confirmation toggle", () => {
  test("the awaiting step shows the Proceed card while the composer stays enabled", async ({
    page,
  }) => {
    const sessionPath = confirmationSessionPath();
    if (!sessionPath) {
      test.skip(true, "No seeded confirmation session — run the seed setup to enable this test");
      return;
    }
    await page.goto(sessionPath);

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
    const sessionPath = confirmationSessionPath();
    if (!sessionPath) {
      test.skip(true, "No seeded confirmation session — run the seed setup to enable this test");
      return;
    }
    await page.goto(sessionPath);

    const proceed = page.getByRole("button", { name: /^proceed$/i });
    await expect(proceed).toBeVisible();
    await proceed.click();

    // Once advanced, the awaiting state clears and the card is gone.
    await expect(page.getByText(/ready to continue/i)).toBeHidden();
  });
});
