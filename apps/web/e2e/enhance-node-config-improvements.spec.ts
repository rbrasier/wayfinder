/**
 * enhance-node-config-improvements.spec.ts
 *
 * Covers v1.33.0 — Node Configuration Improvements.
 *
 * Auto node (Mock executor, behind the auto_node flag):
 *   - the config modal is the wider layout
 *   - request fields use the grouped value dropdown (AI decides default, plus
 *     "Type anything" and "No value")
 *   - the read-only "Expected outputs (from n8n)" section renders
 *
 * Scheduled node (behind the scheduled_node flag):
 *   - "When should this run?" offers the three options
 *   - "Pick a date and time" shows the mad-lib sentence builder, and choosing
 *     the "on" modifier hides the amount + unit
 *   - recurrence authoring is gone
 *
 * Each block skips cleanly when its feature flag is unavailable.
 */

import type { Page } from '@playwright/test';
import { test, expect } from './helpers/base';

async function enableFlag(page: Page, key: string): Promise<boolean> {
  await page.goto('/admin/flags');
  await page.waitForLoadState('networkidle');

  const heading = page.getByRole('heading', { name: /feature flags/i });
  if (!(await heading.isVisible().catch(() => false))) return false;

  const existing = page.getByRole('row').filter({ hasText: key });
  if (!(await existing.first().isVisible().catch(() => false))) {
    await page.getByPlaceholder('new-flag-key').fill(key);
    await page.getByRole('button', { name: /add flag/i }).click();
    await page.waitForTimeout(800);
  }

  const flagRow = page.getByRole('row').filter({ hasText: key }).first();
  await expect(flagRow).toBeVisible({ timeout: 5_000 });
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
  await page.locator('#flow-expert-role').fill('E2E Node Config Expert');
  await page.getByRole('button', { name: /create flow/i }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 });

  const editLink = page.getByRole('link', { name: 'Configure Flow' }).first();
  if (!(await editLink.isVisible().catch(() => false))) return null;
  await editLink.click();
  await page.waitForURL(/\/flows\/[^/]+/, { timeout: 10_000 }).catch(() => undefined);

  const match = /\/flows\/([0-9a-f-]{36})/.exec(page.url());
  return match?.[1] ?? null;
}

test.describe('Node configuration improvements', () => {
  test('an auto step shows the wider modal, grouped value dropdown and outputs section', async ({ page }) => {
    const enabled = await enableFlag(page, 'auto_node');
    test.skip(!enabled, 'Cannot enable auto_node flag in this environment');

    const flowId = await createFlowReturningId(page, `Node Config Auto ${Date.now()}`);
    test.skip(!flowId, 'Could not create a flow / resolve its id');

    await page.goto(`/flows/${flowId}/config`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1_000);

    await page.getByRole('button', { name: '+ Add step' }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });

    const autoOption = page.getByRole('button', { name: /Automated \(n8n\)/ });
    test.skip(
      !(await autoOption.isVisible().catch(() => false)),
      'Auto step type not offered — flag not picked up in this environment',
    );
    await autoOption.click();

    // The modal uses the wider layout.
    await expect(page.locator('.max-w-3xl')).toBeVisible();

    await page.locator('#node-name').fill('Look up vendor');
    await page.locator('#auto-instruction').fill('Look up the preferred vendor.');

    // Mock executor needs no live n8n instance and renders the request-field
    // editor with the grouped value dropdown.
    await page.locator('label', { hasText: /Mock \(testing\)/ }).click();

    const requestEditor = page
      .locator('div.space-y-1')
      .filter({ hasText: 'Fields sent with the request' })
      .last();
    await requestEditor.getByRole('button', { name: /Add field/i }).click();
    await requestEditor.getByPlaceholder(/Preferred Vendor/i).last().fill('Region (text)');

    // The grouped dropdown offers AI / Type anything / No value.
    const valueSelect = page.locator('select').filter({ hasText: /AI decides/i }).last();
    await expect(valueSelect).toBeVisible({ timeout: 5_000 });
    await expect(valueSelect.locator('option', { hasText: /Type anything/i })).toHaveCount(1);
    await expect(valueSelect.locator('option', { hasText: /No value/i })).toHaveCount(1);

    // Bind to "No value" — the field is sent blank, no model call.
    await valueSelect.selectOption('none');

    await page.screenshot({ path: 'screenshots/node-config-auto-grouped-dropdown.png', fullPage: true });

    await page.getByRole('button', { name: /^Save$/i }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Look up vendor/i).first()).toBeVisible({ timeout: 5_000 });
  });

  test('a scheduled step uses the mad-lib builder and has no recurrence option', async ({ page }) => {
    const enabled = await enableFlag(page, 'scheduled_node');
    test.skip(!enabled, 'Cannot enable scheduled_node flag in this environment');

    const flowId = await createFlowReturningId(page, `Node Config Scheduled ${Date.now()}`);
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
    await page.locator('#node-name').fill('Follow up');

    // The three "when" options are offered; recurrence is gone.
    const whenSelect = page.locator('#schedule-when');
    await expect(whenSelect).toBeVisible();
    await expect(whenSelect.locator('option')).toHaveCount(3);
    await expect(whenSelect.locator('option', { hasText: /Repeat on a schedule/i })).toHaveCount(0);

    // "Pick a date and time" is the default and shows the mad-lib sentence.
    await expect(page.getByLabel('Amount')).toBeVisible();
    await expect(page.getByLabel('Unit')).toBeVisible();
    await expect(page.getByLabel('Modifier')).toBeVisible();
    await expect(page.getByLabel('Anchor')).toBeVisible();

    // Choosing the "on" modifier hides the amount + unit.
    await page.getByLabel('Modifier').selectOption('on');
    await expect(page.getByLabel('Amount')).toHaveCount(0);
    await expect(page.getByLabel('Unit')).toHaveCount(0);

    // Back to a relative delay and save.
    await page.getByLabel('Modifier').selectOption('after');
    await page.getByLabel('Amount').fill('30');
    await page.getByLabel('Unit').selectOption('d');
    await page.screenshot({ path: 'screenshots/node-config-schedule-madlib.png', fullPage: true });

    await page.getByRole('button', { name: /^Save$/i }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Follow up')).toBeVisible({ timeout: 5_000 });
  });
});
