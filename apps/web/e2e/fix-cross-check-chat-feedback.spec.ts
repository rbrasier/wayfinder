import { test, expect } from "./helpers/base";

// E2E regression for the cross-check chat-feedback fixes (fix:
// fix-cross-check-chat-feedback, v1.58.7).
//
// Driven by the /e2e (Playwright MCP) skill against a running stack — excluded
// from the vitest unit run. Reproduces the tester's reports on a
// `generate_document` flow with a policy context doc and a confirmation-gated
// final step:
//
//   Test 1c — after a failed cross-check the chat rewrote the streamed reply
//     into the corrective follow-up (one message replaced by another). After
//     the fix the overruled reply persists and the follow-up appends below it
//     as its own bubble.
//
//   Test 1a/1b — after the step crossed the threshold (again), the
//     "Generating document…" pill never showed, and a passing cross-check gave
//     no feedback so the advance looked like a stall. After the fix a passing
//     cross-check appends an alignment note, the pill shows, and the feed
//     follows the new content to the bottom.
//
//   Test 2 — clicking Proceed on a confirmation-gated step kept the button on
//     screen until the document finished generating. After the fix the card
//     disappears immediately and the generating pill shows during the wait.

const CROSS_CHECK_SESSION_PATH =
  process.env.E2E_CROSS_CHECK_SESSION_PATH ?? "/chats/e2e-seed-cross-check-session";

test.describe("cross-check chat feedback", () => {
  test.beforeEach(() => {
    test.skip(!process.env.E2E_CROSS_CHECK_SESSION_PATH, "Needs a cross-check session the CI seed does not create yet — runs via the /e2e skill with E2E_CROSS_CHECK_SESSION_PATH set; skipped in CI (tracked in the e2e seed backlog).");
  });
  test("appends (never rewrites) messages around the cross-check and shows the generating pill", async ({
    page,
  }) => {
    await page.goto(CROSS_CHECK_SESSION_PATH);

    const composer = page.getByRole("textbox");

    // ── Fail path: incomplete answer that still crosses the threshold. ───────
    await composer.fill("That's everything I have — please submit the request.");
    await composer.press("Enter");

    await expect(page.getByText(/cross-checking/i)).toBeVisible({ timeout: 30_000 });

    // The overruled reply must remain in the chat while the corrective
    // follow-up appends BELOW it as a separate bubble — nothing is rewritten.
    await expect(page.getByText(/still missing|still need|missing or unclear/i)).toBeVisible({
      timeout: 60_000,
    });
    const bubbles = page.locator("p.whitespace-pre-wrap");
    await expect(await bubbles.count()).toBeGreaterThanOrEqual(3);

    // ── Threshold again after the hold: pill shows, then the step advances. ──
    await composer.fill(
      "The missing details: a MacBook Pro 14, requested by Richard Brasier, needed by 1 August 2026.",
    );
    await composer.press("Enter");

    // Test 1a: the generating pill is visible (and therefore scrolled into
    // view) while the document is produced, before the next step opens.
    const generatingPill = page.getByText(/generating document/i);
    await expect(generatingPill).toBeVisible({ timeout: 60_000 });
    await expect(generatingPill).toBeInViewport();

    await expect(page.getByText(/step complete/i).first()).toBeVisible({ timeout: 60_000 });

    // ── Pass path on the next step: explicit alignment note + auto-advance. ──
    await composer.fill(
      "Approved budget code FIN-1234, cost centre OPS-9, sign-off by Dana Chief. That's all confirmed.",
    );
    await composer.press("Enter");

    // Test 1b: a passing cross-check appends a new message saying everything
    // aligns with the references — visible feedback instead of a silent stall.
    const passNote = page.getByText(/alignment with the reference documents/i);
    await expect(passNote).toBeVisible({ timeout: 60_000 });
    await expect(passNote).toBeInViewport();
  });

  test("Proceed hides immediately and shows the generating pill while the mutation runs", async ({
    page,
  }) => {
    await page.goto(CROSS_CHECK_SESSION_PATH);

    const proceedButton = page.getByRole("button", { name: /proceed/i });
    await expect(proceedButton).toBeVisible({ timeout: 30_000 });

    await proceedButton.click();

    // Test 2: the confirmation card unmounts at once; the generating pill
    // covers the wait instead of a frozen, disabled button.
    await expect(proceedButton).toBeHidden({ timeout: 2_000 });
    await expect(page.getByText(/generating document/i)).toBeVisible({ timeout: 10_000 });

    // The step eventually completes and renders its document.
    await expect(page.getByText(/step complete|flow complete/i).first()).toBeVisible({
      timeout: 60_000,
    });
  });
});
