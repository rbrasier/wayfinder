/**
 * helpers/chat-mock.ts
 *
 * Per-test overrides for the chat stream endpoint that the base fixture
 * (helpers/base.ts) otherwise mocks as an instant success.
 *
 * Playwright matches routes most-recently-registered-first, so calling these
 * inside a test takes precedence over the base success mock for the matching
 * URL — letting individual tests force a failure (Retry UI) or a delay
 * (assistant typing indicator).
 *
 * The browser hits POST /api/chat/<sessionId>/stream via the Vercel AI SDK
 * `useChat({ api: '/api/chat/<sessionId>/stream' })` hook.
 */

import type { Page } from '@playwright/test';

const STREAM_URL = /\/api\/chat\/[^/]+\/stream(\?.*)?$/;

/**
 * Force the next chat stream to fail with a 500 so `useChat` sets `error`
 * and the message feed renders the "couldn't reply" notice + Retry control.
 */
export async function failChatStream(page: Page): Promise<void> {
  await page.route(STREAM_URL, async (route) => {
    await route.fulfill({
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: 'mock AI failure',
    });
  });
}

/**
 * Hold the chat stream open for `delayMs` before returning a minimal valid
 * Vercel AI SDK data stream. While the request is pending, `useChat` keeps
 * `isLoading` true with no assistant message yet, so the assistant typing
 * indicator stays on screen long enough to assert.
 */
export async function delayChatStream(page: Page, delayMs: number): Promise<void> {
  await page.route(STREAM_URL, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    const body =
      `0:${JSON.stringify('Thanks — let me help you with that.')}\n` +
      `d:{"finishReason":"stop","usage":{"promptTokens":5,"completionTokens":5}}\n`;
    await route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'x-vercel-ai-data-stream': 'v1',
      },
      body,
    });
  });
}
