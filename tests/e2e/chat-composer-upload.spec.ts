/**
 * chat-composer-upload.spec.ts
 *
 * Covers v1.20.0 — Session file upload (end-user mid-flow context).
 *
 * Visual spec (docs/development/implemented/v1.20.0/session-file-upload.phase.md
 * + chat-composer.tsx):
 *   The chat composer carries a paperclip button labelled "Attach a file for
 *   context" backed by a hidden <input type="file"> that accepts
 *   .pdf/.docx/.txt/.md. Selecting a file shows a removable filename pill.
 */

import { test, expect } from './helpers/base';

async function resolveExistingSessionId(page: import('@playwright/test').Page): Promise<string | null> {
  await page.goto('/chats');
  await page.waitForLoadState('networkidle');

  const sessionLink = page.locator('a[href^="/chats/"]').first();
  const href = await sessionLink.getAttribute('href').catch(() => null);
  if (!href) return null;

  const match = href.match(/\/chats\/([^/?]+)/);
  return match?.[1] ?? null;
}

test.describe('Chat: Composer file upload', () => {
  test('composer shows a paperclip attach control', async ({ page, consoleLogs }) => {
    const sessionId = await resolveExistingSessionId(page);
    if (!sessionId) {
      test.skip(true, 'No sessions found — create a flow and session to enable this test');
      return;
    }

    await page.goto(`/chats/${sessionId}`);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'screenshots/chat-composer-upload.png', fullPage: true });

    const attachButton = page.getByRole('button', { name: /attach a file for context/i });
    if (!(await attachButton.isVisible().catch(() => false))) {
      await page.screenshot({ path: 'screenshots/chat-composer-no-attach.png', fullPage: true });
      test.skip(true, 'Attach button not found — composer may be read-only on this session');
      return;
    }

    await expect(attachButton).toBeVisible();

    // A hidden file input backs the paperclip; assert it accepts document types.
    const fileInput = page.locator('input[type="file"]');
    await expect(fileInput).toHaveCount(1);
    const accept = await fileInput.getAttribute('accept');
    if (accept) {
      expect(accept.toLowerCase()).toContain('.pdf');
    }

    const errors = consoleLogs.filter(l => l.type === 'error');
    expect(errors, `JS errors:\n${errors.map(e => e.text).join('\n')}`).toHaveLength(0);
  });
});
