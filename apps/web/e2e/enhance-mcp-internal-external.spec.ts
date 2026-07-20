/**
 * enhance-mcp-internal-external.spec.ts
 *
 * Covers:
 *   v2.5.0 — MCP internal/external server governance. An admin can classify a
 *            server as "Permitted to communicate outside Wayfinder"; the registry
 *            shows a Scope (Internal/External) badge. External servers are not
 *            offered in flow pickers (enforced in the directory/use-cases; the
 *            unit tests cover the resolution/runtime paths).
 *
 * Requires a running stack; not executed in the migration sandbox.
 */

import { test, expect } from './helpers/base';

test.describe('MCP internal/external classification', () => {
  test('an admin registers an internal server (default) — shown as Internal', async ({ page }) => {
    await page.goto('/admin/mcp-servers');

    await page.getByLabel('Label').fill('E2E Spellcheck');
    await page.getByLabel('URL').fill('http://spellcheck:8000/mcp');
    await page.getByRole('button', { name: /register server/i }).click();

    const row = page.getByRole('row', { name: /E2E Spellcheck/i }).first();
    await expect(row.getByText('Internal')).toBeVisible();
  });

  test('an admin registers an external integration — shown as External', async ({ page }) => {
    await page.goto('/admin/mcp-servers');

    await page.getByLabel('Label').fill('E2E Integration');
    await page.getByLabel('URL').fill('https://integration.example.com/sse');
    await page.getByLabel(/permitted to communicate outside wayfinder/i).check();
    await page.getByRole('button', { name: /register server/i }).click();

    const row = page.getByRole('row', { name: /E2E Integration/i }).first();
    await expect(row.getByText('External')).toBeVisible();
  });
});
