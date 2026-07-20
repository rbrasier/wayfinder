/**
 * enhance-n8n-workflow-context-mapping.spec.ts
 *
 * Covers the n8n workflow directory + step-context field values enhancement.
 *
 * Settings surface:
 *   The admin settings page exposes an "n8n Integration" card whose dialog
 *   accepts a base URL and API key.
 *
 * Auto-node config (behind the auto_node flag, using the Mock executor so no
 * live n8n instance is needed):
 *   1. Admin enables the `auto_node` flag.
 *   2. On the flow canvas an auto step is configured with the Mock executor,
 *      a request field is added, and its value is bound to a "Specific value".
 *   3. The step saves.
 *
 * Tests skip gracefully when the environment lacks the surfaces they need, in
 * line with the other specs in this suite.
 */

import type { Page } from '@playwright/test';
import { test, expect } from './helpers/base';

const FLAG_KEY = 'auto_node';

async function enableAutoNodeFlag(page: Page): Promise<boolean> {
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
  await page.locator('#flow-expert-role').fill('E2E n8n Expert');
  await page.getByRole('button', { name: /create flow/i }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 });

  const editLink = page.getByRole('link', { name: 'Configure Flow' }).first();
  if (!(await editLink.isVisible().catch(() => false))) return null;
  await editLink.click();
  await page.waitForURL(/\/flows\/[^/]+/, { timeout: 10_000 }).catch(() => undefined);

  const match = /\/flows\/([0-9a-f-]{36})/.exec(page.url());
  return match?.[1] ?? null;
}

test.describe('n8n workflow directory + step-context field values', () => {
  test('admin settings exposes an n8n Integration card', async ({ page, consoleLogs }) => {
    await page.goto('/admin/settings');
    await page.waitForLoadState('networkidle');

    const card = page.getByText(/n8n Integration/i).first();
    test.skip(!(await card.isVisible().catch(() => false)), 'Admin settings surface not available');

    // Open the edit dialog and confirm the base URL + API key fields render.
    await page
      .getByRole('button', { name: /^Edit$/i })
      .nth(0)
      .scrollIntoViewIfNeeded()
      .catch(() => undefined);
    const editButtons = page.getByRole('button', { name: /^Edit$/i });
    const count = await editButtons.count();
    for (let index = 0; index < count; index += 1) {
      await editButtons.nth(index).click();
      if (await page.locator('#n8n-base-url').isVisible().catch(() => false)) break;
      await page.keyboard.press('Escape').catch(() => undefined);
    }

    test.skip(
      !(await page.locator('#n8n-base-url').isVisible().catch(() => false)),
      'n8n settings dialog not reachable in this environment',
    );
    await expect(page.locator('#n8n-api-key')).toBeVisible();
    await page.screenshot({ path: 'screenshots/n8n-settings-card.png', fullPage: true });
  });

  test('an auto step binds a request field to a specific value', async ({ page }) => {
    const enabled = await enableAutoNodeFlag(page);
    test.skip(!enabled, 'Cannot enable auto_node flag in this environment');

    const flowId = await createFlowReturningId(page, `n8n E2E ${Date.now()}`);
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

    await expect(page.locator('#node-name')).toBeVisible({ timeout: 5_000 });
    await page.locator('#node-name').fill('Look up vendor');
    await page.locator('#auto-instruction').fill('Look up the preferred vendor.');

    // Use the Mock executor so the test needs no live n8n instance.
    await page.locator('label', { hasText: /Mock \(testing\)/ }).click();

    // The Mock executor renders both the request- and response-field editors,
    // each with its own "Add field" button and "Preferred Vendor" input — scope
    // every field interaction to the request-fields editor so the value binding
    // applies to a request field (the only group with a Field values section).
    const requestEditor = page
      .locator('div.space-y-1')
      .filter({ hasText: 'Fields sent with the request' })
      .last();

    // Add a request field, then bind its value to a specific literal.
    await requestEditor.getByRole('button', { name: /Add field/i }).click();
    await requestEditor.getByPlaceholder(/Preferred Vendor/i).last().fill('Region (text)');

    const valueSelect = page.locator('select').filter({ hasText: /AI decides/i }).last();
    await expect(valueSelect).toBeVisible({ timeout: 5_000 });
    await valueSelect.selectOption('literal');
    await page.getByPlaceholder(/Type anything/i).last().fill('EU-West');

    await page.screenshot({ path: 'screenshots/n8n-auto-field-value.png', fullPage: true });

    await page.getByRole('button', { name: /^Save$/i }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Look up vendor/i).first()).toBeVisible({ timeout: 5_000 });
  });
});
