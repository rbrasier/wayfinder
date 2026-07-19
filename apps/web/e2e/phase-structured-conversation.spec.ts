import { expect, test } from "@playwright/test";

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

const SESSION_PATH =
  process.env.E2E_STRUCTURED_SESSION_PATH ?? "/chats/e2e-seed-structured-session";
const FLOW_CONFIG_PATH = process.env.E2E_FLOW_CONFIG_PATH ?? "/flows/e2e-seed-structured-flow/config";

test.describe("structured conversation — config editor", () => {
  test("offers three output types and reveals the field editor for structured", async ({
    page,
  }) => {
    await page.goto(FLOW_CONFIG_PATH);

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

  test("rejects a section field in a structured set and blocks saving", async ({ page }) => {
    await page.goto(FLOW_CONFIG_PATH);
    await page.getByText(/record intake decision/i).click();
    await page.getByText("Structured conversation").click();

    // A section tag is not allowed in a structured field set (ADR-038 §5).
    const firstField = page.getByPlaceholder(/preferred vendor/i).first();
    await firstField.fill("#Optional Clause");
    await expect(page.getByText(/only available for document templates/i)).toBeVisible();

    // The invalid set disables Save.
    await expect(page.getByRole("button", { name: /^save$/i })).toBeDisabled();
  });
});

test.describe("structured conversation — record card", () => {
  test("renders the captured record with its field values and no document", async ({ page }) => {
    await page.goto(SESSION_PATH);

    // The completed structured step surfaces a record card of captured values.
    await expect(page.getByText("Record", { exact: true })).toBeVisible();
    await expect(page.getByText(/decision/i)).toBeVisible();
    await expect(page.getByText("Approved")).toBeVisible();
    await expect(page.getByText("alex@acme.com")).toBeVisible();

    // No document card / download affordance for a structured step.
    await expect(page.getByText(/\.docx/i)).toBeHidden();
    await expect(page.getByRole("button", { name: /download/i })).toBeHidden();
  });

  test("edits a captured value through the reused manual-edit dialog", async ({ page }) => {
    await page.goto(SESSION_PATH);

    await page.getByRole("button", { name: /^edit$/i }).click();
    await expect(page.getByText(/edit record/i)).toBeVisible();

    // Correct the decision and save; the record card reflects the new value.
    const decisionInput = page.getByLabel(/decision/i);
    await decisionInput.fill("Rejected");
    await page.getByRole("button", { name: /save changes/i }).click();

    await expect(page.getByText("Rejected")).toBeVisible();
  });
});
