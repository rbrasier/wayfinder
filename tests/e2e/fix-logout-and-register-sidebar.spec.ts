/**
 * fix-logout-and-register-sidebar.spec.ts
 *
 * Covers the bug fix in docs/development/implemented/v1.23.2/
 * fix-logout-and-register-sidebar.md:
 *
 *   1. A signed-in user can sign out from the sidebar footer and lands on
 *      /admin/login.
 *   2. A fresh visitor to /admin/register sees a bare registration screen with
 *      no admin navigation sidebar.
 *   3. A signed-in admin who navigates to /admin/register is redirected to
 *      /admin (never sees the registration form inside admin chrome).
 *
 * The main suite runs with a stored admin session. Tests that need an
 * unauthenticated surface use a FRESH context with no stored session.
 */

import { test, expect } from './helpers/base';

test.describe('Logout', () => {
  test('sidebar exposes a Sign out button that ends the session', async ({ page }) => {
    await page.goto('/admin/flows');
    await page.waitForLoadState('networkidle');

    const signOut = page.getByRole('button', { name: /sign out/i });
    await expect(signOut).toBeVisible();

    await signOut.click();
    await expect(page).toHaveURL(/\/admin\/login/, { timeout: 10_000 });
    await page.screenshot({ path: 'screenshots/fix-logout-after-signout.png', fullPage: true });
  });
});

test.describe('Register page chrome', () => {
  test('fresh visitor sees no admin navigation', async ({ browser }) => {
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();

    await page.goto('/admin/register');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'screenshots/fix-register-no-sidebar.png', fullPage: true });

    await expect(page.getByRole('heading', { name: /create account/i })).toBeVisible();
    // Admin nav links must NOT be present on the registration screen.
    await expect(page.getByRole('link', { name: /all sessions/i })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /^users$/i })).toHaveCount(0);

    await context.close();
  });

  test('signed-in admin visiting /admin/register is redirected to /admin', async ({ page }) => {
    await page.goto('/admin/register');
    await page.waitForLoadState('networkidle');

    await expect(page).not.toHaveURL(/\/admin\/register/);
    await expect(page).toHaveURL(/\/admin(\/|$)/);
    await page.screenshot({ path: 'screenshots/fix-register-redirect.png', fullPage: true });
  });
});
