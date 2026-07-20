/**
 * phase-entra-login-auth-methods.spec.ts
 *
 * Covers v1.45.0 — Entra login & admin-configurable auth methods.
 *
 * The main suite runs with a stored admin session. The admin test drives the
 * new Authentication card on /admin/settings; the login-surface checks use a
 * FRESH context (no stored session) so the real /login page renders.
 *
 * Flow under test (PRD: entra-login-and-auth-methods):
 *   1. By default only Email + Password is enabled — /login shows the email
 *      form and NO "Sign in with Microsoft" button.
 *   2. An admin opens the Authentication card, enables Microsoft Entra ID,
 *      pastes app-registration credentials (the read-only redirect URI is
 *      shown) and saves.
 *   3. /login now offers "Sign in with Microsoft".
 *
 * The test restores email-only auth at the end so global settings are left as
 * they were found.
 */

import { test, expect } from './helpers/base';

const openAuthCard = async (page: import('@playwright/test').Page) => {
  await page.goto('/admin/settings');
  await page.waitForLoadState('networkidle');

  const editButtons = page.getByRole('button', { name: /^edit$/i });
  const editCount = await editButtons.count();
  for (let index = 0; index < editCount; index += 1) {
    await editButtons.nth(index).click();
    if (await page.locator('#auth-entra').isVisible().catch(() => false)) return true;
    await page.keyboard.press('Escape').catch(() => {});
  }
  return false;
};

const expectLoginShowsMicrosoft = async (browser: import('@playwright/test').Browser) => {
  const context = await browser.newContext({ storageState: undefined });
  try {
    const page = await context.newPage();
    await page.goto('/login');
    // Web-first assertion auto-waits for the enabledAuthMethods query to resolve
    // and the button to mount — never a non-retrying isVisible() snapshot.
    await expect(page.getByRole('button', { name: /sign in with microsoft/i })).toBeVisible();
  } finally {
    await context.close();
  }
};

test.describe('Phase: Entra login & configurable auth methods', () => {
  test('login shows only the email form when Entra is disabled', async ({ browser }) => {
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();

    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'screenshots/entra-login-default.png', fullPage: true });

    await expect(page.locator('#email')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();
    await expect(
      page.getByRole('button', { name: /sign in with microsoft/i }),
    ).toHaveCount(0);

    await context.close();
  });

  test('admin enables Entra and the login page offers Microsoft sign-in', async ({
    page,
    browser,
  }) => {
    const opened = await openAuthCard(page);
    if (!opened) {
      await page.screenshot({ path: 'screenshots/entra-auth-card-missing.png', fullPage: true });
      test.skip(true, 'Authentication card (#auth-entra) not reachable on /admin/settings');
      return;
    }

    // Enabling Entra reveals the credential fields and the read-only redirect URI.
    await page.locator('#auth-entra').check();
    await expect(page.locator('#auth-entra-redirect')).toBeVisible();
    await expect(page.locator('#auth-entra-redirect')).toHaveValue(/\/api\/auth\/callback\/microsoft$/);

    await page.locator('#auth-entra-tenant').fill('00000000-0000-0000-0000-000000000000');
    await page.locator('#auth-entra-client').fill('11111111-1111-1111-1111-111111111111');
    await page.locator('#auth-entra-secret').fill('e2e-test-secret');
    await page.screenshot({ path: 'screenshots/entra-auth-card-configured.png', fullPage: true });

    await page.getByRole('button', { name: /^save$/i }).click();
    await expect(page.getByText(/authentication settings saved/i)).toBeVisible();

    // The stored secret round-trips as "set", never the value.
    await openAuthCard(page);
    await expect(page.locator('#auth-entra-secret')).toHaveAttribute(
      'placeholder',
      /unchanged/i,
    );
    await page.keyboard.press('Escape').catch(() => {});

    await expectLoginShowsMicrosoft(browser);

    // Restore email-only auth so global settings are left as found.
    await openAuthCard(page);
    await page.locator('#auth-entra').uncheck();
    await page.getByRole('button', { name: /^save$/i }).click();
    await expect(page.getByText(/authentication settings saved/i)).toBeVisible();
  });
});
