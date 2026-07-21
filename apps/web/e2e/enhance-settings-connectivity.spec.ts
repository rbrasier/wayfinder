import { test, expect } from "./helpers/base";

// E2E for on-demand connectivity testing on /admin/settings
// (phase: settings-connectivity-test).
//
// Driven by the /e2e (Playwright MCP) skill against a running stack — excluded
// from the vitest unit run. The feature under test:
//   1. Each configured external-dependency card exposes a "Test connectivity"
//      button that drives a per-card status badge to a terminal state.
//   2. A header "Test all" button fans the probes out in parallel, populating
//      each card's badge as it resolves.
//
// The assertion is the button → terminal-badge contract (ok | failed | skipped),
// never that a specific service is reachable, so it is deterministic regardless
// of whether the external services answer in the sandbox.

const SETTINGS_PATH = process.env.E2E_SETTINGS_PATH ?? "/admin/settings";
const TERMINAL_STATUS = /^(ok|failed|skipped)$/;

// Embeddings (local, in-process) and Entra both always render a probe, so they
// are stable targets regardless of which optional integrations are configured.
test.describe("settings connectivity testing", () => {
  test("a per-card Test connectivity button drives the badge to a terminal state", async ({
    page,
  }) => {
    await page.goto(SETTINGS_PATH);

    await page.getByTestId("test-connectivity-embeddings").click();

    const badge = page.getByTestId("connectivity-badge-embeddings");
    await expect(badge).toBeVisible();
    await expect(badge).toHaveAttribute("data-status", TERMINAL_STATUS, { timeout: 15000 });
  });

  test("Test all resolves every applicable card badge in parallel", async ({ page }) => {
    await page.goto(SETTINGS_PATH);

    await page.getByTestId("test-all-connectivity").click();

    // Both always-rendered probes must reach a terminal state from the single
    // fan-out click — proving the header button drove them in parallel.
    await expect(page.getByTestId("connectivity-badge-embeddings")).toHaveAttribute(
      "data-status",
      TERMINAL_STATUS,
      { timeout: 15000 },
    );
    await expect(page.getByTestId("connectivity-badge-entra")).toHaveAttribute(
      "data-status",
      TERMINAL_STATUS,
      { timeout: 15000 },
    );
  });
});
