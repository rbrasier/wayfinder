import { expect, test } from "@playwright/test";

// E2E regression for the document-generation step-flow follow-ups (fix:
// fix-document-generation-step-flow, v1.58.6).
//
// Driven by the /e2e (Playwright MCP) skill against a running stack — excluded
// from the vitest unit run. Reproduces the two defects the user reported on a
// `generate_document` flow with a policy context doc:
//
//   Bug 1 — after a step crosses the threshold and the document begins
//     generating, the session concurrently opened the NEXT step. Before the fix
//     the next step's opener appeared while the document was still generating;
//     after the fix generation is awaited, so a "Generating document…" badge
//     shows and the next step only appears once the document exists.
//
//   Bug 2 — on the final (terminal) step the cross-check passed but nothing
//     progressed: no document was rendered and the step was never shown as
//     complete ("Show Data" reported nothing). Before the fix the terminal
//     step's document was orphaned (never persisted) and its milestone was
//     suppressed because advancing into a terminal node leaves currentNodeId on
//     the final node; after the fix the document is generated and the terminal
//     "Step complete" pill + document card render.

const STEP_FLOW_SESSION_PATH =
  process.env.E2E_STEP_FLOW_SESSION_PATH ?? "/chats/e2e-seed-step-flow-session";

test.describe("document generation — step flow", () => {
  test("waits for the document before opening the next step, and renders the terminal document", async ({
    page,
  }) => {
    await page.goto(STEP_FLOW_SESSION_PATH);

    const composer = page.getByRole("textbox");

    // ── Step 1 (non-terminal doc step): submit, cross-check passes. ──────────
    await composer.fill("Yes, that's everything — please submit it.");
    await composer.press("Enter");

    // Bug 1: while the document is generated, the "Generating document…" badge is
    // shown and the NEXT step's opener has NOT appeared yet.
    await expect(page.getByText(/generating document/i)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/— IT Equipment Request —/i)).toHaveCount(0);

    // Once generation finishes: the step-1 document renders, and only then does
    // the next step open.
    await expect(page.getByText(/step complete/i).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/\.docx/i).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/— IT Equipment Request —/i)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/generating document/i)).toBeHidden({ timeout: 30_000 });

    // ── Terminal step: complete it; the cross-check passes. ──────────────────
    await composer.fill("A laptop please, requested by Richard Brasier. That's everything.");
    await composer.press("Enter");

    // Bug 2: the terminal step generates and renders its document AND shows the
    // completed-step milestone — it does not silently stall.
    await expect(page.getByText(/flow complete/i)).toBeVisible({ timeout: 30_000 });
    const documents = page.getByText(/\.docx/i);
    await expect(documents).toHaveCount(2, { timeout: 30_000 });
    await expect(page.getByText(/generating document/i)).toBeHidden({ timeout: 30_000 });
  });
});
