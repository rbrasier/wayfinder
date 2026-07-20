import { expect, test } from "@playwright/test";

// E2E for bug #1: a node whose advanceConfidenceThreshold was authored as a
// fraction (0.7) instead of a percentage (70) must NOT auto-advance on its own
// opening message before the user has answered anything.
// (docs/development/implemented/alpha-1/v1.49.0/fix-flow-authored-data-trust.md)
//
// Driven by the /e2e (Playwright MCP) skill against a running stack with a real
// AI key. On the unfixed code, `5 >= 0.7` was always true, so every step
// advanced on its low-confidence opener and the chat raced to completion without
// input. With normalise-on-read (0.7 -> 70) the opener stays on its step.
//
// Assumes a seeded active session whose current node carries a fractional
// threshold. Set E2E_SESSION_PATH to override.

const SESSION_PATH = process.env.E2E_SESSION_PATH ?? "/chats/e2e-seed-session";

test.describe("fractional confidence threshold does not auto-advance", () => {
  test("the opening message stays on its step instead of racing ahead", async ({ page }) => {
    await page.goto(SESSION_PATH);

    // The assistant opener should ask the user something for the current step,
    // not jump to a later step or mark the session complete before any input.
    const composer = page.getByRole("textbox");
    await expect(composer).toBeVisible({ timeout: 30_000 });

    // The session must still be active (not auto-completed by a runaway advance).
    await expect(page.getByText(/session complete|workflow complete/i)).toHaveCount(0);

    // The opener's confidence badge, if shown, is below the 70 threshold and yet
    // the step did not advance — the regression would have advanced anyway.
    const advancedBanner = page.getByText(/moving on to the next step|step complete/i);
    await expect(advancedBanner).toHaveCount(0);
  });
});
