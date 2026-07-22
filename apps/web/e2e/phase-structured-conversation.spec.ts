import { test, expect } from "./helpers/base";
import { loadSeedFixtures } from "./helpers/seed";

// E2E for the Structured Conversation output type
// (PRD: structured-conversation, ADR-038).
//
// Driven by the /e2e (Playwright MCP) skill against a running stack — it is
// excluded from the vitest unit run. Two surfaces are covered:
//
//   A. The flow config editor — a conversational node offers three output types
//      (Template / Structured conversation / Unstructured conversation).
//      Selecting Structured reveals an inline field editor, and the `section`
//      type is rejected there (it is a document-only concept).
//
//   B. The chat record card — a completed structured step surfaces a RecordCard
//      of the captured field values (no document), editable through the reused
//      manual-edit dialog.
//
// The chat surface assumes the seeded structured session (see
// apps/web/src/lib/e2e-fixtures.ts: seedStructuredSession). Set
// E2E_STRUCTURED_SESSION_PATH to override the path; E2E_FLOW_CONFIG_PATH to
// point at a flow's config canvas for the editor test.

// Resolve the seeded structured session path, or null when nothing is seeded.
function structuredSessionPath(): string | null {
  if (process.env.E2E_STRUCTURED_SESSION_PATH) return process.env.E2E_STRUCTURED_SESSION_PATH;
  const structuredSessionId = loadSeedFixtures()?.structuredSessionId;
  return structuredSessionId ? `/chats/${structuredSessionId}` : null;
}

// Resolve the seeded structured flow's config-canvas path, or null when unseeded.
function structuredFlowConfigPath(): string | null {
  if (process.env.E2E_FLOW_CONFIG_PATH) return process.env.E2E_FLOW_CONFIG_PATH;
  const structuredFlowId = loadSeedFixtures()?.structuredFlowId;
  return structuredFlowId ? `/flows/${structuredFlowId}/config` : null;
}

test.describe("structured conversation — config editor", () => {
  test("offers three output types and reveals the field editor for structured", async ({
    page,
  }) => {
    const flowConfigPath = structuredFlowConfigPath();
    if (!flowConfigPath) {
      test.skip(true, "No seeded structured flow — run the seed setup to enable this test");
      return;
    }
    await page.goto(flowConfigPath);

    // Open the structured node's config modal.
    await page.getByText(/record intake decision/i).click();

    // All three output-type labels are present.
    await expect(page.getByText("Generate document (from template)")).toBeVisible();
    await expect(page.getByText("Structured conversation")).toBeVisible();
    await expect(page.getByText("Unstructured conversation")).toBeVisible();

    // Structured reveals the inline field editor.
    await page.getByText("Structured conversation").click();
    await expect(page.getByText(/fields to capture/i)).toBeVisible();
  });

  test("captures a field via label + type + the per-field config cog", async ({ page }) => {
    const flowConfigPath = structuredFlowConfigPath();
    if (!flowConfigPath) {
      test.skip(true, "No seeded structured flow — run the seed setup to enable this test");
      return;
    }
    await page.goto(flowConfigPath);
    await page.getByText(/record intake decision/i).click();
    await page.getByText("Structured conversation").click();

    // A structured field is now one row: a label, a type dropdown, a config cog
    // and a remove button — no free-text `(type)` tags (item 7).
    const firstLabel = page.getByPlaceholder(/preferred vendor/i).first();
    await firstLabel.fill("Approved");
    await page.getByLabel(/field 1 type/i).selectOption("yesno");

    // The cog opens the per-field settings mini modal with the required toggle.
    await page.getByRole("button", { name: /configure field 1/i }).click();
    await expect(page.getByText(/field settings/i)).toBeVisible();
    await expect(page.getByLabel(/^required$/i)).toBeVisible();
  });
});

test.describe("structured conversation — record card", () => {
  test("renders the captured record with its field values and no document", async ({ page }) => {
    const sessionPath = structuredSessionPath();
    if (!sessionPath) {
      test.skip(true, "No seeded structured session — run the seed setup to enable this test");
      return;
    }
    await page.goto(sessionPath);

    // The completed structured step surfaces a record card of captured values.
    // Scope the value assertions to the card — the step name ("Record intake
    // decision") is also rendered in the message feed, so an unscoped
    // /decision/i would match two elements.
    const recordCard = page.getByTestId("record-card");
    await expect(recordCard).toBeVisible();
    await expect(recordCard.getByText(/decision/i)).toBeVisible();
    await expect(recordCard.getByText("Approved")).toBeVisible();
    await expect(recordCard.getByText("alex@acme.com")).toBeVisible();

    // No document card / download affordance for a structured step.
    await expect(page.getByText(/\.docx/i)).toBeHidden();
    await expect(page.getByRole("button", { name: /download/i })).toBeHidden();
  });

  test("edits a captured value through the reused manual-edit dialog", async ({ page }) => {
    const sessionPath = structuredSessionPath();
    if (!sessionPath) {
      test.skip(true, "No seeded structured session — run the seed setup to enable this test");
      return;
    }
    await page.goto(sessionPath);

    await page.getByRole("button", { name: /^edit$/i }).click();
    await expect(page.getByText(/edit record/i)).toBeVisible();

    // Correct the decision and save; the record card reflects the new value.
    const decisionInput = page.getByLabel(/decision/i);
    await decisionInput.fill("Rejected");
    await page.getByRole("button", { name: /save changes/i }).click();

    await expect(page.getByText("Rejected")).toBeVisible();
  });
});
