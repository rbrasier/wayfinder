/**
 * phase-mcp-integration.spec.ts
 *
 * Covers:
 *   v2.2.0 — MCP server registry (Phase 2a of the Flow Skills & MCP PRD,
 *            ADR-032). An admin can register a remote SSE MCP server, see it
 *            listed, disable/enable it, and is blocked on an invalid URL.
 *
 * Visual spec:
 *   /admin/mcp-servers → "Register an MCP server" card (Label / Transport / URL /
 *   Credential ref inputs + Register button) and a "Registered servers" table
 *   with Test / Disable / Enable actions per row.
 *
 * Connection Test is not asserted here — it requires a live MCP server.
 */

import { test, expect } from './helpers/base';

test.describe('MCP servers', () => {
  test('an admin can register a remote MCP server and see it listed', async ({ page }) => {
    await page.goto('/admin/mcp-servers');

    await page.getByLabel('Label').fill('E2E GitHub');
    await page.getByLabel('URL', { exact: true }).fill('https://mcp.example.com/sse');
    await page.getByLabel(/credential ref/i).fill('MCP_CRED_E2E_TOKEN');
    await page.getByRole('button', { name: /register server/i }).click();

    const row = page.getByRole('row', { name: /E2E GitHub/i }).first();
    await expect(row).toBeVisible();
    await expect(row.getByText('active')).toBeVisible();
  });

  test('an invalid URL surfaces a validation error', async ({ page }) => {
    await page.goto('/admin/mcp-servers');

    await page.getByLabel('Label').fill('Bad Server');
    await page.getByLabel('URL', { exact: true }).fill('not-a-url');
    await page.getByRole('button', { name: /register server/i }).click();

    await expect(page.getByText(/valid http\(s\) URL/i)).toBeVisible();
  });

  test('a registered server can be disabled', async ({ page }) => {
    await page.goto('/admin/mcp-servers');

    const row = page.getByRole('row', { name: /E2E GitHub/i }).first();
    await row.getByRole('button', { name: /^disable$/i }).click();

    await expect(row.getByRole('button', { name: /^enable$/i })).toBeVisible();
  });
});
