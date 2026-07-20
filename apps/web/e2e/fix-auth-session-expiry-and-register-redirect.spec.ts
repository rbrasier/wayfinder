/**
 * fix-auth-session-expiry-and-register-redirect.spec.ts
 *
 * Regression tests for two related auth bugs fixed in v1.31.4:
 *
 * Bug 1 — Expired session didn't redirect to login with a message.
 *   Previously: middleware let stale-cookie requests through to protected routes;
 *   layouts had no session guard, so users saw a broken page shell.
 *   Fix: layouts validate the session and redirect to /login?expired=true when
 *   the cookie exists but the session has expired.
 *
 * Bug 2 — /register redirected to /admin for users with expired session cookies.
 *   Previously: middleware used cookie presence (not validity) to redirect /register.
 *   Fix: middleware no longer redirects /register; the register page server component
 *   validates the session properly before redirecting authenticated users.
 *
 * These tests use a fresh context with no stored session so the real auth surfaces render.
 */

import { test, expect } from './helpers/base';

test.describe('Auth: session expiry redirect', () => {
  test('navigating to /chats with no session redirects to /login', async ({ browser }) => {
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();

    await page.goto('/chats');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'screenshots/auth-no-session-chats-redirect.png', fullPage: true });

    await expect(page).toHaveURL(/\/login/);
    await context.close();
  });

  test('navigating to /admin with no session redirects to /login', async ({ browser }) => {
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();

    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'screenshots/auth-no-session-admin-redirect.png', fullPage: true });

    await expect(page).toHaveURL(/\/login/);
    await context.close();
  });

  test('navigating to /chats with an expired session cookie redirects to /login?expired=true', async ({ browser }) => {
    // Simulate an expired session by injecting a cookie with an invalid/expired token.
    const context = await browser.newContext({
      storageState: undefined,
    });

    // Inject a stale session cookie that won't resolve in the DB.
    await context.addCookies([
      {
        name: 'better-auth.session_token',
        value: 'stale-token-that-does-not-exist-in-db',
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
    await page.screenshot({ path: 'screenshots/auth-expired-session-chats-redirect.png', fullPage: true });

    await expect(page).toHaveURL(/\/login\?expired=true/);
    await context.close();
  });

  test('login page shows expired session message when redirected with ?expired=true', async ({ browser }) => {
    const context = await browser.newContext({
      storageState: undefined,
    });

    await context.addCookies([
      {
        name: 'better-auth.session_token',
        value: 'stale-token-that-does-not-exist-in-db',
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
    await page.screenshot({ path: 'screenshots/auth-expired-message-before.png', fullPage: true });

    // Should be on the login page with the expiry banner visible.
    await expect(page).toHaveURL(/\/login\?expired=true/);
    await expect(page.getByText(/your session has expired/i)).toBeVisible();
    await page.screenshot({ path: 'screenshots/auth-expired-message-banner.png', fullPage: true });

    await context.close();
  });

  test('navigating to /admin with an expired session cookie redirects to /login?expired=true', async ({ browser }) => {
    const context = await browser.newContext({ storageState: undefined });

    await context.addCookies([
      {
        name: 'better-auth.session_token',
        value: 'stale-token-that-does-not-exist-in-db',
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        secure: false,
        sameSite: 'Lax',
      },
    ]);

    const page = await context.newPage();
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'screenshots/auth-expired-session-admin-redirect.png', fullPage: true });

    await expect(page).toHaveURL(/\/login\?expired=true/);
    await context.close();
  });
});

test.describe('Auth: /register access with expired session cookie', () => {
  test('/register is accessible when session cookie is present but invalid', async ({ browser }) => {
    // Previously, any non-empty session cookie caused middleware to redirect /register → /admin.
    // After the fix, /register renders the form for users with stale cookies.
    const context = await browser.newContext({ storageState: undefined });

    await context.addCookies([
      {
        name: 'better-auth.session_token',
        value: 'stale-token-that-does-not-exist-in-db',
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        secure: false,
        sameSite: 'Lax',
      },
    ]);

    const page = await context.newPage();
    await page.goto('/register');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'screenshots/auth-register-with-stale-cookie.png', fullPage: true });

    // Should show the register form, not redirect to /admin.
    await expect(page).toHaveURL(/\/register/);
    await expect(page.locator('#email')).toBeVisible();
    await context.close();
  });
});
