import { expect, test } from "@playwright/test";

// E2E for the bug fix: clicking a sidebar link must "follow through" immediately
// instead of feeling sticky. Before the fix there was no loading.tsx boundary and
// no navigation indicator, so the previous page stayed fully on screen with zero
// feedback while the destination resolved its session + tRPC prefetch.
// (docs/development/implemented/v1.48.4/fix-sticky-link-navigation.md)
//
// Driven by the /e2e (Playwright MCP) skill against a running, signed-in stack.
// Assumes a seeded user session lands on /chats.

test.describe("sticky link navigation", () => {
  test("clicking a sidebar link gives immediate feedback and navigates", async ({ page }) => {
    await page.goto("/chats");

    // The Flows sidebar link is present once the shell renders.
    const flowsLink = page.getByRole("link", { name: "Flows" }).first();
    await expect(flowsLink).toBeVisible();

    await flowsLink.click();

    // Either the subtle top progress bar or a loading skeleton must appear right
    // away — both are the instant feedback the fix introduces. We accept either so
    // the test is not brittle to how fast the destination resolves.
    const progressBar = page.locator("div[aria-hidden].fixed.top-0");
    const skeleton = page.locator("[aria-hidden] .animate-pulse").first();
    await expect(progressBar.or(skeleton)).toBeVisible({ timeout: 2_000 });

    // And the navigation actually follows through to the Flows route.
    await expect(page).toHaveURL(/\/flows(\/|$)/, { timeout: 10_000 });
  });
});
