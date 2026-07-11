/**
 * enhance-skill-picker-and-flow-settings.spec.ts
 *
 * Covers:
 *   v2.4.1 — review feedback (PR #132, Richard):
 *     - #3a: skill selection moved to a compact "Add skills" button beside the
 *       AI-instructions box that opens a searchable picker modal; selected
 *       skills render as removable chips.
 *     - #3c: MCP Servers, Skills and Knowledge grouped under a "Flow Settings"
 *       admin sub-menu.
 *
 * Assumes an authenticated admin with the `skills` power-user flag enabled.
 * Requires a running stack; not executed in the migration sandbox.
 */

import { test, expect } from './helpers/base';

test.describe('Skill picker modal', () => {
  test('the AI-instructions box exposes an "Add skills" button that opens the picker', async ({ page }) => {
    await page.goto('/admin/flows');
    await page.getByRole('link', { name: /flow/i }).first().click();

    // Open a conversational step's config.
    await page.locator('.react-flow__node').first().dblclick();

    await page.getByRole('button', { name: /add skills/i }).click();
    await expect(page.getByRole('dialog').getByText('Add skills')).toBeVisible();
    await expect(page.getByPlaceholder('Search skills…')).toBeVisible();
  });
});

test.describe('Flow Settings admin sub-menu', () => {
  test('groups Skills, MCP Servers and Knowledge under a Flow Settings heading', async ({ page }) => {
    await page.goto('/admin/flows');

    await expect(page.getByText('Flow Settings', { exact: true })).toBeVisible();
    const nav = page.getByRole('navigation');
    await expect(nav.getByRole('link', { name: 'Skills' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'MCP Servers' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Knowledge' })).toBeVisible();
  });
});
