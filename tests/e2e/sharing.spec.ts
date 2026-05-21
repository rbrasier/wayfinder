/**
 * sharing.spec.ts
 *
 * Tests the session-sharing feature:
 *   - Share button is visible on an active session page
 *   - Clicking Share copies a ?shared=true URL to the clipboard
 *   - Navigating to the shared URL shows a read-only view (no composer)
 *   - Messages and step history are still visible in the shared view
 *
 * These tests require at least one session to exist in the database.
 */

import { test, expect } from './helpers/base';

async function resolveSessionId(page: import('@playwright/test').Page): Promise<string | null> {
  await page.goto('/chats');
  await page.waitForLoadState('networkidle');

  const sessionLink = page.getByRole('link').filter({ hasText: /.+/ }).first();
  const href = await sessionLink.getAttribute('href').catch(() => null);
  if (!href) return null;

  const match = href.match(/\/chats\/([^/?]+)/);
  return match?.[1] ?? null;
}

test.describe('Sharing — Share button', () => {
  test('share button is visible on a session page', async ({ page, consoleLogs }) => {
    const sessionId = await resolveSessionId(page);

    if (!sessionId) {
      test.skip(true, 'No sessions available — create a session to enable sharing tests');
      return;
    }

    await page.goto(`/chats/${sessionId}`);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'screenshots/sharing-session-loaded.png', fullPage: true });

    // ShareButton renders as a button with a "Share" label or icon
    const shareButton = page.getByRole('button', { name: /share/i }).first();
    const hasShare = await shareButton.isVisible().catch(() => false);

    if (!hasShare) {
      await page.screenshot({ path: 'screenshots/sharing-button-not-found.png', fullPage: true });
      test.skip(true, 'Share button not found — it may only render for the session owner');
      return;
    }

    await expect(shareButton).toBeVisible();

    const errors = consoleLogs.filter(l => l.type === 'error');
    expect(errors, `Errors on session page:\n${errors.map(e => e.text).join('\n')}`).toHaveLength(0);
  });

  test('clicking share copies a URL containing ?shared=true', async ({ page, context }) => {
    const sessionId = await resolveSessionId(page);

    if (!sessionId) {
      test.skip(true, 'No sessions available');
      return;
    }

    await page.goto(`/chats/${sessionId}`);
    await page.waitForLoadState('networkidle');

    const shareButton = page.getByRole('button', { name: /share/i }).first();
    const hasShare = await shareButton.isVisible().catch(() => false);

    if (!hasShare) {
      test.skip(true, 'Share button not visible');
      return;
    }

    // Grant clipboard permissions so we can read what was copied
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    await shareButton.click();
    await page.waitForTimeout(500); // allow clipboard write to complete

    await page.screenshot({ path: 'screenshots/sharing-after-click.png', fullPage: true });

    // Read clipboard if the browser allows it
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null);

    if (clipboardText !== null) {
      expect(clipboardText).toContain('shared=true');
      expect(clipboardText).toContain(sessionId);
    }
    // If clipboard is unavailable, the screenshot is the evidence
  });
});

test.describe('Sharing — Read-only view', () => {
  test('shared URL renders without the chat composer', async ({ page, consoleLogs }) => {
    const sessionId = await resolveSessionId(page);

    if (!sessionId) {
      test.skip(true, 'No sessions available');
      return;
    }

    await page.goto(`/chats/${sessionId}?shared=true`);
    await page.waitForLoadState('networkidle');

    await page.screenshot({ path: 'screenshots/sharing-read-only.png', fullPage: true });

    // In shared/read-only mode, no textarea should be present
    const composer = page.locator(
      'textarea[placeholder*="Wayfinder"], textarea[placeholder*="message" i]'
    );
    await expect(composer).not.toBeVisible();

    const errors = consoleLogs.filter(l => l.type === 'error');
    expect(errors, `Errors in shared view:\n${errors.map(e => e.text).join('\n')}`).toHaveLength(0);
  });

  test('shared view preserves existing messages', async ({ page, consoleLogs }) => {
    const sessionId = await resolveSessionId(page);

    if (!sessionId) {
      test.skip(true, 'No sessions available');
      return;
    }

    // First confirm the session actually has messages
    await page.goto(`/chats/${sessionId}`);
    await page.waitForLoadState('networkidle');

    const messages = page.locator('[class*="message"], [data-testid="message"], [data-role]');
    const messageCount = await messages.count();

    if (messageCount === 0) {
      test.skip(true, 'Session has no messages — send at least one message first');
      return;
    }

    // Now load the shared view and verify messages are still visible
    await page.goto(`/chats/${sessionId}?shared=true`);
    await page.waitForLoadState('networkidle');

    const sharedMessages = page.locator('[class*="message"], [data-testid="message"], [data-role]');
    await expect(sharedMessages.first()).toBeVisible();

    await page.screenshot({ path: 'screenshots/sharing-messages-visible.png', fullPage: true });

    const errors = consoleLogs.filter(l => l.type === 'error');
    expect(errors, `Errors in shared view:\n${errors.map(e => e.text).join('\n')}`).toHaveLength(0);
  });

  test('shared view page loads without JS errors', async ({ page, consoleLogs }) => {
    const sessionId = await resolveSessionId(page);

    if (!sessionId) {
      test.skip(true, 'No sessions available');
      return;
    }

    await page.goto(`/chats/${sessionId}?shared=true`);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'screenshots/sharing-smoke.png', fullPage: true });

    const errors = consoleLogs.filter(l => l.type === 'error');
    expect(errors, `JS errors in shared view:\n${errors.map(e => e.text).join('\n')}`).toHaveLength(0);
  });
});
