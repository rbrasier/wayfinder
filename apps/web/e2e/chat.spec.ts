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
import { clearAiScript, incompleteTurn, scriptAiFor } from './helpers/ai-script';
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
    const reply = 'Hello. Which document are you working on today?';

    // The base fixture answers the stream in the browser, and the page drops
    // that reply when it resyncs with the stored history at the end of the
    // turn, so a reply counted or found in the DOM was only there if it was
    // read before the resync. Scripting the server's AI stores the reply, so it
    // stays. Waiting for its text, rather than counting bubbles, also keeps the
    // seed's existing assistant messages out of the assertion.
    await scriptAiFor(page, sessionId, [incompleteTurn(reply)]);

    try {
      await page.goto(`/chats/${sessionId}`);
      const input = page.locator('textarea[placeholder*="Wayfinder"]');
      await expect(input).toBeVisible();

      await input.fill('Hello');
      // The Next.js dev overlay portal covers the send button in headless mode.
      // Use Enter on the textarea — same handler, no pointer-event coverage issue.
      await input.press('Enter');

      await expect(
        page.locator('[data-chat-message="assistant"]').filter({ hasText: reply }).first(),
      ).toBeVisible({ timeout: 15_000 });
      await page.screenshot({ path: 'screenshots/chat-ai-responded.png', fullPage: true });

      const errors = consoleLogs.filter(l => l.type === 'error');
      expect(errors, `Errors during chat:\n${errors.map(e => e.text).join('\n')}`).toHaveLength(0);
    } finally {
      await clearAiScript(page, sessionId);
    }
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
        // The AI SDK 5 UI message stream, framed as the route frames it. This
        // runs in the page, so it cannot import the helpers' framing function.
        const event = (chunk: unknown) => encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`);
        const body = new ReadableStream({
          async start(controller) {
            controller.enqueue(event({ type: 'start', messageId: 'msg-tools' }));
            await wait(1500);
            controller.enqueue(
              event({
                type: 'data-turn-annotation',
                data: { type: 'consulting-tools', active: true, sources: ['ParlView'] },
              }),
            );
            await wait(3000);
            controller.enqueue(
              event({ type: 'data-turn-annotation', data: { type: 'consulting-tools', active: false, sources: [] } }),
            );
            await wait(3000);
            controller.enqueue(event({ type: 'text-start', id: 'reply' }));
            controller.enqueue(
              event({ type: 'text-delta', id: 'reply', delta: 'The committee examined budget estimates.' }),
            );
            controller.enqueue(event({ type: 'text-end', id: 'reply' }));
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          },
        });
        return new Response(body, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' },
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
    const turns = [
      {
        message: 'Hello, I need help with a document workflow',
        reply: 'Happy to help. Which document are you preparing?',
      },
      {
        message: 'My name is Test User and I work at Example Corp',
        reply: 'Thanks, Test User. What does Example Corp need it for?',
      },
    ];

    // The base fixture answers the stream in the browser, and the page drops
    // that reply when it resyncs with the stored history at the end of the
    // turn, so a count of bubbles only grew if it was read before the resync.
    // Scripting the server's AI stores each reply, so it stays.
    await scriptAiFor(page, sessionId, turns.map(({ reply }) => incompleteTurn(reply)));

    try {
      await page.goto(`/chats/${sessionId}`);
      const input = page.locator('textarea[placeholder*="Wayfinder"]');
      await expect(input).toBeVisible();

      const assistantBubbles = page.locator('[data-chat-message="assistant"]');

      for (const [index, turn] of turns.entries()) {
        await input.fill(turn.message);
        // Same headless-mode portal issue — use Enter consistently.
        await input.press('Enter');

        await expect(
          assistantBubbles.filter({ hasText: turn.reply }).first(),
          `assistant reply to turn ${index + 1}`,
        ).toBeVisible({ timeout: 15_000 });
        await expect(input).toBeEnabled();

        await page.screenshot({
          path: `screenshots/chat-turn-${index + 1}.png`,
          fullPage: true,
        });
      }

      // Both replies are still there once the second turn's resync is done.
      await expect(assistantBubbles.filter({ hasText: turns[0].reply }).first()).toBeVisible();

      const errors = consoleLogs.filter(l => l.type === 'error');
      expect(errors, `Errors during multi-turn chat:\n${errors.map(e => e.text).join('\n')}`).toHaveLength(0);
    } finally {
      await clearAiScript(page, sessionId);
    }
  });
});
