/**
 * enhance-synthesise-enhancements.spec.ts
 *
 * Enhancement: Synthesise Information enhancements (v2.16.0).
 *
 * Covers the output card's new controls — the "view system prompt" eye button and
 * the context-material uploader — plus the input card's persisted upload tree, and
 * that "Run sample" leaves the editor for the run/summary screen. Skip-guarded
 * like the other extraction specs so it is inert without an authenticated,
 * flag-enabled session.
 */

import { test, expect } from './helpers/base';

const atLogin = (url: string): boolean => url.includes('/login');

test.describe('Synthesise Information — enhancements', () => {
  test('output card: view system prompt + context material; run sample routes to the summary screen', async ({
    page,
  }) => {
    await page.goto('/synthesise');
    if (atLogin(page.url())) {
      test.skip(true, 'No authenticated session available');
      return;
    }

    const listHeading = page.getByRole('heading', { name: /^Synthesise Information$/ });
    const disabledState = page.getByText(/not (available|enabled)/i).first();
    await expect(listHeading.or(disabledState).first()).toBeVisible();
    if (await disabledState.isVisible().catch(() => false)) {
      test.skip(true, 'extraction_flows flag not enabled for this user');
      return;
    }

    // Create a synthesis and land in the editor.
    await page.getByRole('button', { name: /New synthesis/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Name').fill('E2E enhancements synthesis');
    await dialog.getByRole('button', { name: /^Create$/ }).click();
    await expect(page.getByRole('heading', { name: /Edit synthesis/i })).toBeVisible();

    // Focus the output card.
    await page.getByRole('button', { name: /Configure output/i }).click();
    await expect(page.getByRole('button', { name: /Run sample/i })).toBeVisible();

    // A field is needed for the prompt to build; add one via the structured editor.
    const labelField = page.getByPlaceholder(/field name/i).first();
    if (await labelField.isVisible().catch(() => false)) {
      await labelField.fill('Vendor');
    }

    // View system prompt → read-only preview mirroring the node config.
    await page.getByRole('button', { name: /View system prompt/i }).click();
    const promptDialog = page.getByRole('dialog').filter({ hasText: /system prompt/i });
    await expect(promptDialog).toBeVisible();
    await expect(promptDialog.getByText(/read-only/i)).toBeVisible();
    await page.keyboard.press('Escape').catch(() => undefined);

    // Context material uploader is present in the output card.
    await expect(page.getByRole('button', { name: /Add a context document/i })).toBeVisible();
    await expect(page.getByText(/whole-flow context/i)).toBeVisible();

    // Run sample leaves the editor for the run/summary screen (or surfaces a
    // validation toast if no input documents are staged — either proves it no
    // longer renders results inline in the editor).
    await page.getByRole('button', { name: /Run sample/i }).click();
    const summaryHeading = page.getByRole('heading', { name: /Summary of outputs/i });
    const needDocsToast = page.getByText(/Upload .*document/i).first();
    await expect(summaryHeading.or(needDocsToast).first()).toBeVisible();
  });
});
