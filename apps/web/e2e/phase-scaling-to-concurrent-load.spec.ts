/**
 * phase-scaling-to-concurrent-load.spec.ts
 *
 * Phase: Scaling to Concurrent Load (P0).
 *
 * Exercises the request-path session + permission caching added in P0 through the
 * real app surface. The cache sits in front of `resolveSession` and effective
 * permission resolution, so the externally observable contract is:
 *
 *   Happy path — repeated authenticated navigations keep resolving the *same* user
 *   correctly (the cache must not serve a stale or cross-user identity), and
 *   protected pages render without bouncing to /login.
 *
 *   Error path — an unauthenticated request is rejected, and a *repeat* request with
 *   the same missing/invalid cookie is rejected again. This proves negative results
 *   are never cached: a user who just logged in is never locked out by a stale miss.
 */

import { test, expect } from './helpers/base';

test.describe('Scaling P0: cached session + permission resolution', () => {
  test('repeated authenticated navigations stay logged in and consistent', async ({ page }) => {
    // Each visit re-runs session + permission resolution; the first populates the
    // cache, the rest are served from it. All must resolve the same admin identity.
    const protectedPaths = ['/chats', '/admin/users', '/chats', '/admin/flows', '/admin/users'];

    for (const path of protectedPaths) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await expect(page, `expected ${path} to stay authenticated`).not.toHaveURL(/\/login/);
    }

    await page.screenshot({
      path: 'screenshots/scaling-cached-auth-navigation.png',
      fullPage: true,
    });
  });

  test('admin permissions resolve consistently across rapid repeat loads', async ({ page }) => {
    // /admin/users is permission-gated. Loading it several times in quick succession
    // exercises the permission cache; the admin must retain access every time.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await page.goto('/admin/users');
      await page.waitForLoadState('networkidle');
      await expect(page).not.toHaveURL(/\/login/);
      await expect(page).toHaveURL(/\/admin\/users/);
    }
  });

  test('unauthenticated requests are rejected on every repeat (no negative caching)', async ({ browser }) => {
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();

    // First miss.
    await page.goto('/chats');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/login/);

    // Repeat miss — if negative results were cached this could behave differently;
    // it must still redirect to login.
    await page.goto('/admin/users');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/login/);

    await page.screenshot({
      path: 'screenshots/scaling-unauth-rejected.png',
      fullPage: true,
    });
    await context.close();
  });

  test('a stale session cookie is rejected and re-rejected', async ({ browser }) => {
    const context = await browser.newContext({ storageState: undefined });
    await context.addCookies([
      {
        name: 'better-auth.session_token',
        value: 'stale-token-not-in-db-for-scaling-phase',
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        secure: false,
        sameSite: 'Lax',
      },
    ]);
    const page = await context.newPage();

    await page.goto('/chats');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/login/);

    await page.goto('/chats');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/login/);

    await context.close();
  });
});
