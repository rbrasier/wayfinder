/**
 * admin-dashboards.spec.ts
 *
 * Covers v1.16.0 — Two admin analytics dashboards + template field reporting.
 *
 * Visual spec (docs/development/implemented/v1.16.0/summary.md + app):
 *   /admin/dashboards/overview  → analytics overview dashboard
 *   /admin/dashboards/flows     → "Flow usage" heading, description
 *     "Select a flow to see its node-level breakdown …", and charts
 *     ("Avg confidence at completion, per step", "Drop-off volume,
 *     per step", "Node breakdown") once a flow is selected.
 *   /admin/dashboards/insights  → "Flow insights" heading + template field report.
 */

import type { Page } from '@playwright/test';
import { test, expect } from './helpers/base';

// The flow-insights dashboard is client-fetched: it shows "Loading…" until the
// tRPC query resolves, then settles into either its empty state ("No flows
// yet") or the "Flow insights" heading. `networkidle` can fire mid-load, so wait
// for one of the terminal states before deciding whether to skip.
async function waitForFlowUsageSettled(page: Page): Promise<void> {
  await page
    .waitForFunction(
      () => /no flows yet/i.test(document.body.innerText) || /flow usage/i.test(document.body.innerText),
      undefined,
      { timeout: 15_000 },
    )
    .catch(() => undefined);
}

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

  test('flow usage dashboard shows heading and description', async ({ page, consoleLogs }) => {
    await page.goto('/admin/dashboards/flows');
    await page.waitForLoadState('networkidle');
    await waitForFlowUsageSettled(page);
    await page.screenshot({ path: 'screenshots/admin-dashboard-flows.png', fullPage: true });

    const errors = consoleLogs.filter(l => l.type === 'error');
    expect(
      errors,
      `JS errors on flow usage dashboard:\n${errors.map(e => e.text).join('\n')}`,
    ).toHaveLength(0);

    // With no flows the whole dashboard is replaced by an empty-state message;
    // the heading only renders once at least one flow exists.
    if (await page.getByText(/no flows yet/i).isVisible().catch(() => false)) {
      test.skip(true, 'No flows yet — usage dashboard shows its empty state');
      return;
    }

    await expect(page.getByRole('heading', { name: /flow usage/i })).toBeVisible();
    await expect(page.getByText(/select a flow to see its node-level breakdown/i)).toBeVisible();
  });

  test('flow insights dashboard shows heading and template field report', async ({ page, consoleLogs }) => {
    await page.goto('/admin/dashboards/insights');
    await page.waitForLoadState('networkidle');
    await page
      .waitForFunction(
        () => /no flows yet/i.test(document.body.innerText) || /flow insights/i.test(document.body.innerText),
        undefined,
        { timeout: 15_000 },
      )
      .catch(() => undefined);

    const errors = consoleLogs.filter(l => l.type === 'error');
    expect(
      errors,
      `JS errors on flow insights dashboard:\n${errors.map(e => e.text).join('\n')}`,
    ).toHaveLength(0);

    if (await page.getByText(/no flows yet/i).isVisible().catch(() => false)) {
      test.skip(true, 'No flows yet — insights dashboard shows its empty state');
      return;
    }

    await expect(page.getByRole('heading', { name: /flow insights/i })).toBeVisible();
    await expect(page.getByText(/template field reporting/i)).toBeVisible();
  });

  test('selecting a flow reveals node-level breakdown charts', async ({ page }) => {
    await page.goto('/admin/dashboards/flows');
    await page.waitForLoadState('networkidle');
    await waitForFlowUsageSettled(page);

    if (await page.getByText(/no flows yet/i).isVisible().catch(() => false)) {
      test.skip(true, 'No flows yet — nothing to drill into on the insights dashboard');
      return;
    }

    // Each flow is a button showing its name + "N session(s)".
    const flowButton = page.getByRole('button').filter({ hasText: /\bsessions?\b/i }).first();
    if (await flowButton.isVisible().catch(() => false)) {
      await flowButton.click();
    }

    await page.screenshot({ path: 'screenshots/admin-dashboard-flow-deepdive.png', fullPage: true });

    // Chart cards + the node breakdown table render whenever a flow is selected,
    // regardless of whether that flow has any recorded session activity.
    await expect(
      page.getByText(/avg confidence at completion|node breakdown|drop-off volume/i).first(),
    ).toBeVisible();
  });
});
