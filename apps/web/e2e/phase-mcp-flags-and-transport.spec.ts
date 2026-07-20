/**
 * phase-mcp-flags-and-transport.spec.ts
 *
 * Covers:
 *   v2.4.0 — MCP/Skills power-user flag gating + streamable-HTTP transport.
 *            An admin can register a streamable-HTTP MCP server and see its
 *            transport listed. (Flag gating of the in-flow Skills/MCP sections
 *            is unit-covered in seed-roles; a full gated-user e2e needs flag
 *            fixtures and is deferred.)
 *
 * Visual spec:
 *   /admin/mcp-servers → "Register an MCP server" card now has a Transport
 *   selector (SSE / Streamable HTTP); the table shows a Transport column.
 *
 * Requires a running stack; not executed in the migration sandbox.
 */

import { test, expect } from './helpers/base';

test.describe('MCP transport', () => {
  test('an admin can register a streamable-HTTP MCP server', async ({ page }) => {
    await page.goto('/admin/mcp-servers');

    await page.getByLabel('Label').fill('E2E Streamable');
    await page.getByLabel('Transport').selectOption('streamable-http');
    await page.getByLabel('URL').fill('http://mcp.example.com/mcp');
    await page.getByRole('button', { name: /register server/i }).click();

    const row = page.getByRole('row', { name: /E2E Streamable/i }).first();
    await expect(row).toBeVisible();
    await expect(row.getByText('Streamable HTTP')).toBeVisible();
  });
});
