/**
 * enhance-flow-editor-dedup.spec.ts
 *
 * Covers the flow-editor consolidation (v2.4.11). The canvas editor used to
 * exist twice — an admin copy at /admin/flows/[id] and a user copy at
 * /flows/[id]/config. There is now a single canonical editor at
 * /flows/[id]/config; the old admin path redirects to it, and the admin flows
 * list links straight there.
 */

import { test, expect } from './helpers/base';
import { loadSeedFixtures } from './helpers/seed';

test.describe('Flow editor consolidation', () => {
  test('the retired /admin/flows/[id] path redirects to the canonical editor', async ({ page }) => {
    const flowId = loadSeedFixtures()?.flowId;
    test.skip(!flowId, 'No seeded flow available');

    await page.goto(`/admin/flows/${flowId}`);

    await expect(page).toHaveURL(new RegExp(`/flows/${flowId}/config$`));
  });

  test("admin 'Configure Flow' opens the canonical /flows/[id]/config editor", async ({ page }) => {
    await page.goto('/admin/flows');
    await page.waitForLoadState('networkidle');

    const editLink = page.getByRole('link', { name: 'Configure Flow' }).first();
    test.skip(
      !(await editLink.isVisible({ timeout: 5_000 }).catch(() => false)),
      'No flows available in the admin list',
    );

    await editLink.click();

    await page.waitForURL(/\/flows\/[^/]+\/config$/, { timeout: 30_000 });
    await expect(page.getByRole('button', { name: '+ Add step' })).toBeVisible({ timeout: 10_000 });
  });
});
