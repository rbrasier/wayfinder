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

  // Streaming into the DOM (e2e-test-policy group 2): a turn that consults MCP
  // tools takes longer, so the dots say what the AI is doing. The stream is
  // replayed slowly in the page — the base fixture's mock answers in one go,
  // too fast for a label that only lives while the turn is under way.
  test('a turn says what it is doing while it waits: thinking, then the tools it consults', async ({ page }) => {
    const { sessionId } = requireSeedFixtures();
    await page.addInitScript(() => {
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (!/\/api\/chat\/[^/]+\/stream/.test(url)) return originalFetch(input, init);
        const encoder = new TextEncoder();
        const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
        const body = new ReadableStream({
          async start(controller) {
            controller.enqueue(encoder.encode('f:{"messageId":"msg-tools"}\n'));
            await wait(1500);
            controller.enqueue(
              encoder.encode('8:[{"type":"consulting-tools","active":true,"sources":["ParlView"]}]\n'),
            );
            await wait(3000);
            controller.enqueue(encoder.encode('8:[{"type":"consulting-tools","active":false,"sources":[]}]\n'));
            await wait(3000);
            controller.enqueue(encoder.encode('0:"The committee examined budget estimates."\n'));
            controller.enqueue(
              encoder.encode(
                'e:{"finishReason":"stop","usage":{"promptTokens":1,"completionTokens":1},"isContinued":false}\n',
              ),
            );
            controller.enqueue(
              encoder.encode('d:{"finishReason":"stop","usage":{"promptTokens":1,"completionTokens":1}}\n'),
            );
            controller.close();
          },
        });
        return new Response(body, {
          status: 200,
          headers: { 'Content-Type': 'text/plain; charset=utf-8', 'x-vercel-ai-data-stream': 'v1' },
        });
      };
    });

    await page.goto(`/chats/${sessionId}`);
    const input = page.locator('textarea[placeholder*="Wayfinder"]').first();
    await expect(input).toBeVisible();
    await input.fill('Look for a transcript');
    await input.press('Enter');

    const activity = page.getByTestId('turn-activity');
    await expect(activity).toContainText('Thinking…');
    await expect(activity).toContainText('Consulting ParlView…');
    await page.screenshot({ path: 'screenshots/chat-consulting-tools.png', fullPage: true });
    await expect(activity).toContainText('Thinking…');
    // Gone once the reply streams in. The reply itself is not asserted: this
    // mock never reaches the server, so the page drops it when it resyncs
    // with the stored history at the end of the turn.
    await expect(activity).toHaveCount(0, { timeout: 10_000 });
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
