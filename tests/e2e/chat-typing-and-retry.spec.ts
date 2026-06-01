/**
 * chat-typing-and-retry.spec.ts
 *
 * Covers:
 *   v1.8.1 — Chat typing indicator (three staggered-pulse dots shown as an
 *            assistant bubble while the AI is preparing its reply).
 *   v1.7.5 — On AI failure the user's message is kept and a Retry control
 *            appears next to "The assistant couldn't reply — please try again."
 *
 * Both use per-test stream overrides (helpers/chat-mock.ts):
 *   - delayChatStream → holds the response so the typing indicator is visible.
 *   - failChatStream  → returns 500 so the Retry UI renders.
 *
 * Render conditions verified against components/chat/message-feed.tsx:
 *   typing dots: `isStreaming && last streaming message role !== 'assistant'`
 *   retry block: `error && !isStreaming`
 */

import { test, expect } from './helpers/base';
import { delayChatStream, failChatStream } from './helpers/chat-mock';

async function openSessionWithComposer(
  page: import('@playwright/test').Page,
): Promise<import('@playwright/test').Locator | null> {
  await page.goto('/chats');
  await page.waitForLoadState('networkidle');

  const sessionLink = page.locator('a[href^="/chats/"]').first();
  const href = await sessionLink.getAttribute('href').catch(() => null);
  if (!href) return null;

  const sessionId = href.match(/\/chats\/([^/?]+)/)?.[1];
  if (!sessionId) return null;

  await page.goto(`/chats/${sessionId}`);
  await page.waitForLoadState('networkidle');

  const composer = page.getByRole('textbox').first();
  if (!(await composer.isVisible().catch(() => false))) return null;
  return composer;
}

test.describe('Chat: Typing indicator', () => {
  test('assistant typing dots appear while a reply is pending', async ({ page }) => {
    // Register the delayed stream BEFORE sending so it wins over the base mock.
    await delayChatStream(page, 3000);

    const composer = await openSessionWithComposer(page);
    if (!composer) {
      test.skip(true, 'No active session with a usable composer found');
      return;
    }

    await composer.fill('Hello there');
    await composer.press('Enter');

    // The TypingIndicator renders three `animate-pulse rounded-full` dots in a
    // white assistant bubble while the (delayed) response is in flight.
    const dots = page.locator('span.animate-pulse.rounded-full');
    await expect(dots.first()).toBeVisible({ timeout: 2500 });
    await page.screenshot({ path: 'screenshots/chat-typing-indicator.png', fullPage: true });
    expect(await dots.count()).toBeGreaterThanOrEqual(3);
  });
});

test.describe('Chat: Retry on failure', () => {
  test('failed AI reply shows the retry control', async ({ page }) => {
    await failChatStream(page);

    const composer = await openSessionWithComposer(page);
    if (!composer) {
      test.skip(true, 'No active session with a usable composer found');
      return;
    }

    await composer.fill('This will fail');
    await composer.press('Enter');

    await expect(page.getByText(/the assistant couldn't reply/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: /retry/i })).toBeVisible();
    await page.screenshot({ path: 'screenshots/chat-retry-control.png', fullPage: true });
  });
});
