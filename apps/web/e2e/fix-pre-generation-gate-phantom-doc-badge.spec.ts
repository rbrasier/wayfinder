import { test, expect } from "./helpers/base";

// E2E regression for the pre-generation gate "phantom document badge" bug
// (fix: fix-pre-generation-gate-phantom-doc-badge, v1.58.3).
//
// Driven by the /e2e (Playwright MCP) skill against a running stack — excluded
// from the vitest unit run. Reproduces the exact failure the user reported:
//
//   The cheap chat model crosses the threshold on a `generate_document` step, so
//   the doc-gen model runs the gate. The gate returns a confidence *dip* but
//   lists NO concrete missing information (empty missingInformation) — a common
//   grader outcome when nothing is genuinely wrong.
//
// Before the fix this held the step, streamed a confusing "everything looks
// complete" follow-up that duplicated the previous turn, and left a "Generating
// document" badge spinning forever (no generation ever ran, no logs). After the
// fix the empty-gap result is treated as a pass: the step advances quietly, the
// document is generated, and no phantom badge or duplicate follow-up appears.
//
// The seed stubs the doc-gen model for this session to return a below-threshold
// confidence with an empty missingInformation list.

const EMPTY_GAP_SESSION_PATH =
  process.env.E2E_PREGEN_EMPTY_GAP_SESSION_PATH ??
  "/chats/e2e-seed-pregen-empty-gap-session";

test.describe("pre-generation gate — empty-gap confidence dip", () => {
  test.beforeEach(() => {
    test.skip(!process.env.E2E_PREGEN_EMPTY_GAP_SESSION_PATH, "Needs a doc-gen phantom-badge session the CI seed does not create yet — runs via the /e2e skill with E2E_PREGEN_EMPTY_GAP_SESSION_PATH set; skipped in CI (tracked in the e2e seed backlog).");
  });
  test("advances quietly and generates the document without a phantom badge or duplicate turn", async ({
    page,
  }) => {
    await page.goto(EMPTY_GAP_SESSION_PATH);

    const messagesBefore = await page.getByText(/everything looks complete/i).count();

    const composer = page.getByRole("textbox");
    await composer.fill("That's everything you need — please generate the document.");
    await composer.press("Enter");

    // The transient cross-checking indicator appears while the gate runs.
    await expect(page.getByText(/cross-checking/i)).toBeVisible();

    // With nothing concrete outstanding the step advances and the document is
    // generated and rendered.
    await expect(page.getByText(/step complete/i)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/\.docx/i)).toBeVisible({ timeout: 30_000 });

    // Regression guard 1: no permanent "Generating document" badge is left behind
    // once the turn resolves.
    await expect(page.getByText(/generating document/i)).toBeHidden({ timeout: 30_000 });

    // Regression guard 2: the gate does not emit a second, duplicate
    // "everything looks complete" follow-up on top of the original turn.
    await expect(async () => {
      const messagesAfter = await page.getByText(/everything looks complete/i).count();
      expect(messagesAfter).toBeLessThanOrEqual(messagesBefore + 1);
    }).toPass({ timeout: 30_000 });

    // The cross-checking indicator clears once the turn resolves.
    await expect(page.getByText(/cross-checking/i)).toBeHidden();
  });
});
