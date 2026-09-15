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

test.describe('Session lifecycle: policy dialog', () => {
  const openPolicyDialog = async (page: import('@playwright/test').Page) => {
    await page.goto('/admin/settings');
    await openSettingsSection(page, 'General');
    await page.getByTestId('session-policy-open').click();
    // The dialog loads the policy on open, so wait for the field rather than
    // racing the query.
    await expect(page.locator('#session-policy-idle-input')).toBeVisible();
  };

  test('rejects an absolute timeout shorter than the idle timeout', async ({ page }) => {
    await openPolicyDialog(page);

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

  test('saves a policy and reads it back the next time the dialog opens', async ({ page }) => {
    await openPolicyDialog(page);

    await page.locator('#session-policy-idle-input').fill('30');
    await page.locator('#session-policy-absolute-input').fill('480');
    await page.getByTestId('session-policy-save').click();
    await expect(page.getByText(/session policy saved/i)).toBeVisible();

    // Nothing on the settings page shows the policy any more, so re-opening the
    // dialog is what proves the save round-tripped.
    await openPolicyDialog(page);
    await expect(page.locator('#session-policy-idle-input')).toHaveValue('30');
    await expect(page.locator('#session-policy-absolute-input')).toHaveValue('480');
    await page.screenshot({
      path: 'screenshots/session-lifecycle-policy-saved.png',
      fullPage: true,
    });

    // Put it back, so a later spec in the same run is not signed out mid-test by
    // a policy this one left behind.
    await page.locator('#session-policy-idle-input').fill('0');
    await page.locator('#session-policy-absolute-input').fill('0');
    await page.getByTestId('session-policy-save').click();
    await expect(page.getByText(/session policy saved/i)).toBeVisible();
  });
});

/**
 * Admin "view as user" — ADR-059 layered sessions, v0.37.0.
 *
 * Qualifies under group 1 ("auth session lifecycle": the whole feature is
 * cookie behaviour and the redirects it drives) and group 4 ("navigation state
 * across a page load": starting and stopping both do a full document load, and
 * the point of the feature is that the server re-renders as a different
 * principal). The ticket's expiry arithmetic, the cookie's signing, the six
 * resolver paths and the audit metadata are unit-tested in the domain, adapters
 * and router, and are deliberately not re-tested here.
 */
test.describe('View as user', () => {
  // One round trip, not three near-identical ones. The admin-only gate is not
  // tested here: `/api/auth/test-session` mints every user with isAdmin true
  // (route.ts), so the suite has no non-admin to assert against, and "a button
  // is hidden for a role" is conditional rendering rather than one of the six
  // groups in e2e-test-policy.md. That boundary is enforced server-side and
  // covered there — the start route answers 403 and `listTargets` FORBIDDEN.
  test('an admin views as another user, sees the banner, and returns', async ({
    browser,
    request,
    page,
  }) => {
    // Give the picker somebody to find who is not the admin driving the test.
    const targetContext = await signedInContextFor(browser, request, REVOKE_TARGET_EMAIL);
    await targetContext.close();

    await page.goto('/chats');
    await page.getByLabel('Account menu').click();
    await page.getByTestId('view-as-user').click();

    await page.getByLabel('Search users').fill(REVOKE_TARGET_EMAIL);
    await page.getByRole('button', { name: new RegExp(REVOKE_TARGET_EMAIL, 'i') }).click();

    // NOT `toHaveURL(/chats/)` — the admin was already on /chats before
    // clicking, so that assertion passes whether or not anything happened. The
    // banner is the first thing that only exists if the server re-resolved the
    // request as somebody else.
    //
    // The generous timeout is for `next dev`, which compiles routes on demand:
    // the first navigation of a run has been seen taking over eight seconds in
    // CI, against a 5s default. Later assertions use the default.
    const banner = page.getByTestId('impersonation-banner');
    await expect(banner).toBeVisible({ timeout: 30_000 });
    await expect(banner).toContainText(REVOKE_TARGET_EMAIL);
    await expect(page.getByTestId('impersonation-minutes')).toContainText(/\d+ min left/);

    // The cookie is the thing that was silently missing when this feature first
    // shipped: it was set inside a tRPC procedure, and the app's streaming tRPC
    // link returns the response headers before any procedure body runs, so
    // `Set-Cookie` was dropped and the whole feature was inert.
    const cookies = await page.context().cookies();
    expect(cookies.find((c) => c.name === 'wf.impersonation')?.value ?? '').not.toBe('');

    await page.screenshot({
      path: 'screenshots/view-as-user-banner.png',
      fullPage: true,
    });

    // A simulated session is never an admin session, whoever is simulated.
    await page.goto('/admin/users');
    await expect(page).toHaveURL(/\/chats/);

    await page.getByRole('button', { name: /return to your account/i }).click();

    await expect(banner).toBeHidden();
    // Proof the admin really is themselves again: the admin section admits them.
    await page.goto('/admin/users');
    await expect(page).toHaveURL(/\/admin\/users/);
  });
});
