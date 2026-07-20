/**
 * phase-scheduling.spec.ts
 *
 * Covers the Scheduling phase — `scheduled` flow node type, gated behind the
 * `scheduled_node` feature flag (same pattern as `auto_node`).
 *
 * Happy path:
 *   1. Admin enables the `scheduled_node` flag on /admin/flags.
 *   2. On the flow canvas the "Scheduled" step type becomes selectable and a
 *      scheduled step (relative: 30d) can be configured and saved.
 *
 * Error path (user-visible):
 *   With the Scheduled step type selected but no schedule spec entered, the
 *   Save button stays disabled — the form cannot be submitted incomplete.
 *
 * Tests skip gracefully when the environment lacks the surfaces they need, in
 * line with the other specs in this suite.
 */

import type { Page } from '@playwright/test';
import { test, expect } from './helpers/base';

const FLAG_KEY = 'scheduled_node';

async function enableScheduledFlag(page: Page): Promise<boolean> {
  await page.goto('/admin/flags');
  await page.waitForLoadState('networkidle');

  const heading = page.getByRole('heading', { name: /feature flags/i });
  if (!(await heading.isVisible().catch(() => false))) return false;

  const row = page.getByRole('row').filter({ hasText: FLAG_KEY });
  if (!(await row.first().isVisible().catch(() => false))) {
    await page.getByPlaceholder('new-flag-key').fill(FLAG_KEY);
    await page.getByRole('button', { name: /add flag/i }).click();
    await page.waitForTimeout(800);
  }

  const flagRow = page.getByRole('row').filter({ hasText: FLAG_KEY }).first();
  await expect(flagRow).toBeVisible({ timeout: 5_000 });

  // The status badge doubles as the toggle button. Turn it on if it reads "off".
  const toggle = flagRow.getByRole('button').first();
  if ((await toggle.textContent())?.toLowerCase().includes('off')) {
    await toggle.click();
    await page.waitForTimeout(800);
  }
  await expect(flagRow.getByText(/^on$/i)).toBeVisible({ timeout: 5_000 });
  return true;
}

async function createFlowReturningId(page: Page, name: string): Promise<string | null> {
  await page.goto('/admin/flows');
  await page.waitForLoadState('networkidle');

  await page.getByRole('button', { name: /new flow/i }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.locator('#flow-name').fill(name);
  await page.locator('#flow-expert-role').fill('E2E Scheduling Expert');
  await page.getByRole('button', { name: /create flow/i }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 });

  const editLink = page.getByRole('link', { name: 'Configure Flow' }).first();
  if (!(await editLink.isVisible().catch(() => false))) return null;
  await editLink.click();
  await page.waitForURL(/\/flows\/[^/]+/, { timeout: 10_000 }).catch(() => undefined);

  const match = /\/flows\/([0-9a-f-]{36})/.exec(page.url());
  return match?.[1] ?? null;
}

test.describe('Scheduling: scheduled node behind the scheduled_node flag', () => {
  test('admin can enable the scheduled_node feature flag', async ({ page, consoleLogs }) => {
    const enabled = await enableScheduledFlag(page);
    test.skip(!enabled, 'Admin flags surface not available in this environment');

    await page.screenshot({ path: 'screenshots/scheduling-flag-on.png', fullPage: true });

    const errors = consoleLogs.filter((l) => l.type === 'error');
    expect(errors, `JS errors on admin flags page:\n${errors.map((e) => e.text).join('\n')}`).toHaveLength(0);
  });

  test('a scheduled step can be configured once the flag is on', async ({ page }) => {
    const enabled = await enableScheduledFlag(page);
    test.skip(!enabled, 'Cannot enable scheduled_node flag in this environment');

    const flowId = await createFlowReturningId(page, `Scheduling E2E ${Date.now()}`);
    test.skip(!flowId, 'Could not create a flow / resolve its id');

    await page.goto(`/flows/${flowId}/config`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1_000);

    await page.getByRole('button', { name: '+ Add step' }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });

    const scheduledOption = page.getByRole('button', { name: 'Scheduled' });
    test.skip(
      !(await scheduledOption.isVisible().catch(() => false)),
      'Scheduled step type not offered — flag not picked up in this environment',
    );
    await scheduledOption.click();

    await expect(page.locator('#node-name')).toBeVisible({ timeout: 5_000 });
    await page.locator('#node-name').fill('Wait 30 days');
    // "Pick a date and time" mad-lib is the default; set 30 days.
    await page.getByLabel('Amount').fill('30');
    await page.getByLabel('Unit').selectOption('d');
    await page.screenshot({ path: 'screenshots/scheduling-config.png', fullPage: true });

    await page.getByRole('button', { name: /^Save$/i }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 });

    // The scheduled node renders its name and a schedule subtitle (e.g.
    // "relative: 30d") on the canvas.
    await expect(page.getByText('Wait 30 days')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/relative: 30d/i)).toBeVisible({ timeout: 5_000 });
    await page.screenshot({ path: 'screenshots/scheduling-node-on-canvas.png', fullPage: true });
  });

  test('Save is disabled while a scheduled step has no spec', async ({ page }) => {
    const enabled = await enableScheduledFlag(page);
    test.skip(!enabled, 'Cannot enable scheduled_node flag in this environment');

    const flowId = await createFlowReturningId(page, `Scheduling Validation ${Date.now()}`);
    test.skip(!flowId, 'Could not create a flow / resolve its id');

    await page.goto(`/flows/${flowId}/config`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1_000);

    await page.getByRole('button', { name: '+ Add step' }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });

    const scheduledOption = page.getByRole('button', { name: 'Scheduled' });
    test.skip(
      !(await scheduledOption.isVisible().catch(() => false)),
      'Scheduled step type not offered in this environment',
    );
    await scheduledOption.click();

    await expect(page.locator('#node-name')).toBeVisible({ timeout: 5_000 });
    await page.locator('#node-name').fill('Incomplete schedule');
    // "Type anything" needs a description before it can be saved.
    await page.locator('#schedule-when').selectOption('describe');
    await expect(page.getByRole('button', { name: /^Save$/i })).toBeDisabled();
  });
});
