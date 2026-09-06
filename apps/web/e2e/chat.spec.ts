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
import { requireSeedFixtures } from './helpers/seed';

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
  test('session page loads', async ({ page, consoleLogs }) => {
    const { sessionId } = requireSeedFixtures();

    await page.goto(`/chats/${sessionId}`);
    // A session page holds an open SSE stream, so the network is never idle and
    // waitForLoadState('networkidle') can only burn the timeout (see
    // docs/development/e2e-triage-handover.md §4). Wait for the composer, which is
    // what "the session page is ready" actually means.
    await expect(page.locator('textarea[placeholder*="Wayfinder"]')).toBeVisible();
    await page.screenshot({ path: 'screenshots/chat-session-initial.png', fullPage: true });

    const errors = consoleLogs.filter(l => l.type === 'error');
    expect(errors, `JS errors on chat session:\n${errors.map(e => e.text).join('\n')}`).toHaveLength(0);
  });

  test('message input accepts text', async ({ page }) => {
    const { sessionId } = requireSeedFixtures();

    await page.goto(`/chats/${sessionId}`);
    await expect(page.locator('textarea[placeholder*="Wayfinder"]')).toBeVisible();

    // ChatComposer renders a <textarea> with placeholder "Message Wayfinder…"
    const input = page.locator('textarea[placeholder*="Wayfinder"], textarea[placeholder*="message" i]').first();
    await expect(input).toBeVisible();

    await input.fill('Hello, I need help with a workflow');
    await page.screenshot({ path: 'screenshots/chat-text-entered.png' });
    await expect(input).toHaveValue('Hello, I need help with a workflow');
  });

  test('sending a message shows AI response', async ({ page, consoleLogs }) => {
    const { sessionId } = requireSeedFixtures();

    await page.goto(`/chats/${sessionId}`);
    await expect(page.locator('textarea[placeholder*="Wayfinder"]')).toBeVisible();

    const input = page.locator('textarea[placeholder*="Wayfinder"], textarea[placeholder*="message" i]').first();
    await expect(input).toBeVisible();

    // None of the four selectors this used to wait for exist in the feed:
    // message-feed.tsx has no data-testid, no [role="log"], and its Tailwind
    // classes contain no "message". It reported "AI response did not appear"
    // for a reply that was on screen the whole time, and only surfaced at all
    // once the composer guard stopped skipping the test.
    //
    // The reply has to be counted from a baseline, not merely found: the seed
    // gives every session a thread that already contains assistant messages, so
    // "an assistant bubble is visible" is true before a single word is sent.
    // Counting from before the send is what makes this about *this* turn.
    const assistantBubbles = page.locator('[data-chat-message="assistant"]');
    const bubblesBefore = await assistantBubbles.count();

    await input.fill('Hello');

    // The Next.js dev overlay portal covers the send button in headless mode.
    // Use Enter on the textarea — same handler, no pointer-event coverage issue.
    await input.press('Enter');

    // Wait for AI response (mocked = fast, real = up to 30s)
    const timeout = process.env.USE_REAL_AI === 'true' ? 30_000 : 8_000;

    // Greater-than rather than exactly one more: a single streamed response can
    // split into several bubbles at finish_step boundaries (message-feed.tsx),
    // so an exact count would be asserting the shape of the reply, not that one
    // arrived.
    await expect
      .poll(() => assistantBubbles.count(), { timeout })
      .toBeGreaterThan(bubblesBefore);
    await page.screenshot({ path: 'screenshots/chat-ai-responded.png', fullPage: true });

    const errors = consoleLogs.filter(l => l.type === 'error');
    expect(errors, `Errors during chat:\n${errors.map(e => e.text).join('\n')}`).toHaveLength(0);
  });

  test('multi-turn conversation works', async ({ page, consoleLogs }) => {
    const { sessionId } = requireSeedFixtures();

    await page.goto(`/chats/${sessionId}`);
    await expect(page.locator('textarea[placeholder*="Wayfinder"]')).toBeVisible();

    const input = page.locator('textarea[placeholder*="Wayfinder"], textarea[placeholder*="message" i]').first();
    await expect(input).toBeVisible();

    const timeout = process.env.USE_REAL_AI === 'true' ? 30_000 : 8_000;
    const messages = [
      'Hello, I need help with a document workflow',
      'My name is Test User and I work at Example Corp',
    ];

    const assistantBubbles = page.locator('[data-chat-message="assistant"]');

    for (let i = 0; i < messages.length; i++) {
      // Per-turn baseline: the seeded thread already carries assistant
      // messages, so only the growth across this turn says a reply arrived.
      const bubblesBefore = await assistantBubbles.count();

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

      // Wait for the response to appear before the next turn.
      //
      // This used to wait on the same dead selectors and then `.catch(() => {})`
      // the timeout, so the test spent 8s per turn proving nothing and passed
      // regardless. Each turn must add at least one assistant bubble.
      await expect
        .poll(() => assistantBubbles.count(), { timeout })
        .toBeGreaterThan(bubblesBefore);

      await page.screenshot({
        path: `screenshots/chat-turn-${i + 1}.png`,
        fullPage: true,
      });
    }

    const errors = consoleLogs.filter(l => l.type === 'error');
    expect(errors, `Errors during multi-turn chat:\n${errors.map(e => e.text).join('\n')}`).toHaveLength(0);
  });
});
