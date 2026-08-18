/**
 * session-lifecycle.spec.ts
 *
 * Covers v0.31.0 — admin session lifecycle controls (ADR-035).
 *
 * Qualifies under group 1 of docs/guides/e2e-test-policy.md, "auth session
 * lifecycle": revocation is only really proven by a second browser losing its
 * cookie-backed access and being redirected to /login. The policy predicates,
 * the epoch cache and the concurrency enforcer are unit-tested in the domain and
 * adapters, and are deliberately not re-tested here.
 */

import type { APIRequestContext, Browser, BrowserContext } from '@playwright/test';
import { test, expect } from './helpers/base';
import { openSettingsSection } from './helpers/settings';

const REVOKE_TARGET_EMAIL = 'revoke-target@example.com';

/** Mints a real session for `email` and returns a context already holding it. */
const signedInContextFor = async (
  browser: Browser,
  request: APIRequestContext,
  email: string,
): Promise<BrowserContext> => {
  const response = await request.post('/api/auth/test-session', { data: { email } });
  if (!response.ok()) {
    throw new Error(`Could not mint a session for ${email} (${response.status()})`);
  }
  const { token } = (await response.json()) as { token: string };

  const context = await browser.newContext({ storageState: undefined });
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

test.describe('Session lifecycle: revoke a user everywhere', () => {
  test('an admin ends another user’s sessions and that browser lands on /login', async ({
    browser,
    request,
    page,
  }) => {
    const targetContext = await signedInContextFor(browser, request, REVOKE_TARGET_EMAIL);
    const targetPage = await targetContext.newPage();

    // Establish that the target really is signed in, so the assertion after the
    // revoke is about the revoke and not about a session that never worked.
    await targetPage.goto('/');
    await expect(targetPage).not.toHaveURL(/login/);

    await page.goto('/admin/users');
    const revokeButton = page.getByTestId(`revoke-sessions-${REVOKE_TARGET_EMAIL}`);
    await expect(revokeButton).toBeVisible();
    await revokeButton.click();

    await page.getByTestId('revoke-sessions-confirm').click();
    await expect(page.getByText(/signed out \d+ session/i)).toBeVisible();
    await page.screenshot({ path: 'screenshots/session-lifecycle-revoked.png', fullPage: true });

    // The revoked browser still holds its cookie; the session behind it is gone.
    await targetPage.goto('/');
    await targetPage.waitForURL(/\/login/, { timeout: 15_000 });

    await targetContext.close();
  });
});

test.describe('Session lifecycle: policy card', () => {
  test('rejects an absolute timeout shorter than the idle timeout', async ({ page }) => {
    await page.goto('/admin/settings');
    await openSettingsSection(page, 'General');

    await page.getByTestId('session-policy-edit').click();
    await page.locator('#session-policy-idle-input').fill('120');
    await page.locator('#session-policy-absolute-input').fill('60');
    await page.getByTestId('session-policy-save').click();

    await expect(page.getByText(/absolute timeout must be at least as long/i)).toBeVisible();
    await page.screenshot({
      path: 'screenshots/session-lifecycle-policy-invalid.png',
      fullPage: true,
    });

    // The dialog stays open on a rejection, so the admin can correct the value
    // rather than losing what they typed.
    await expect(page.locator('#session-policy-absolute-input')).toBeVisible();
  });

  test('saves an idle and absolute timeout and shows them on the card', async ({ page }) => {
    await page.goto('/admin/settings');
    await openSettingsSection(page, 'General');

    await page.getByTestId('session-policy-edit').click();
    await page.locator('#session-policy-idle-input').fill('30');
    await page.locator('#session-policy-absolute-input').fill('480');
    await page.getByTestId('session-policy-save').click();

    await expect(page.getByText(/session policy saved/i)).toBeVisible();
    await expect(page.getByTestId('session-policy-idle')).toContainText('30 minutes');
    await expect(page.getByTestId('session-policy-absolute')).toContainText('480 minutes');

    // Put it back, so a later spec in the same run is not signed out mid-test by
    // a policy this one left behind.
    await page.getByTestId('session-policy-edit').click();
    await page.locator('#session-policy-idle-input').fill('0');
    await page.locator('#session-policy-absolute-input').fill('0');
    await page.getByTestId('session-policy-save').click();
    await expect(page.getByTestId('session-policy-idle')).toContainText('Not enforced');
  });
});
