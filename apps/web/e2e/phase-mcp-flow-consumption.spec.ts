import { expect, test } from "@playwright/test";

// E2E for MCP flow consumption (Phase 2b, ADR-032): adding a deterministic MCP
// Tool step to a flow, and allowing MCP tools on a conversational step.
//
// Driven by the /e2e (Playwright MCP) skill against a running stack — excluded
// from the vitest unit run. Assumes an authenticated admin storageState and at
// least one flow plus one registered MCP server. Selectors mirror the canvas
// node-type picker and the step config modal.

test.describe("mcp flow consumption", () => {
  test("an author can add an MCP Tool step from the node picker", async ({ page }) => {
    await page.goto("/admin/flows");
    await page.getByRole("link", { name: /flow/i }).first().click();

    await page.getByRole("button", { name: /add step/i }).first().click();
    await page.getByText("MCP Tool", { exact: true }).click();

    // The MCP step config exposes a server selector.
    await expect(page.getByLabel("MCP server")).toBeVisible();
  });

  test("a conversational step exposes an allowed MCP tools picker", async ({ page }) => {
    await page.goto("/admin/flows");
    await page.getByRole("link", { name: /flow/i }).first().click();

    // Open the first conversational step's config (double-click its canvas node).
    await page.locator(".react-flow__node").first().dblclick();

    await expect(page.getByText("MCP tools", { exact: true })).toBeVisible();
  });
});
