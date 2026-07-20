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

    // The matrix lives under the "Permissions" card. Scope to that table (it's
    // the one with a "Permission" column) because the Feature access card below
    // repeats "Everyone"/"Power Users" headers, which would break strict mode.
    await expect(page.getByRole('heading', { name: 'Permissions' })).toBeVisible();
    const matrix = page
      .getByRole('table')
      .filter({ has: page.getByRole('columnheader', { name: 'Permission', exact: true }) });
    await expect(matrix.getByRole('columnheader', { name: /everyone/i })).toBeVisible();
    await expect(matrix.getByRole('columnheader', { name: /admins/i })).toBeVisible();
    await expect(matrix.getByRole('columnheader', { name: /power users/i })).toBeVisible();

    // The registered permissions appear as rows.
    await expect(page.getByText('Create chats')).toBeVisible();
    await expect(page.getByText('Publish workflows to everyone')).toBeVisible();
  });

  test('the Admins column is locked (checkboxes disabled)', async ({ page }) => {
    await page.goto('/admin/roles');
    await page.waitForLoadState('networkidle');

    // Wait for the matrix to render before counting — the role data is hydrated
    // client-side, so checkboxes appear a tick after networkidle.
    await expect(page.locator('input[type="checkbox"]').first()).toBeVisible();

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

  test('Feature access card scopes enabled flags by role', async ({ page }) => {
    // Per-flag role scoping moved off /admin/flags into the Roles page
    // "Feature access" card; each enabled flag gets a column per assignable role
    // plus an "Everyone" column (empty allowlist ⇒ everyone, ADR-022).
    await page.goto('/admin/roles');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'screenshots/admin-flags-roles.png', fullPage: true });

    await expect(page.getByRole('heading', { name: 'Feature access' })).toBeVisible();
    // "Feature" is unique to this card's table (the permission matrix uses
    // "Permission"); "Everyone" appears in both, so don't match on it.
    await expect(page.getByRole('columnheader', { name: 'Feature', exact: true })).toBeVisible();
  });
});
