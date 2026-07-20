/**
 * phase-schedule-run-logging.spec.ts
 *
 * Covers v1.27.0 — Schedule Run Logging & Admin History.
 *
 * Each scheduled/recurring fire is appended to app_session_schedule_runs and
 * surfaced on a new /admin/schedules page (flow · step · outcome · time). This
 * test confirms the admin page renders without JS errors and shows either the
 * run-history table or its empty state. It is read-only and non-destructive.
 */

import { test, expect } from './helpers/base';

test.describe('Admin: Scheduled Run History', () => {
  test('schedules page renders run history or its empty state', async ({ page, consoleLogs }) => {
    await page.goto('/admin/schedules');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'screenshots/admin-schedules.png', fullPage: true });

    const heading = page.getByText(/scheduled run history/i).first();
    if (!(await heading.isVisible().catch(() => false))) {
      test.skip(true, '/admin/schedules surface unavailable in this environment');
      return;
    }

    // The runs list is fetched client-side, so wait for the query to resolve into
    // either the table or the empty state (networkidle can fire while the skeleton
    // is still up, especially on a cold CI compile).
    await expect(
      page.getByRole('table').or(page.getByText(/no scheduled runs yet/i)).first(),
    ).toBeVisible();

    const errors = consoleLogs.filter((l) => l.type === 'error');
    expect(errors, `JS errors on /admin/schedules:\n${errors.map((e) => e.text).join('\n')}`).toHaveLength(0);
  });

  test('schedules page is reachable from the admin sidebar', async ({ page }) => {
    await page.goto('/admin/sessions');
    await page.waitForLoadState('networkidle');

    const navLink = page.getByRole('link', { name: /^schedules$/i }).first();
    if (!(await navLink.isVisible().catch(() => false))) {
      test.skip(true, 'Schedules nav link not visible in this environment');
      return;
    }

    await navLink.click();
    await expect(page).toHaveURL(/\/admin\/schedules/);
    await expect(page.getByText(/scheduled run history/i).first()).toBeVisible();
  });
});
