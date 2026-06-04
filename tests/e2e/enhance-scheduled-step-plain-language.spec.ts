/**
 * enhance-scheduled-step-plain-language.spec.ts
 *
 * Covers v1.31.0 — Scheduled-Step Plain-Language UX.
 *
 * Authors a scheduled step through the new plain-English controls:
 *   "When should this run?" → "Repeat on a schedule" → Every 2 weeks
 * and confirms the live recurrence summary renders in the modal and that the
 * saved step shows the same human summary on the canvas (no raw cron/JSON).
 *
 * The scheduled step type sits behind the `scheduled_node` feature flag; when
 * it is off in this environment the test skips rather than failing.
 */

import type { Page } from '@playwright/test';
import { test, expect } from './helpers/base';

async function createFlowAndOpenCanvas(page: Page, name: string): Promise<void> {
  await page.goto('/admin/flows');
  await page.waitForLoadState('networkidle');

  await page.getByRole('button', { name: /new flow/i }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();

  await page.locator('#flow-name').fill(name);
  await page.locator('#flow-expert-role').fill('E2E Test Expert');
  await page.getByRole('button', { name: /create flow/i }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 });

  const editLink = page.getByRole('link', { name: 'Configure Flow' }).first();
  await expect(editLink).toBeVisible({ timeout: 5_000 });
  await editLink.click();

  await page.waitForURL(/\/admin\/flows\/[^/]+$/, { timeout: 10_000 });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1_200);
}

test.describe('Admin: Scheduled step plain-language recurrence', () => {
  test('authors a recurring scheduled step and shows its human summary', async ({ page, consoleLogs }) => {
    const flowName = `E2E Scheduled ${Date.now()}`;
    await createFlowAndOpenCanvas(page, flowName);

    await page.getByRole('button', { name: '+ Add step' }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });

    // Scheduled steps are feature-flagged; skip cleanly when unavailable.
    const scheduledType = page.locator('label', { hasText: /^Scheduled$/ }).first();
    if (!(await scheduledType.isVisible().catch(() => false))) {
      test.skip(true, 'scheduled_node feature flag is off in this environment');
      return;
    }

    await page.locator('#node-name').fill('Follow-up reminder');
    await scheduledType.click();

    // Plain-language scheduling: repeat on a schedule.
    await page.locator('#schedule-kind').selectOption('recurrence');
    await page.locator('#recurrence-frequency').selectOption('weekly');
    await page.locator('#recurrence-interval').fill('2');

    // The live summary must read as plain English, not cron/JSON.
    const summary = page.getByText(/Every 2 weeks/i).first();
    await expect(summary).toBeVisible();
    await page.screenshot({ path: 'screenshots/scheduled-plain-language-modal.png', fullPage: true });

    await page.getByRole('button', { name: /^Save$/i }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(400);

    await expect(page.locator('.react-flow__node')).toHaveCount(1);
    // The canvas subtitle shows the same human summary that was previewed.
    await expect(page.locator('.react-flow__node').getByText(/Every 2 weeks/i)).toBeVisible();
    await page.screenshot({ path: 'screenshots/scheduled-plain-language-canvas.png', fullPage: true });

    const errors = consoleLogs.filter((log) => log.type === 'error');
    expect(errors, `JS errors:\n${errors.map((error) => error.text).join('\n')}`).toHaveLength(0);
  });
});
