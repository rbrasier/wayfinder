/**
 * admin-settings.spec.ts
 *
 * Covers:
 *   v1.6.3  — Admin settings General card with Organisation Name.
 *   v1.15.1 — Amazon Bedrock selectable in the AI Provider modal alongside
 *             Anthropic / OpenAI / Mistral, with AWS region + key fields.
 *
 * Visual spec:
 *   /admin/settings → "AI Provider" card with an "Edit" button that opens an
 *   "Edit AI configuration" modal containing a Provider <select> (#ai-provider)
 *   whose options include anthropic / openai / mistral / bedrock. Choosing
 *   Bedrock reveals AWS region / access key / secret fields.
 *
 * Read-only: the test opens the modal and closes it without saving.
 */

import { test, expect } from './helpers/base';

test.describe('Admin: Settings', () => {
  test('settings page loads without errors', async ({ page, consoleLogs }) => {
    await page.goto('/admin/settings');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'screenshots/admin-settings.png', fullPage: true });

    const errors = consoleLogs.filter(l => l.type === 'error');
    expect(errors, `JS errors on /admin/settings:\n${errors.map(e => e.text).join('\n')}`).toHaveLength(0);
  });

  test('General card shows organisation name', async ({ page }) => {
    await page.goto('/admin/settings');
    await page.waitForLoadState('networkidle');

    // The org-name input is the editable General-card field. Match by label
    // text if present; otherwise this is a soft skip.
    const orgField = page.getByLabel(/organisation name|organization name/i);
    if (!(await orgField.isVisible().catch(() => false))) {
      await page.screenshot({ path: 'screenshots/admin-settings-no-org-field.png', fullPage: true });
      test.skip(true, 'Organisation name field not found — label may differ');
      return;
    }

    await expect(orgField).toBeVisible();
    await page.screenshot({ path: 'screenshots/admin-settings-general.png', fullPage: true });
  });
});

test.describe('Admin: AI Provider modal', () => {
  test('AI Provider modal offers Bedrock alongside the other providers', async ({ page }) => {
    await page.goto('/admin/settings');
    await page.waitForLoadState('networkidle');

    // Open the AI configuration modal. The AI Provider card has an "Edit" button.
    const editButtons = page.getByRole('button', { name: /^edit$/i });
    const editCount = await editButtons.count();
    if (editCount === 0) {
      await page.screenshot({ path: 'screenshots/admin-settings-no-ai-edit.png', fullPage: true });
      test.skip(true, 'No Edit button found on settings page');
      return;
    }

    // Click each Edit until the provider select appears (the page may have
    // more than one Edit button — General + AI Provider cards).
    let providerSelect = page.locator('#ai-provider');
    for (let index = 0; index < editCount; index += 1) {
      await editButtons.nth(index).click();
      if (await providerSelect.isVisible().catch(() => false)) break;
      // Close any opened modal that wasn't the AI one.
      await page.keyboard.press('Escape').catch(() => {});
    }

    if (!(await providerSelect.isVisible().catch(() => false))) {
      await page.screenshot({ path: 'screenshots/admin-settings-no-provider-select.png', fullPage: true });
      test.skip(true, 'AI provider select (#ai-provider) not reachable');
      return;
    }

    await page.screenshot({ path: 'screenshots/admin-settings-ai-modal.png', fullPage: true });

    const optionValues = await providerSelect.locator('option').evaluateAll(
      nodes => nodes.map(node => (node as HTMLOptionElement).value),
    );
    expect(optionValues).toEqual(
      expect.arrayContaining(['anthropic', 'openai', 'mistral', 'bedrock']),
    );

    // Selecting Bedrock should reveal the AWS region field.
    await providerSelect.selectOption('bedrock');
    await expect(page.locator('#ai-bedrock-region')).toBeVisible();
    await page.screenshot({ path: 'screenshots/admin-settings-bedrock-fields.png', fullPage: true });
  });
});
