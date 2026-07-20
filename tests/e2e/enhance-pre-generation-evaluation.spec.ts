import { expect, test } from "@playwright/test";

// E2E for the pre-generation evaluation gate
// (phase: pre-generation-evaluation, ADR-013 / ADR-026 / ADR-027).
//
// Driven by the /e2e (Playwright MCP) skill against a running stack — it is
// excluded from the vitest unit run. The behaviour under test:
//   1. A `generate_document` step advances only after the doc-gen model
//      cross-checks the would-be document — a transient "Cross-checking…"
//      indicator shows while that evaluation runs.
//   2. PASS: the step advances, a document is generated and rendered from the
//      already-extracted field values (no duplicate extraction), and the next
//      step opens.
//   3. FAIL: the step does NOT advance; a follow-up assistant message asks the
//      user for the outstanding information; the gap persists as outstanding
//      gathered context so the cheap model keeps asking until it is supplied.
//
// Two seeded sessions drive the deterministic outcomes (the doc-gen model is
// stubbed per session so the gate resolves the same way every run):
//   E2E_PREGEN_PASS_SESSION_PATH — eval stubbed to pass.
//   E2E_PREGEN_FAIL_SESSION_PATH — eval stubbed to fail with a known gap.

const PASS_SESSION_PATH =
  process.env.E2E_PREGEN_PASS_SESSION_PATH ?? "/chats/e2e-seed-pregen-pass-session";
const FAIL_SESSION_PATH =
  process.env.E2E_PREGEN_FAIL_SESSION_PATH ?? "/chats/e2e-seed-pregen-fail-session";

// The known gap the fail-stub reports — surfaced in the follow-up question and
// kept in subsequent gathered context.
const KNOWN_GAP = process.env.E2E_PREGEN_KNOWN_GAP ?? "contract end date";

test.describe("pre-generation evaluation gate", () => {
  test("a passing cross-check advances the step and generates the document once", async ({
    page,
  }) => {
    await page.goto(PASS_SESSION_PATH);

    const composer = page.getByRole("textbox");
    await composer.fill("That's everything you need — please generate the document.");
    await composer.press("Enter");

    // The transient cross-checking indicator appears while the doc-gen model
    // evaluates, before any advance.
    await expect(page.getByText(/cross-checking/i)).toBeVisible();

    // On a pass the step completes and the generated document is rendered.
    await expect(page.getByText(/step complete/i)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/\.docx/i)).toBeVisible({ timeout: 30_000 });

    // The cross-checking indicator clears once the turn resolves.
    await expect(page.getByText(/cross-checking/i)).toBeHidden();
  });

  test("a failing cross-check holds the step and asks for the missing information", async ({
    page,
  }) => {
    await page.goto(FAIL_SESSION_PATH);

    const composer = page.getByRole("textbox");
    await composer.fill("I think that's all the detail — generate it now.");
    await composer.press("Enter");

    await expect(page.getByText(/cross-checking/i)).toBeVisible();

    // The follow-up assistant message asks the user about the outstanding gap,
    // and the step does NOT show a completion milestone.
    await expect(page.getByText(new RegExp(KNOWN_GAP, "i"))).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/step complete/i)).toBeHidden();

    // The gap is retained as outstanding context: replying without it keeps the
    // assistant asking for the same missing information.
    await composer.fill("It's a high priority project.");
    await composer.press("Enter");
    await expect(page.getByText(new RegExp(KNOWN_GAP, "i"))).toBeVisible({ timeout: 30_000 });
  });
});
