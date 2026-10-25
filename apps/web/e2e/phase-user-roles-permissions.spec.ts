/**
 * phase-user-roles-permissions.spec.ts
 *
 * Covers:
 *   v1.32.0 — User Roles & Permissions (ADR-021, ADR-022).
 *   v0.28.45 — Delegated admin roles (ADR-066): a Technical Admin is let into
 *     the admin section but redirected away from areas they do not hold
 *     (policy group 1 — redirects).
 *
 * Visual spec:
 *   - The admin sidebar has a "Roles" entry linking to /admin/roles.
 *   - /admin/roles renders a permission matrix with the five seeded roles
 *     (Everyone, Global Admin, Power Users, Technical Admin, User Admin) and a
 *     row per registered permission. The Global Admin column is locked
 *     (checkboxes disabled / shown all-on).
 *   - /admin/flags shows, per enabled flag, a role-scoping control
 *     (checkbox list of assignable roles; "Everyone" when unscoped).
 *
 * Runs authenticated as admin (auth.setup.ts). Read-only assertions plus one
 * happy-path toggle on an editable role.
 */

import type { Browser } from '@playwright/test';
import { test, expect, type Page } from './helpers/base';
import { NAV_TIMEOUT, untilDom } from './helpers/timeouts';

test.describe('Phase: User Roles & Permissions', () => {
  test('admin sidebar exposes a Roles link', async ({ page }) => {
    await page.goto('/admin/flows');
    await page.waitForLoadState('networkidle');

    // Roles lives under the "Users and Roles" group, collapsed by default.
    await page.getByRole('button', { name: /Users and Roles/i }).click();
    const rolesLink = page.getByRole('link', { name: /^roles$/i });
    await expect(rolesLink).toBeVisible();
  });

  test('roles page renders the permission matrix with the five seeded roles', async ({ page }) => {
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
    await expect(matrix.getByRole('columnheader', { name: /global admin/i })).toBeVisible();
    await expect(matrix.getByRole('columnheader', { name: /power users/i })).toBeVisible();
    await expect(matrix.getByRole('columnheader', { name: /technical admin/i })).toBeVisible();
    await expect(matrix.getByRole('columnheader', { name: /user admin/i })).toBeVisible();

    // The registered permissions appear as rows.
    await expect(page.getByText('Create chats')).toBeVisible();
    await expect(page.getByText('Publish workflows to everyone')).toBeVisible();
  });

  test('the Global Admin column is locked (checkboxes disabled)', async ({ page }) => {
    await page.goto('/admin/roles');
    await page.waitForLoadState('networkidle');

    // Wait for the matrix to render before counting — the role data is hydrated
    // client-side, so checkboxes appear a tick after networkidle.
    await expect(page.locator('input[type="checkbox"]').first()).toBeVisible();

    // Every checkbox in the matrix that is disabled belongs to the immutable
    // Global Admin role; assert at least one disabled (locked) checkbox exists.
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

const TECHNICAL_ADMIN_EMAIL = 'technical-admin@example.com';

interface TrpcResult<T> {
  readonly result: { readonly data: { readonly json: T } };
}

const trpcQuery = async <T>(page: Page, procedure: string, input?: unknown): Promise<T> => {
  const query = input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
  const response = await page.request.get(`/api/trpc/${procedure}${query}`);
  expect(response.ok(), await response.text()).toBe(true);
  return ((await response.json()) as TrpcResult<T>).result.data.json;
};

const trpcMutation = async (page: Page, procedure: string, input: unknown): Promise<void> => {
  const response = await page.request.post(`/api/trpc/${procedure}`, { data: { json: input } });
  expect(response.ok(), await response.text()).toBe(true);
};

test.describe('Delegated admin: Technical Admin', () => {
  test.describe.configure({ timeout: 120_000 });

  // The admin's stored session prepares the user: the test-session endpoint
  // creates every new user as a Global Admin, so demote them and hand them the
  // seeded Technical Admin role instead. Idempotent across reruns.
  test.beforeEach(async ({ page, request }) => {
    const session = await request.post('/api/auth/test-session', { data: { email: TECHNICAL_ADMIN_EMAIL } });
    expect(session.ok(), await session.text()).toBe(true);

    const users = await trpcQuery<{ id: string; email: string }[]>(page, 'user.list', {});
    const technicalAdmin = users.find((user) => user.email === TECHNICAL_ADMIN_EMAIL);
    expect(technicalAdmin, 'the test-session user exists').toBeDefined();
    await trpcMutation(page, 'user.update', { id: technicalAdmin!.id, isAdmin: false });

    const roles = await trpcQuery<{ role: { id: string; key: string } }[]>(page, 'role.list');
    const technicalRole = roles.find((entry) => entry.role.key === 'technical_admins');
    expect(technicalRole, 'the Technical Admin role is seeded').toBeDefined();
    const holders = await trpcQuery<string[]>(page, 'role.listUsers', { roleId: technicalRole!.role.id });
    if (!holders.includes(technicalAdmin!.id)) {
      await trpcMutation(page, 'role.assignUser', { userId: technicalAdmin!.id, roleId: technicalRole!.role.id });
    }
  });

  const signInAsTechnicalAdmin = async (browser: Browser) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const response = await context.request.post('/api/auth/test-session', { data: { email: TECHNICAL_ADMIN_EMAIL } });
    expect(response.ok(), await response.text()).toBe(true);
    const { token } = (await response.json()) as { token: string };
    await context.addCookies([
      {
        name: 'better-auth.session_token',
        value: token,
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        secure: false,
        sameSite: 'Lax',
      },
    ]);
    return context;
  };

  test('lands on Configuration without the user-management or security areas', async ({ browser }) => {
    const context = await signInAsTechnicalAdmin(browser);
    const page = await context.newPage();

    await page.goto('/admin', untilDom);
    await page.waitForURL(/\/admin\/settings$/, { timeout: NAV_TIMEOUT });

    await expect(page.getByRole('heading', { name: 'Configuration' })).toBeVisible({ timeout: NAV_TIMEOUT });
    await expect(page.getByRole('button', { name: /^AI/ })).toBeVisible();
    await expect(page.getByText('Directory & security')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Users and Roles/i })).toHaveCount(0);

    await context.close();
  });

  test('is sent back to Configuration from Users and from Roles', async ({ browser }) => {
    const context = await signInAsTechnicalAdmin(browser);
    const page = await context.newPage();

    await page.goto('/admin/users', untilDom);
    await page.waitForURL(/\/admin\/settings$/, { timeout: NAV_TIMEOUT });

    await page.goto('/admin/roles', untilDom);
    await page.waitForURL(/\/admin\/settings$/, { timeout: NAV_TIMEOUT });
    await expect(page.getByRole('heading', { name: 'Configuration' })).toBeVisible({ timeout: NAV_TIMEOUT });

    await context.close();
  });
});
