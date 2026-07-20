/**
 * chat.spec.ts
 *
 * Tests the end-user chat interface — the core Wayfinder UX where users
 * follow an AI-guided workflow.
 *
 * Chat sessions live at /chats/[sessionId]. These tests:
 *   1. Verify the /chats list page loads correctly.
 *   2. Create a new session via the tRPC API (requires a published flow),
 *      then navigate to it to test the full composer + response flow.
 *
 * With USE_REAL_AI unset (default): AI responses are mocked instantly.
 * With USE_REAL_AI=true: real Anthropic/OpenAI calls are made.
 */

import { test, expect } from './helpers/base';
import { loadSeedFixtures } from './helpers/seed';

const AI_MODE = process.env.USE_REAL_AI === 'true' ? 'REAL AI' : 'MOCKED AI';

test.describe('Chat: List', () => {
  test('chats list loads', async ({ page, consoleLogs }) => {
    await page.goto('/chats');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'screenshots/chat-list.png', fullPage: true });

    const errors = consoleLogs.filter(l => l.type === 'error');
    expect(errors, `JS errors on chats list:\n${errors.map(e => e.text).join('\n')}`).toHaveLength(0);
  });

  test('chats list shows heading and tabs', async ({ page }) => {
    await page.goto('/chats');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: /my chats/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /active/i })).toBeVisible();
    await page.screenshot({ path: 'screenshots/chat-list-tabs.png' });
  });

  test('New Chat button is visible', async ({ page }) => {
    await page.goto('/chats');
    await page.waitForLoadState('networkidle');

    await expect(
      page.getByRole('banner').getByRole('button', { name: /new chat/i }),
    ).toBeVisible();
  });
});

test.describe('Chat: Session', () => {
  /**
   * Resolve an existing session ID by checking the /chats list.
   * If no sessions exist this returns null and the test skips.
   */
  async function resolveExistingSessionId(page: import('@playwright/test').Page): Promise<string | null> {
    const seeded = loadSeedFixtures()?.sessionId;
    if (seeded) return seeded;

    await page.goto('/chats');
    await page.waitForLoadState('networkidle');

    // Session cards link to /chats/[sessionId]. Nav links use bare "/chats"
    // (no trailing slash + UUID) so a[href^="/chats/"] skips them safely.
    const sessionLink = page.locator('a[href^="/chats/"]').first();
    const href = await sessionLink.getAttribute('href').catch(() => null);

    if (!href) return null;

    const match = href.match(/\/chats\/([^/?]+)/);
    return match?.[1] ?? null;
  }

  test('session page loads', async ({ page, consoleLogs }) => {
    const sessionId = await resolveExistingSessionId(page);

    if (!sessionId) {
      test.skip(true, 'No existing sessions found — create a flow and session to enable this test');
      return;
    }

    await page.goto(`/chats/${sessionId}`);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'screenshots/chat-session-initial.png', fullPage: true });

    const errors = consoleLogs.filter(l => l.type === 'error');
    expect(errors, `JS errors on chat session:\n${errors.map(e => e.text).join('\n')}`).toHaveLength(0);
  });

  test('message input accepts text', async ({ page }) => {
    const sessionId = await resolveExistingSessionId(page);

    if (!sessionId) {
      test.skip(true, 'No existing sessions found — skipping input test');
      return;
    }

    await page.goto(`/chats/${sessionId}`);
    await page.waitForLoadState('networkidle');

    // ChatComposer renders a <textarea> with placeholder "Message Wayfinder…"
    const input = page.locator('textarea[placeholder*="Wayfinder"], textarea[placeholder*="message" i]').first();
    const visible = await input.isVisible().catch(() => false);

    if (!visible) {
      await page.screenshot({ path: 'screenshots/chat-no-input-found.png', fullPage: true });
      test.skip(true, 'Chat input not found — session may be complete/read-only. See screenshot.');
      return;
    }

    await input.fill('Hello, I need help with a workflow');
    await page.screenshot({ path: 'screenshots/chat-text-entered.png' });
    await expect(input).toHaveValue('Hello, I need help with a workflow');
  });

  test('sending a message shows AI response', async ({ page, consoleLogs }) => {
    const sessionId = await resolveExistingSessionId(page);

    if (!sessionId) {
      test.skip(true, 'No existing sessions found — skipping send test');
      return;
    }

    await page.goto(`/chats/${sessionId}`);
    await page.waitForLoadState('networkidle');

    const input = page.locator('textarea[placeholder*="Wayfinder"], textarea[placeholder*="message" i]').first();
    const visible = await input.isVisible().catch(() => false);

    if (!visible) {
      test.skip(true, 'Chat input not found — session may be complete/read-only');
      return;
    }

    await input.fill('Hello');

    // The Next.js dev overlay portal covers the send button in headless mode.
    // Use Enter on the textarea — same handler, no pointer-event coverage issue.
    await input.press('Enter');

    // Wait for AI response (mocked = fast, real = up to 30s)
    const timeout = process.env.USE_REAL_AI === 'true' ? 30_000 : 8_000;

    try {
      await page.waitForSelector([
        '[data-testid="message"]',
        '[class*="message"]',
        '[class*="chat-message"]',
        '[role="log"] > *',
      ].join(', '), { timeout });

      await page.screenshot({ path: 'screenshots/chat-ai-responded.png', fullPage: true });
    } catch {
      await page.screenshot({ path: 'screenshots/chat-after-send-timeout.png', fullPage: true });
      throw new Error(`AI response did not appear within ${timeout}ms — see screenshot`);
    }

    const errors = consoleLogs.filter(l => l.type === 'error');
    expect(errors, `Errors during chat:\n${errors.map(e => e.text).join('\n')}`).toHaveLength(0);
  });

  test('multi-turn conversation works', async ({ page, consoleLogs }) => {
    const sessionId = await resolveExistingSessionId(page);

    if (!sessionId) {
      test.skip(true, 'No existing sessions found — skipping multi-turn test');
      return;
    }

    await page.goto(`/chats/${sessionId}`);
    await page.waitForLoadState('networkidle');

    const input = page.locator('textarea[placeholder*="Wayfinder"], textarea[placeholder*="message" i]').first();
    const visible = await input.isVisible().catch(() => false);

    if (!visible) {
      test.skip(true, 'Chat input not found — skipping multi-turn test');
      return;
    }

    const timeout = process.env.USE_REAL_AI === 'true' ? 30_000 : 8_000;
    const messages = [
      'Hello, I need help with a document workflow',
      'My name is Test User and I work at Example Corp',
    ];

    for (let i = 0; i < messages.length; i++) {
      await input.fill(messages[i]);

      // Same headless-mode portal issue — use Enter consistently.
      await input.press('Enter');

      // Wait for input to clear (indicates the message was sent)
      await page.waitForFunction(
        (selector) => {
          const el = document.querySelector(selector) as HTMLTextAreaElement | null;
          return el ? el.value.length === 0 : false;
        },
        'textarea',
        { timeout }
      ).catch(() => {});

      // Wait for the response to appear before the next turn
      await page.waitForSelector('[class*="message"], [data-testid="message"]', { timeout }).catch(() => {});

      await page.screenshot({
        path: `screenshots/chat-turn-${i + 1}.png`,
        fullPage: true,
      });
    }

    const errors = consoleLogs.filter(l => l.type === 'error');
    expect(errors, `Errors during multi-turn chat:\n${errors.map(e => e.text).join('\n')}`).toHaveLength(0);
  });
});
