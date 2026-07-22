import { test, expect } from "./helpers/base";

// E2E for bug #2: a fork node whose advanceConfidenceThreshold is below 90 must
// still resolve a branch and advance once the turn's confidence crosses that
// threshold. The regression gated the branch-choice call on a hardcoded 90, so a
// fork at threshold 70 reported "complete" at confidence 80 yet never advanced —
// the session silently stalled on the fork, turn after turn, with no error.
// (docs/development/implemented/alpha-1/v1.54.0/codebase-bug-fixes.phase.md)
//
// Driven by the /e2e (Playwright MCP) skill against a running stack in AI-mock
// mode — excluded from the vitest unit run. The pure gating predicate is unit
// tested in stream/branch-gate.test.ts; this spec covers the user-visible path.
//
// Assumes a seeded active session parked on a sub-90-threshold fork node whose
// AI-mock turn returns a confidence between the threshold and 90. Set
// E2E_FORK_SESSION_PATH to override.

const SESSION_PATH = process.env.E2E_FORK_SESSION_PATH ?? "/chats/e2e-seed-fork-threshold-session";

test.describe("fork advances at a sub-90 configured threshold", () => {
  test.beforeEach(() => {
    test.skip(!process.env.E2E_FORK_SESSION_PATH, "Needs a fork-threshold session the CI seed does not create yet — runs via the /e2e skill with E2E_FORK_SESSION_PATH set; skipped in CI (tracked in the e2e seed backlog).");
  });
  test("a mid-confidence turn on a low-threshold fork advances instead of stalling", async ({
    page,
  }) => {
    await page.goto(SESSION_PATH);

    const composer = page.getByRole("textbox");
    await expect(composer).toBeVisible({ timeout: 30_000 });

    await composer.fill("The amount is $4,000 for a standard purchase.");
    await composer.press("Enter");

    // The step reaches its threshold (< 90) and, because the branch is now
    // resolved, the session advances — a step-complete/next-step signal appears
    // rather than the chat sitting on the same fork node.
    await expect(
      page.getByText(/step complete|moving on to the next step/i).first(),
    ).toBeVisible({ timeout: 30_000 });
  });
});
