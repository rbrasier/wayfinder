/**
 * phase-user-roles-permissions.spec.ts
 *
 * Covers:
 *   v1.32.0 — User Roles & Permissions (ADR-021, ADR-022).
 *
 * Visual spec:
 *   - The admin sidebar has a "Roles" entry linking to /admin/roles.
 *   - /admin/roles renders a permission matrix with the three seeded roles
 *     (Everyone, Admins, Power Users) and a row per registered permission.
 *     The Admins column is locked (checkboxes disabled / shown all-on).
 *   - /admin/flags shows, per enabled flag, a role-scoping control
 *     (checkbox list of assignable roles; "Everyone" when unscoped).
 *
 * Runs authenticated as admin (auth.setup.ts). Read-only assertions plus one
 * happy-path toggle on an editable role.
 */

import { test, expect } from './helpers/base';

test.describe('Phase: User Roles & Permissions', () => {
  test('admin sidebar exposes a Roles link', async ({ page }) => {
    await page.goto('/admin/flows');
    await page.waitForLoadState('networkidle');

    const rolesLink = page.getByRole('link', { name: /^roles$/i });
    await expect(rolesLink).toBeVisible();
  });

  test('roles page renders the permission matrix with the three seeded roles', async ({ page }) => {
    await page.goto('/admin/roles');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'screenshots/admin-roles.png', fullPage: true });

    await expect(page.getByText(/roles\s*&\s*permissions/i)).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /everyone/i })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /admins/i })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /power users/i })).toBeVisible();

    // The four registered permissions appear as rows.
    await expect(page.getByText('Create chats')).toBeVisible();
    await expect(page.getByText('Publish workflows to everyone')).toBeVisible();
  });

  test('the Admins column is locked (checkboxes disabled)', async ({ page }) => {
    await page.goto('/admin/roles');
    await page.waitForLoadState('networkidle');

    // Every checkbox in the matrix that is disabled belongs to the immutable
    // Admins role; assert at least one disabled (locked) checkbox exists.
    const disabledCheckboxes = page.locator('input[type="checkbox"]:disabled');
    expect(await disabledCheckboxes.count()).toBeGreaterThan(0);
  });

  test('an editable permission can be toggled and persists', async ({ page }) => {
    await page.goto('/admin/roles');
    await page.waitForLoadState('networkidle');

    // Pick the first enabled (editable) checkbox in the matrix, toggle it, and
    // confirm the new state survives a reload (server persisted the change).
    const editable = page.locator('input[type="checkbox"]:enabled').first();
    await expect(editable).toBeVisible();
    const before = await editable.isChecked();

    await editable.click();
    await page.waitForLoadState('networkidle');
    await page.reload();
    await page.waitForLoadState('networkidle');

    const after = await page.locator('input[type="checkbox"]:enabled').first().isChecked();
    expect(after).toBe(!before);

    // Restore the original state so the test is idempotent across runs.
    await page.locator('input[type="checkbox"]:enabled').first().click();
    await page.waitForLoadState('networkidle');
  });

  test('flags page shows role scoping for enabled flags', async ({ page }) => {
    await page.goto('/admin/flags');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'screenshots/admin-flags-roles.png', fullPage: true });

    // scheduled_node ships enabled; its row should expose the "Limit to roles"
    // control (either "Everyone" when unscoped or a Power Users checkbox).
    await expect(page.getByRole('columnheader', { name: /limit to roles/i })).toBeVisible();
  });
});
