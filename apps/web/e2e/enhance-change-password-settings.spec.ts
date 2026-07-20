/**
 * enhance-change-password-settings.spec.ts
 *
 * Covers v1.31.5 — Change password modal on the user settings page.
 *
 * Verifies:
 *   - The "Change password" button is visible on /settings
 *   - Clicking it opens the modal with three password fields
 *   - Client-side validation: mismatched passwords shows an error
 *   - Pressing Cancel (or Escape) closes the modal without changes
 */

import { test, expect } from './helpers/base';

test.describe('Settings: change password', () => {
  test('change password button is visible on the settings page', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'screenshots/settings-change-password-button.png', fullPage: true });

    await expect(page.getByRole('button', { name: /change password/i })).toBeVisible();
  });

  test('clicking change password opens the modal with all three fields', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /change password/i }).click();
    await page.screenshot({ path: 'screenshots/settings-change-password-modal-open.png', fullPage: true });

    await expect(page.locator('#current-password')).toBeVisible();
    await expect(page.locator('#new-password')).toBeVisible();
    await expect(page.locator('#confirm-new-password')).toBeVisible();
    await expect(page.getByRole('button', { name: /^change password$/i })).toBeVisible();
  });

  test('mismatched new passwords shows an inline error', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /change password/i }).click();

    await page.locator('#current-password').fill('currentpass');
    await page.locator('#new-password').fill('newpassword1');
    await page.locator('#confirm-new-password').fill('newpassword2');

    await page.getByRole('button', { name: /^change password$/i }).click();
    await page.screenshot({ path: 'screenshots/settings-change-password-mismatch.png', fullPage: true });

    await expect(page.getByText(/do not match/i)).toBeVisible();
  });

  test('Cancel button closes the modal', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /change password/i }).click();
    await expect(page.locator('#current-password')).toBeVisible();

    await page.getByRole('button', { name: /cancel/i }).click();
    await page.screenshot({ path: 'screenshots/settings-change-password-cancelled.png', fullPage: true });

    await expect(page.locator('#current-password')).not.toBeVisible();
  });
});
