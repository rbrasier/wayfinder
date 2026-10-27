/**
 * fix-entra-admin-recovery.spec.ts
 *
 * Regression cover for the lockout with no way out: Entra takes precedence over
 * a password, so linking a Microsoft identity destroys the account's credential
 * row. Once an administrator has signed in through Entra even once, an outage at
 * the identity provider leaves them unable to sign in by any method — and
 * /admin/settings, the only place email/password can be turned back on, is
 * behind that same broken login.
 *
 * The fix is a break-glass command that requires shell and database access to
 * the deployment (which the remote pre-registration attack the deletion defends
 * against does not have), so the deletion itself is unchanged.
 *
 * Drives the whole OAuth code flow against the mock Entra identity provider on
 * the shared mocks server (mocks/entra/oidc.mjs, :4001/entra), started by the
 * e2e workflow and by `./restart.sh --with-mocks` locally.
 *
 * What it proves, end to end:
 *   1. An administrator who signs in through Entra loses their password —
 *      the setup for the bug, and still the intended behaviour.
 *   2. `recover-admin` gives that administrator a working password back,
 *      without the identity provider being involved at all.
 *   3. The recovered account is still an administrator: /admin is reachable.
 *
 * The suite restores Entra-disabled auth at the end so global settings are left
 * as they were found.
 */

import { spawn } from 'node:child_process';
import { join } from 'node:path';
import type { Browser, Page } from '@playwright/test';
import { test, expect } from './helpers/base';
import { openSettingsSection } from './helpers/settings';

const MOCK_ENTRA_HEALTH = 'http://localhost:4001/healthz';
const ORIGINAL_PASSWORD = 'RecoverTest!2345';
const RECOVERED_PASSWORD = 'BreakGlass!6789';

const repoRoot = join(__dirname, '../../..');

const uniqueEmail = () => `recover-${Date.now()}-${Math.floor(Math.random() * 1000)}@example.com`;

const mockEntraRunning = async (): Promise<boolean> => {
  try {
    const response = await fetch(MOCK_ENTRA_HEALTH);
    return response.ok;
  } catch {
    return false;
  }
};

const openAuthCard = async (page: Page): Promise<boolean> => {
  await page.goto('/admin/settings');
  await page.waitForLoadState('networkidle');
  await openSettingsSection(page, 'General');

  const editButtons = page.getByRole('button', { name: /^edit$/i });
  const editCount = await editButtons.count();
  for (let index = 0; index < editCount; index += 1) {
    await editButtons.nth(index).click();
    if (await page.locator('#auth-entra').isVisible().catch(() => false)) return true;
    await page.keyboard.press('Escape').catch(() => {});
  }
  return false;
};

const setEntraEnabled = async (page: Page, enabled: boolean): Promise<boolean> => {
  const opened = await openAuthCard(page);
  if (!opened) return false;

  if (enabled) {
    // Must match the authority the app was booted with: the provider builds
    // `${ENTRA_AUTHORITY}/${tenantId}/oauth2/v2.0/authorize`, and the mock
    // accepts any tenant segment.
    await page.locator('#auth-entra').check();
    await page.locator('#auth-entra-tenant').fill('mock-tenant');
    await page.locator('#auth-entra-client').fill('mock-client');
    await page.locator('#auth-entra-secret').fill('mock-secret');
  } else {
    await page.locator('#auth-entra').uncheck();
  }

  await page.getByRole('button', { name: /^save$/i }).click();
  await expect(page.getByText(/authentication settings saved/i)).toBeVisible();
  return true;
};

const registerPasswordUser = async (browser: Browser, email: string): Promise<void> => {
  const context = await browser.newContext({ storageState: undefined });
  try {
    const page = await context.newPage();
    await page.goto('/register');
    await page.locator('#name').fill('Recovery Test Admin');
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(ORIGINAL_PASSWORD);
    await page.locator('#confirm-password').fill(ORIGINAL_PASSWORD);
    await page.getByRole('button', { name: /create account|register|sign up/i }).click();
    await expect(page).not.toHaveURL(/\/register/, { timeout: 15000 });
  } finally {
    await context.close();
  }
};

// The bug is specifically about administrators, so the account under test has to
// be one — the recovery command reports on `isAdmin` and never sets it.
const promoteToAdmin = async (page: Page, email: string): Promise<void> => {
  await page.goto('/admin/users');
  await page.waitForLoadState('networkidle');

  const row = page.getByRole('row').filter({ hasText: email });
  await expect(row).toBeVisible({ timeout: 15000 });
  await row.getByRole('button', { name: /^edit$/i }).click();

  await page.getByRole('checkbox', { name: /^global admin$/i }).check();
  await page.getByRole('button', { name: /^save$/i }).click();

  await expect(row.getByText(/^Global Admin$/)).toBeVisible({ timeout: 15000 });
};

const signInWithEntra = async (browser: Browser, email: string): Promise<void> => {
  const context = await browser.newContext({ storageState: undefined });
  try {
    const page = await context.newPage();
    await page.goto('/login');
    await page.getByRole('button', { name: /sign in with microsoft/i }).click();

    await expect(page.getByTestId('mock-entra-email')).toBeVisible({ timeout: 15000 });
    await page.getByTestId('mock-entra-email').fill(email);
    await page.getByTestId('mock-entra-submit').click();

    await expect(page).not.toHaveURL(/\/login/, { timeout: 20000 });
  } finally {
    await context.close();
  }
};

const passwordSignIn = async (
  browser: Browser,
  email: string,
  password: string,
  screenshot: string,
): Promise<{ signedIn: boolean; page: Page; close: () => Promise<void> }> => {
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();
  await page.goto('/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: /^sign in$/i }).click();

  // A rejected sign-in stays put; an accepted one navigates away.
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15000 })
    .catch(() => {});
  await page.screenshot({ path: `screenshots/${screenshot}.png`, fullPage: true });

  return {
    signedIn: !new URL(page.url()).pathname.startsWith('/login'),
    page,
    close: () => context.close(),
  };
};

// Spawned asynchronously, not with spawnSync: the command is a cold pnpm + tsx
// start that takes tens of seconds on a CI runner, and blocking the worker's
// event loop for that long makes Playwright tear the test down mid-call instead
// of reporting whatever the command said. stdout and stderr are both collected
// because the non-admin warning goes to stderr.
const runRecoveryCommand = (email: string, password: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = spawn(
      'pnpm',
      ['--filter', '@wayfinder/api', 'recover-admin', '--', '--email', email],
      { cwd: repoRoot },
    );

    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve(output);
      reject(new Error(`recover-admin exited ${code}:\n${output}`));
    });

    child.stdin.end(password);
  });

test.describe('Fix: an admin locked out by an Entra outage can be recovered', () => {
  test('recover-admin restores a working password without the identity provider', async ({
    page,
    browser,
  }) => {
    // Well past the 45s default: this single test registers a user, promotes
    // them, saves settings, completes an OAuth round-trip, signs in three
    // times, and shells out to a cold pnpm + tsx start.
    test.setTimeout(240_000);
    test.skip(!(await mockEntraRunning()), 'mock Entra not reachable on :4001');

    const email = uniqueEmail();
    await registerPasswordUser(browser, email);
    await promoteToAdmin(page, email);

    const enabled = await setEntraEnabled(page, true);
    if (!enabled) {
      await page.screenshot({ path: 'screenshots/recover-auth-card-missing.png', fullPage: true });
      test.skip(true, 'Authentication card (#auth-entra) not reachable on /admin/settings');
      return;
    }

    try {
      await signInWithEntra(browser, email);

      // The setup for the bug: the link destroyed the credential row, so the
      // administrator now depends entirely on Entra.
      const beforeRecovery = await passwordSignIn(
        browser,
        email,
        ORIGINAL_PASSWORD,
        'recover-password-retired',
      );
      expect(beforeRecovery.signedIn).toBe(false);
      await beforeRecovery.close();

      // Entra is now the only way in. Break glass — no identity provider
      // involved, just shell and database access to the deployment.
      const output = await runRecoveryCommand(email, RECOVERED_PASSWORD);
      expect(output).toContain('Password sign-in restored');
      expect(output).not.toContain('not an administrator');

      const afterRecovery = await passwordSignIn(
        browser,
        email,
        RECOVERED_PASSWORD,
        'recover-password-restored',
      );
      expect(afterRecovery.signedIn).toBe(true);

      // Recovered as an administrator, not merely as a signed-in user.
      await afterRecovery.page.goto('/admin/users');
      await afterRecovery.page.waitForLoadState('networkidle');
      await expect(afterRecovery.page).toHaveURL(/\/admin\/users/);
      await afterRecovery.page.screenshot({
        path: 'screenshots/recover-admin-access-restored.png',
        fullPage: true,
      });
      await afterRecovery.close();
    } finally {
      // Never let cleanup become the reported failure: if the body ran out of
      // time the page is already closed, and the useful error is the body's.
      if (!page.isClosed()) await setEntraEnabled(page, false).catch(() => {});
    }
  });
});
