/**
 * enhance-synthesise-ui.spec.ts
 *
 * Enhancement: Synthesise Information UI fixes (v2.15.0).
 *
 * Covers the reworked surface — the /chats-style list header with New synthesis
 * on the top right; the edit header's Save, disabled Publish, and ⋯ menu (Runs +
 * Delete); the focus-based Input/Output cards with their "Configure …" overlays;
 * and the Structured ↔ Template output toggle. Skip-guarded like the other
 * extraction phase specs so it is inert without an authenticated, flag-enabled
 * session.
 */

import { test, expect } from './helpers/base';

const atLogin = (url: string): boolean => url.includes('/login');

test.describe('Synthesise Information — UI fixes', () => {
  test('list header, edit actions, card focus, and output modes', async ({ page }) => {
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

    // List: New synthesis lives in the header on the top right.
    const newButton = page.getByRole('button', { name: /New synthesis/i });
    await expect(newButton).toBeVisible();

    // Create one and land in the editor.
    await newButton.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Name').fill('E2E UI synthesis');
    await dialog.getByRole('button', { name: /^Create$/ }).click();

    await expect(page.getByRole('heading', { name: /Edit synthesis/i })).toBeVisible();

    // Edit header: Save present, Publish present-but-disabled.
    await expect(page.getByRole('button', { name: /^Save$/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Publish$/ })).toBeDisabled();

    // ⋯ menu holds Runs and Delete.
    await page.getByRole('button', { name: /Synthesis actions/i }).click();
    await expect(page.getByRole('link', { name: /^Runs$/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Delete$/ })).toBeVisible();
    // Close the menu without deleting the seeded flow.
    await page.keyboard.press('Escape').catch(() => undefined);
    await page.getByRole('heading', { name: /Edit synthesis/i }).click();

    // Focus cards: input is focused first; the output card is behind its overlay.
    await expect(page.getByRole('heading', { name: /Input — documents/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Output — records/i })).toBeVisible();
    const configureOutput = page.getByRole('button', { name: /Configure output/i });
    await expect(configureOutput).toBeVisible();

    // Focus the output card → its Run sample control appears and the input card
    // now offers its own "Configure input" overlay.
    await configureOutput.click();
    await expect(page.getByRole('button', { name: /Run sample/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Configure input/i })).toBeVisible();

    // Output modes: structured (default) and template are both offered; choosing
    // template swaps in the upload affordance with its header-row guidance.
    await expect(page.getByRole('radio', { name: /Structured output/i })).toBeVisible();
    const templateToggle = page.getByRole('radio', { name: /^Template$/i });
    await templateToggle.click();
    await expect(page.getByText(/upload a \.docx or \.xlsx template/i)).toBeVisible();
    await expect(page.getByText(/should include a header row/i)).toBeVisible();
  });
});
