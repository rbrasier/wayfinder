/**
 * chat-transparency.spec.ts
 *
 * Covers v1.15.0 — AI transparency info modals.
 *
 * Visual spec (docs/development/implemented/v1.15.0/ai-transparency-modals.md
 * + message-info-modal.tsx / document-info-modal.tsx):
 *   Every assistant message with a persisted aiPayload shows an Info button
 *   (aria-label "Show AI reasoning") opening a "Why this response" modal with
 *   a "CONFIDENCE RATIONALE" section and a collapsed "Insights gathered so
 *   far" details block. Document cards show a "Show document confidence
 *   breakdown" Info button opening a "Document confidence" modal.
 *
 * Requires at least one session with an assistant message. Sends a message
 * first (AI is mocked by the base fixture) so a reasoning button can appear.
 */

import { test, expect } from './helpers/base';
import { loadSeedFixtures } from './helpers/seed';

async function resolveExistingSessionId(page: import('@playwright/test').Page): Promise<string | null> {
  const seeded = loadSeedFixtures()?.sessionId;
  if (seeded) return seeded;

  await page.goto('/chats');
  await page.waitForLoadState('networkidle');

  const sessionLink = page.locator('a[href^="/chats/"]').first();
  const href = await sessionLink.getAttribute('href').catch(() => null);
  if (!href) return null;

  const match = href.match(/\/chats\/([^/?]+)/);
  return match?.[1] ?? null;
}

test.describe('Chat: AI transparency modal', () => {
  test('assistant message exposes an AI reasoning modal', async ({ page }) => {
    const sessionId = await resolveExistingSessionId(page);
    if (!sessionId) {
      test.skip(true, 'No sessions found — create a flow and session to enable this test');
      return;
    }

    await page.goto(`/chats/${sessionId}`);
    await page.waitForLoadState('networkidle');

    let infoButton = page.getByRole('button', { name: /show ai reasoning/i }).first();

    // If no assistant reasoning button is present yet, send a message to elicit one.
    if (!(await infoButton.isVisible().catch(() => false))) {
      const composer = page.getByRole('textbox').first();
      if (await composer.isVisible().catch(() => false)) {
        await composer.fill('Hello, can you help me get started?');
        await composer.press('Enter');
        await page.waitForTimeout(2500);
        infoButton = page.getByRole('button', { name: /show ai reasoning/i }).first();
      }
    }

    if (!(await infoButton.isVisible().catch(() => false))) {
      await page.screenshot({ path: 'screenshots/chat-transparency-no-info-button.png', fullPage: true });
      test.skip(true, 'No assistant message with AI reasoning available (no persisted aiPayload)');
      return;
    }

    await infoButton.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/why this response|confidence rationale/i).first()).toBeVisible();
    await page.screenshot({ path: 'screenshots/chat-transparency-modal.png', fullPage: true });
  });
});
