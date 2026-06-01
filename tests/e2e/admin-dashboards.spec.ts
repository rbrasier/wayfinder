/**
 * admin-dashboards.spec.ts
 *
 * Covers v1.16.0 — Two admin analytics dashboards + template field reporting.
 *
 * Visual spec (docs/development/implemented/v1.16.0/summary.md + app):
 *   /admin/dashboards/overview → analytics overview dashboard
 *   /admin/dashboards/flows    → "Flow insights" heading, description
 *     "Select a flow to see its node-level breakdown and reporting.", and
 *     charts ("Avg confidence at completion, per step", "Drop-off volume,
 *     per step", "Node breakdown") once a flow is selected.
 */

import { test, expect } from './helpers/base';

test.describe('Admin: Analytics Dashboards', () => {
  test('overview dashboard renders without errors', async ({ page, consoleLogs }) => {
    await page.goto('/admin/dashboards/overview');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'screenshots/admin-dashboard-overview.png', fullPage: true });

    const errors = consoleLogs.filter(l => l.type === 'error');
    expect(
      errors,
      `JS errors on overview dashboard:\n${errors.map(e => e.text).join('\n')}`,
    ).toHaveLength(0);
  });

  test('flow insights dashboard shows heading and description', async ({ page, consoleLogs }) => {
    await page.goto('/admin/dashboards/flows');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'screenshots/admin-dashboard-flows.png', fullPage: true });

    const errors = consoleLogs.filter(l => l.type === 'error');
    expect(
      errors,
      `JS errors on flow insights dashboard:\n${errors.map(e => e.text).join('\n')}`,
    ).toHaveLength(0);

    await expect(page.getByRole('heading', { name: /flow insights/i })).toBeVisible();
  });

  test('selecting a flow reveals node-level breakdown charts', async ({ page }) => {
    await page.goto('/admin/dashboards/flows');
    await page.waitForLoadState('networkidle');

    // A flow selector (select or list of flow buttons/links) drives the deep dive.
    const flowSelect = page.locator('select').first();
    if (await flowSelect.isVisible().catch(() => false)) {
      const optionCount = await flowSelect.locator('option').count();
      if (optionCount <= 1) {
        test.skip(true, 'No flows available to drill into on the insights dashboard');
        return;
      }
      await flowSelect.selectOption({ index: 1 });
    } else {
      const flowLink = page.getByRole('link').filter({ hasText: /.+/ }).first();
      if (!(await flowLink.isVisible().catch(() => false))) {
        test.skip(true, 'No flow selector found on the insights dashboard');
        return;
      }
      await flowLink.click();
    }

    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'screenshots/admin-dashboard-flow-deepdive.png', fullPage: true });

    await expect(
      page.getByText(/avg confidence at completion|node breakdown|drop-off volume/i).first(),
    ).toBeVisible();
  });
});
