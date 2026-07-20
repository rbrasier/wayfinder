/**
 * admin-errors.spec.ts
 *
 * Covers v1.7.0 — "Delete all" errors button on /admin/errors.
 *
 * Visual spec (docs/development/implemented/alpha-1/v1.7.0/014-delete-all-errors.md):
 *   A destructive "Delete all" button in the top-right of /admin/errors opens
 *   a confirmation dialog ("Delete all errors?" + "This will permanently
 *   delete all error log entries. This cannot be undone.") with Cancel /
 *   Delete all actions.
 *
 * The test opens the dialog and CANCELS — it never confirms, so it is
 * non-destructive against whatever error rows exist.
 */

import { test, expect } from './helpers/base';

test.describe('Admin: Delete All Errors', () => {
  test('errors page renders the Delete all control', async ({ page, consoleLogs }) => {
    await page.goto('/admin/errors');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'screenshots/admin-errors.png', fullPage: true });

    const errors = consoleLogs.filter(l => l.type === 'error');
    expect(errors, `JS errors on /admin/errors:\n${errors.map(e => e.text).join('\n')}`).toHaveLength(0);

    await expect(page.getByRole('button', { name: /delete all/i }).first()).toBeVisible();
  });

  test('Delete all opens a confirmation dialog that can be cancelled', async ({ page }) => {
    await page.goto('/admin/errors');
    await page.waitForLoadState('networkidle');

    const deleteAllBtn = page.getByRole('button', { name: /delete all/i }).first();
    if (!(await deleteAllBtn.isVisible().catch(() => false))) {
      await page.screenshot({ path: 'screenshots/admin-errors-no-delete-button.png', fullPage: true });
      test.skip(true, 'Delete all button not found — may be hidden when there are no errors');
      return;
    }

    await deleteAllBtn.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/delete all errors\?/i)).toBeVisible();
    await expect(dialog.getByText(/cannot be undone/i)).toBeVisible();
    await page.screenshot({ path: 'screenshots/admin-errors-confirm-dialog.png', fullPage: true });

    // Cancel — never confirm, to keep the test non-destructive
    await dialog.getByRole('button', { name: /cancel/i }).click();
    await expect(dialog).not.toBeVisible();
  });
});
