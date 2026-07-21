import { test, expect } from "./helpers/base";

// E2E for bug #3: producing a document for a flow whose reference documents are
// very large must no longer overflow the model context window. The context-doc
// section is budget-capped and generation runs in field batches.
// (docs/development/implemented/alpha-1/v1.49.0/fix-flow-authored-data-trust.md)
//
// Driven by the /e2e (Playwright MCP) skill against a running stack with a real
// AI key. On the unfixed code, document generation dumped the full extracted
// text of every context doc (~226k tokens for the PIA flow) and failed with
// "AI_APICallError: prompt is too long". With budgeting + batching it succeeds.
//
// Assumes a seeded session that has reached a generate_document step on a flow
// whose context docs exceed the per-prompt budget. Set E2E_SESSION_PATH and
// E2E_GENERATE_STEP_LABEL to override.

const SESSION_PATH = process.env.E2E_SESSION_PATH ?? "/chats/e2e-seed-large-context-session";

test.describe("document generation does not overflow the context window", () => {
  test("the generated document reaches a ready state rather than failing", async ({ page }) => {
    await page.goto(SESSION_PATH);

    const composer = page.getByRole("textbox");
    test.skip(
      !(await composer.isVisible().catch(() => false)),
      "Session is read-only — cannot drive the generate step",
    );

    // Nudge the step to completion so the document generates.
    await composer.fill("That's everything — please produce the report.");
    await composer.press("Enter");

    // The document card must resolve to a downloadable/ready state, never the
    // failed state the overflow used to produce.
    const failed = page.getByText(/document generation failed|could not be generated/i);
    await expect(failed).toHaveCount(0, { timeout: 60_000 });

    const ready = page.getByRole("link", { name: /download|\.docx/i }).first();
    await expect(ready).toBeVisible({ timeout: 60_000 });
  });
});
