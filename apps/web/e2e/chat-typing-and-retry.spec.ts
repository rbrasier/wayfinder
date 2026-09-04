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
import { requireSeedFixtures } from './helpers/seed';

async function openSessionWithComposer(
  page: import('@playwright/test').Page,
): Promise<import('@playwright/test').Locator> {
  // Scraping the first link out of /chats used to be the fallback here. It
  // picked whichever session the run happened to have created by then, so the
  // composer it returned was not always the seeded one. The seed is a declared
  // dependency of this project, so the composer must render — a missing one is
  // a failure to surface, not a reason to skip.
  const { sessionId } = requireSeedFixtures();

  await page.goto(`/chats/${sessionId}`);
  // A session page holds an open SSE stream, so the network is never idle and
  // waitForLoadState('networkidle') can only burn the timeout (see
  // docs/development/e2e-triage-handover.md §4). Wait for the composer, which is
  // what "the session page is ready" actually means.
  await expect(page.locator('textarea[placeholder*="Wayfinder"]')).toBeVisible();

  const composer = page.getByRole('textbox').first();
  await expect(composer).toBeVisible();
  return composer;
}

test.describe('Chat: Typing indicator', () => {
  test('assistant typing dots appear while a reply is pending', async ({ page }) => {
    // Register the delayed stream BEFORE sending so it wins over the base mock.
    await delayChatStream(page, 3000);

    const composer = await openSessionWithComposer(page);

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

    await composer.fill('This will fail');
    await composer.press('Enter');

    await expect(page.getByText(/the assistant couldn't reply/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: /retry/i })).toBeVisible();
    await page.screenshot({ path: 'screenshots/chat-retry-control.png', fullPage: true });
  });
});
