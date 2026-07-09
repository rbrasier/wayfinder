/**
 * enhance-auth-route-consolidation.spec.ts
 *
 * Covers docs/development/implemented/alpha-1/v1.23.3/auth-route-consolidation.md:
 * the login/register pages were renamed from /admin/login + /admin/register to
 * top-level /login + /register, and the old admin paths were removed.
 *
 *   1. /login renders the sign-in form.
 *   2. /register renders the create-account form.
 *   3. The old /admin/login no longer hosts its own page — an unauthenticated
 *      visitor is sent to /login by the middleware.
 *
 * These use a FRESH context with no stored session so the auth surfaces render.
 */

import { test, expect } from './helpers/base';

test.describe('Auth route consolidation', () => {
  test('/login renders the sign-in form', async ({ browser }) => {
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();

    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/login$/);

    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
    await expect(page.locator('#email')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();
    await page.screenshot({ path: 'screenshots/enhance-login-route.png', fullPage: true });

    await context.close();
  });

  test('/register renders the create-account form', async ({ browser }) => {
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();

    await page.goto('/register');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/register$/);

    await expect(page.getByRole('heading', { name: /create account/i })).toBeVisible();
    await expect(page.locator('#name')).toBeVisible();
    await expect(page.locator('#confirm-password')).toBeVisible();
    await page.screenshot({ path: 'screenshots/enhance-register-route.png', fullPage: true });

    await context.close();
  });

  test('old /admin/login redirects an unauthenticated visitor to /login', async ({ browser }) => {
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();

    await page.goto('/admin/login');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/\/login$/);

    await context.close();
  });
});
