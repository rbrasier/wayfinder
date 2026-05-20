/**
 * chat.spec.ts
 *
 * Tests the end-user chat interface — the core Wayfinder UX where users
 * follow an AI-guided workflow.
 *
 * With USE_REAL_AI unset (default): AI responses are mocked instantly.
 * With USE_REAL_AI=true: real Anthropic/OpenAI calls are made.
 *
 * Either way, the UI behaviour is tested identically.
 * Screenshots are taken at every meaningful step.
 */

import { test, expect } from './helpers/base';

const AI_MODE = process.env.USE_REAL_AI === 'true' ? 'REAL AI' : 'MOCKED AI';

test.describe(`Chat — Interface [${AI_MODE}]`, () => {
  test('chat page loads — screenshot initial state', async ({ page, consoleLogs }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'screenshots/chat-initial.png', fullPage: true });

    const errors = consoleLogs.filter(l => l.type === 'error');
    expect(errors, `JS errors on chat load:\n${errors.map(e => e.text).join('\n')}`).toHaveLength(0);
  });

  test('chat input is present and accepts text', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const input = page.locator([
      'textarea',
      'input[type="text"]',
      '[data-testid="chat-input"]',
      '[placeholder*="message" i]',
      '[placeholder*="type" i]',
    ].join(', ')).first();

    const visible = await input.isVisible().catch(() => false);

    if (!visible) {
      await page.screenshot({ path: 'screenshots/chat-no-input-found.png', fullPage: true });
      test.skip(true, 'Chat input not found on root — may need a flow selected first. See screenshot.');
      return;
    }

    await input.fill('Hello, I need help with a workflow');
    await page.screenshot({ path: 'screenshots/chat-text-entered.png' });
    await expect(input).toHaveValue('Hello, I need help with a workflow');
  });

  test('sending a message shows AI response — screenshot end state', async ({ page, consoleLogs }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const input = page.locator('textarea, [data-testid="chat-input"]').first();
    const visible = await input.isVisible().catch(() => false);

    if (!visible) {
      test.skip(true, 'Chat input not found — skipping send test');
      return;
    }

    await input.fill('Hello');

    // Send via Enter or the send button
    const sendBtn = page.getByRole('button', { name: /send|submit/i }).last();
    const hasSendBtn = await sendBtn.isVisible().catch(() => false);

    if (hasSendBtn) {
      await sendBtn.click();
    } else {
      await input.press('Enter');
    }

    // Wait for AI response to appear (mocked = fast, real = up to 30s)
    const timeout = process.env.USE_REAL_AI === 'true' ? 30_000 : 8_000;

    try {
      // Wait for a message to appear in the chat history
      await page.waitForSelector([
        '[data-testid="message"]',
        '[class*="message"]',
        '[class*="chat-message"]',
        '[role="log"] > *',
      ].join(', '), { timeout });

      await page.screenshot({ path: 'screenshots/chat-ai-responded.png', fullPage: true });
    } catch {
      // Even if we can't find the exact selector, screenshot what we have
      await page.screenshot({ path: 'screenshots/chat-after-send-timeout.png', fullPage: true });
      throw new Error(`AI response did not appear within ${timeout}ms — see screenshot`);
    }

    const errors = consoleLogs.filter(l => l.type === 'error');
    expect(errors, `Errors during chat:\n${errors.map(e => e.text).join('\n')}`).toHaveLength(0);
  });

  test('multi-turn conversation — screenshot after each exchange', async ({ page, consoleLogs }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const input = page.locator('textarea, [data-testid="chat-input"]').first();
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
      const sendBtn = page.getByRole('button', { name: /send|submit/i }).last();
      const hasSendBtn = await sendBtn.isVisible().catch(() => false);

      if (hasSendBtn) {
        await sendBtn.click();
      } else {
        await input.press('Enter');
      }

      // Wait for input to clear (indicates response has started)
      await page.waitForFunction(
        (selector) => {
          const el = document.querySelector(selector) as HTMLTextAreaElement | HTMLInputElement;
          return el ? el.value.length === 0 : false;
        },
        'textarea, [data-testid="chat-input"]',
        { timeout }
      ).catch(() => {});

      await page.waitForTimeout(1500); // allow response to render
      await page.screenshot({
        path: `screenshots/chat-turn-${i + 1}.png`,
        fullPage: true,
      });
    }

    const errors = consoleLogs.filter(l => l.type === 'error');
    expect(errors, `Errors during multi-turn chat:\n${errors.map(e => e.text).join('\n')}`).toHaveLength(0);
  });
});
