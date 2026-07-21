import { test, expect } from "./helpers/base";

// E2E for the approval-screen context & decision UX enhancement.
// (docs/development/implemented/alpha-1/v1.47.5/approval-context-ux.phase.md)
//
// Driven by the /e2e (Playwright MCP) skill against a running stack — excluded
// from the vitest unit run. Assumes the seeded pending approval from
// apps/web/src/lib/e2e-fixtures.ts (seedApprovalRequest): a session parked on an
// approval node whose previous document step produced "purchase-request.docx",
// with the approval assigned to the signed-in user.
//
// The feature under test on /approvals:
//   1. The card carries the chat name and the previous step's document (the card
//      reused from the chat), not just "Approval requested".
//   2. A decision is taken by clicking Approve / Reject / Request changes, which
//      opens a comment modal — Reject offers "Route back to user" and "Close
//      request".
//   3. Recording a decision clears the request from the queue (or, when email is
//      not configured, surfaces the manual "Copy link" fallback).
//
// Assertions are about the card-context + decision-modal contract, never that a
// specific approver was emailed, so they stay deterministic in the sandbox.

const APPROVALS_PATH = process.env.E2E_APPROVALS_PATH ?? "/approvals";
const SEED_CHAT_NAME = "E2E SEED Approval Session";
const SEED_DOCUMENT = "purchase-request.docx";

test.describe("approval screen context & decision UX", () => {
  test("the card shows the chat name and the document being approved", async ({ page }) => {
    await page.goto(APPROVALS_PATH);

    const chatName = page.getByText(SEED_CHAT_NAME).first();
    test.skip(
      !(await chatName.isVisible().catch(() => false)),
      "No seeded approval is awaiting this user — approvals queue is empty",
    );

    // The previous step's key output renders as the same document card used in
    // the chat, including the rationale info icon.
    await expect(page.getByText(SEED_DOCUMENT).first()).toBeVisible();
    await expect(
      page.getByRole("button", { name: /document confidence breakdown/i }).first(),
    ).toBeVisible();
  });

  test("Reject opens a comment modal offering route-back or close", async ({ page }) => {
    await page.goto(APPROVALS_PATH);

    const card = page.locator("[data-approval-status='pending']").first();
    test.skip(
      !(await card.isVisible().catch(() => false)),
      "No seeded approval is awaiting this user — approvals queue is empty",
    );

    await card.getByRole("button", { name: "Reject", exact: true }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: /route back to user/i })).toBeVisible();
    await expect(dialog.getByRole("button", { name: /close request/i })).toBeVisible();

    // Dismiss without deciding so the queue is untouched for the next test.
    await page.keyboard.press("Escape");
  });

  test("recording a decision clears the request from the queue", async ({ page }) => {
    await page.goto(APPROVALS_PATH);

    const card = page.locator("[data-approval-status='pending']").first();
    test.skip(
      !(await card.isVisible().catch(() => false)),
      "No seeded approval is awaiting this user — approvals queue is empty",
    );

    await card.getByRole("button", { name: "Approve", exact: true }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: /confirm approval/i }).click();

    // Either the request leaves the queue (email configured) or the manual
    // notify fallback appears (email not configured) — both are terminal.
    await expect(
      page
        .getByText(/no approvals awaiting you/i)
        .or(page.getByRole("button", { name: /copy link/i })),
    ).toBeVisible({ timeout: 15000 });
  });
});
