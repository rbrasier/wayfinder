import { test, expect } from "./helpers/base";

// E2E regression for the document-generation gate livelock + misleading
// messages + lingering cross-check badge (fix:
// fix-document-generation-gate-livelock, v1.58.5).
//
// Driven by the /e2e (Playwright MCP) skill against a running stack — excluded
// from the vitest unit run. Reproduces the exact failure the user reported on a
// `generate_document` step with a policy context doc:
//
//   1. The cheap chat model crosses the threshold ("ready to submit"), so the
//      doc-gen model runs the gate. The gate FAILS with a real gap (e.g. the
//      Recruitment Policy requires a Monday start date).
//   2. Before the fix: the optimistic "ready to submit" message was shown, then
//      a confusing near-duplicate follow-up, the cross-check badge stayed lit,
//      and — when the grader kept dipping below threshold — the step never
//      advanced and no document was generated ("Show Data" showed nothing
//      complete).
//   3. After the fix: the first fail shows a single clear follow-up asking for
//      the Monday date (no false "ready to submit"); once the operator supplies
//      it, the bounded gate lets the step advance and generate the document; and
//      the cross-check badge clears the instant each cross-check finishes.
//
// The seed stubs the doc-gen grader for this session to fail once with a
// "must start on a Monday" gap, then pass.

const LIVELOCK_SESSION_PATH =
  process.env.E2E_PREGEN_LIVELOCK_SESSION_PATH ??
  "/chats/e2e-seed-pregen-livelock-session";

test.describe("pre-generation gate — livelock, messaging & badge", () => {
  test.beforeEach(() => {
    test.skip(!process.env.E2E_PREGEN_LIVELOCK_SESSION_PATH, "Needs a doc-gen livelock session the CI seed does not create yet — runs via the /e2e skill with E2E_PREGEN_LIVELOCK_SESSION_PATH set; skipped in CI (tracked in the e2e seed backlog).");
  });
  test("asks once, advances on the correction, generates the document, and never lingers the badge", async ({
    page,
  }) => {
    await page.goto(LIVELOCK_SESSION_PATH);

    const composer = page.getByRole("textbox");

    // ── Turn 1: the gate fails on the policy (Tuesday start date). ──────────
    await composer.fill("Yes, that's everything — please submit it.");
    await composer.press("Enter");

    // The cross-check badge appears while the gate runs...
    await expect(page.getByText(/cross-checking/i)).toBeVisible();

    // ...the assistant asks for a valid Monday start date...
    await expect(page.getByText(/monday/i)).toBeVisible({ timeout: 30_000 });

    // Regression guard 1 (bugs 3 & 4): on the fail path the optimistic
    // "ready to submit" message is NOT shown — the follow-up is the only new
    // assistant turn, and it asks a question rather than claiming completion.
    await expect(page.getByText(/ready to (be )?submit/i)).toHaveCount(0);

    // Regression guard 2 (bug 1): the badge clears the moment the cross-check
    // finishes, not on the next turn.
    await expect(page.getByText(/cross-checking/i)).toBeHidden({ timeout: 30_000 });

    // ── Turn 2: the operator supplies a Monday; the bounded gate advances. ──
    await composer.fill("Let's go with Monday the 13th.");
    await composer.press("Enter");

    // Regression guard 3 (bug 5): the step advances and the document is
    // generated and rendered — no livelock.
    await expect(page.getByText(/step complete/i)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/\.docx/i)).toBeVisible({ timeout: 30_000 });

    // Regression guard 4: no permanent "Generating document" badge is left
    // behind once the turn resolves.
    await expect(page.getByText(/generating document/i)).toBeHidden({ timeout: 30_000 });

    // The cross-check badge clears again after the second turn resolves.
    await expect(page.getByText(/cross-checking/i)).toBeHidden();
  });
});
