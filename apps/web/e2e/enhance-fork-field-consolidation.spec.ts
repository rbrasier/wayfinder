import { test, expect } from "./helpers/base";

// E2E for fork-sibling field consolidation in Flow Insights
// (phase: fork-field-consolidation).
//
// Driven by the /e2e (Playwright MCP) skill against a running stack — excluded
// from the vitest unit run. The flow under test is the seeded "E2E SEED Fork
// Flow" (see apps/web/src/lib/e2e-fixtures.ts): Request Intake forks into a
// Standard Purchase and a Procurement Approval branch, both capturing the same
// `amount` field, then rejoins at Save document. Two sessions each populate one
// branch.
//
//   1. By default the insights table shows ONE combined "Amount" column whose
//      subtext names both contributing branch steps.
//   2. Turning "Combine forked steps" off splits it back into per-step columns.

const FLOWS_DASHBOARD_PATH = process.env.E2E_FLOWS_DASHBOARD_PATH ?? "/admin/dashboards/flows";
const FORK_FLOW_NAME = "E2E SEED Fork Flow";

test.describe("fork-sibling field consolidation", () => {
  test("two fork branches sharing a field render as one combined column by default", async ({
    page,
  }) => {
    await page.goto(FLOWS_DASHBOARD_PATH);

    await page.getByRole("button", { name: FORK_FLOW_NAME }).click();

    // One "Amount" column header, annotated with both contributing step names.
    const amountHeaders = page.getByRole("columnheader", { name: /amount/i });
    await expect(amountHeaders).toHaveCount(1);
    await expect(page.getByText("Standard Purchase · Procurement Approval")).toBeVisible();
  });

  test("turning off 'Combine forked steps' splits the column back per step", async ({ page }) => {
    await page.goto(FLOWS_DASHBOARD_PATH);
    await page.getByRole("button", { name: FORK_FLOW_NAME }).click();

    await page.getByRole("checkbox", { name: /combine forked steps/i }).uncheck();

    // Now one Amount column per branch step.
    await expect(page.getByRole("columnheader", { name: /amount/i })).toHaveCount(2);
  });
});
