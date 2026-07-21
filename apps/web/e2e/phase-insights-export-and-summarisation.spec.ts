import { test, expect } from "./helpers/base";

// E2E for Insights Export & On-Screen Summarisation
// (phase: insights-export-and-summarisation).
//
// Driven by the /e2e (Playwright MCP) skill against a running stack — excluded
// from the vitest unit run. The flow under test is the seeded "E2E SEED Fork
// Flow" (see apps/web/src/lib/e2e-fixtures.ts): two sessions each capture the
// currency field `amount` ($1,500 and $2,750) which the insights table combines
// into one "Amount" column.
//
//   1. Export downloads a real .xlsx named after the flow and the current date.
//   2. Summarise opens a side drawer whose pivot sums the currency column to
//      $4,250 across the two filtered sessions, with the source table still
//      visible behind it.
//   3. A filter that matches no sessions disables both actions.

const INSIGHTS_PATH = process.env.E2E_INSIGHTS_PATH ?? "/admin/dashboards/insights";
const FORK_FLOW_NAME = "E2E SEED Fork Flow";

test.describe("insights export & summarisation", () => {
  test("Export downloads an .xlsx mirroring the current view", async ({ page }) => {
    await page.goto(INSIGHTS_PATH);
    await page.getByRole("button", { name: FORK_FLOW_NAME }).click();

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export" }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(
      /^E2E-SEED-Fork-Flow-insights-\d{4}-\d{2}-\d{2}\.xlsx$/,
    );
  });

  test("Summarise drawer sums the currency column across filtered sessions", async ({ page }) => {
    await page.goto(INSIGHTS_PATH);
    await page.getByRole("button", { name: FORK_FLOW_NAME }).click();

    await page.getByRole("button", { name: "Summarise" }).click();

    const drawer = page.getByRole("dialog");
    await expect(drawer.getByRole("heading", { name: "Summarise" })).toBeVisible();

    // Sum of the "Amount" currency column: $1,500 + $2,750 = $4,250.
    await drawer.getByLabel("Measure").selectOption("sum");
    await expect(drawer.getByText("$4,250")).toBeVisible();

    // The source report table is still on the page behind the drawer. A CSS
    // locator is used deliberately: the modal marks the rest of the page
    // aria-hidden, so a role query would filter the still-visible table out.
    await expect(page.locator("table").first()).toBeVisible();
  });

  test("a zero-match filter disables Export and Summarise", async ({ page }) => {
    await page.goto(INSIGHTS_PATH);
    await page.getByRole("button", { name: FORK_FLOW_NAME }).click();

    // No seeded fork session is abandoned, so this filter matches nothing.
    await page.getByLabel("Status").selectOption("abandoned");

    await expect(page.getByText(/No sessions match/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Export" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Summarise" })).toBeDisabled();
  });
});
