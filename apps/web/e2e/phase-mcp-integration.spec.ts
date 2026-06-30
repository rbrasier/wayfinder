import { expect, test } from "@playwright/test";

// E2E for MCP server registration (Phase 2a of the Flow Skills & MCP PRD,
// ADR-032).
//
// Driven by the /e2e (Playwright MCP) skill against a running stack — it is
// excluded from the vitest unit run. Assumes an authenticated admin storageState.
// Connection Test is not asserted here because it requires a live MCP server.

test.describe("mcp servers", () => {
  test("an admin can register a remote MCP server and see it listed", async ({ page }) => {
    await page.goto("/admin/mcp-servers");

    await page.getByLabel("Label").fill("E2E GitHub");
    await page.getByLabel("SSE URL").fill("https://mcp.example.com/sse");
    await page.getByLabel(/credential ref/i).fill("MCP_E2E_TOKEN");
    await page.getByRole("button", { name: /register server/i }).click();

    const row = page.getByRole("row", { name: /E2E GitHub/i }).first();
    await expect(row).toBeVisible();
    await expect(row.getByText("active")).toBeVisible();
  });

  test("an invalid URL surfaces a validation error", async ({ page }) => {
    await page.goto("/admin/mcp-servers");

    await page.getByLabel("Label").fill("Bad Server");
    await page.getByLabel("SSE URL").fill("not-a-url");
    await page.getByRole("button", { name: /register server/i }).click();

    await expect(page.getByText(/valid http\(s\) URL/i)).toBeVisible();
  });

  test("a registered server can be disabled", async ({ page }) => {
    await page.goto("/admin/mcp-servers");

    const row = page.getByRole("row", { name: /E2E GitHub/i }).first();
    await row.getByRole("button", { name: /^disable$/i }).click();

    await expect(row.getByRole("button", { name: /^enable$/i })).toBeVisible();
  });
});
