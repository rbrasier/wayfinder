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
 * The browser hits POST /api/chat/<sessionId>/stream through the AI SDK 5
 * `useChat` hook, whose transport reads an SSE "UI message stream".
 */

import type { Page } from '@playwright/test';

const STREAM_URL = /\/api\/chat\/[^/]+\/stream(\?.*)?$/;

/** The headers `createUIMessageStreamResponse` sends; useChat checks the marker. */
export const UI_MESSAGE_STREAM_HEADERS = {
  'Content-Type': 'text/event-stream',
  'x-vercel-ai-ui-message-stream': 'v1',
};

/**
 * A UI message stream carrying one assistant bubble, framed exactly as the real
 * route frames it: one `data:` event per chunk, then `[DONE]`.
 */
export function uiMessageStreamBody(textChunks: readonly string[]): string {
  const chunks = [
    { type: 'text-start', id: 'mock-text' },
    ...textChunks.map((delta) => ({ type: 'text-delta', id: 'mock-text', delta })),
    { type: 'text-end', id: 'mock-text' },
  ];
  return chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n';
}

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
 * UI message stream. While the request is pending, `useChat` reports the turn
 * in flight with no assistant message yet, so the assistant typing indicator
 * stays on screen long enough to assert.
 */
export async function delayChatStream(page: Page, delayMs: number): Promise<void> {
  await page.route(STREAM_URL, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    await route.fulfill({
      status: 200,
      headers: UI_MESSAGE_STREAM_HEADERS,
      body: uiMessageStreamBody(['Thanks — let me help you with that.']),
    });
  });
}
