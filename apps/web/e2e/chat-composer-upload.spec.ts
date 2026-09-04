/**
 * chat-composer-upload.spec.ts
 *
 * Covers v1.20.0 — Session file upload (end-user mid-flow context).
 *
 * Visual spec (docs/development/implemented/alpha-1/v1.20.0/session-file-upload.phase.md
 * + chat-composer.tsx):
 *   The chat composer carries a paperclip button labelled "Attach a file for
 *   context" backed by a hidden <input type="file"> that accepts
 *   .pdf/.docx/.txt/.md. Selecting a file shows a removable filename pill.
 */

import { test, expect } from './helpers/base';
import { requireSeedFixtures } from './helpers/seed';

test.describe('Chat: Composer file upload', () => {
  test('composer shows a paperclip attach control', async ({ page, consoleLogs }) => {
    const { sessionId } = requireSeedFixtures();

    await page.goto(`/chats/${sessionId}`);
    // A session page holds an open SSE stream, so the network is never idle and
    // waitForLoadState('networkidle') can only burn the timeout (see
    // docs/development/e2e-triage-handover.md §4). Wait for the composer, which is
    // what "the session page is ready" actually means.
    await expect(page.locator('textarea[placeholder*="Wayfinder"]')).toBeVisible();
    await page.screenshot({ path: 'screenshots/chat-composer-upload.png', fullPage: true });

    const attachButton = page.getByRole('button', { name: /attach a file for context/i });
    await expect(attachButton).toBeVisible();

    // A hidden file input backs the paperclip. Its `accept` carries MIME
    // types (SESSION_UPLOADS_ALLOWED_MIME_TYPES), not extensions.
    const fileInput = page.locator('input[type="file"]');
    await expect(fileInput).toHaveCount(1);
    const accept = await fileInput.getAttribute('accept');
    if (accept) {
      expect(accept).toContain('application/pdf');
      expect(accept).toContain('text/plain');
    }

    const errors = consoleLogs.filter(l => l.type === 'error');
    expect(errors, `JS errors:\n${errors.map(e => e.text).join('\n')}`).toHaveLength(0);
  });

  test('selecting a file shows a removable filename pill', async ({ page }) => {
    const { sessionId } = requireSeedFixtures();

    // Mock the upload endpoints so the test is deterministic and independent of
    // MinIO / extraction infra. The composer POSTs FormData to this route and
    // renders a pill from the returned { id, filename }.
    await page.route(/\/api\/chat\/[^/]+\/uploads$/, async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 201,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: 'mock-upload-1', filename: 'context-notes.txt' }),
        });
        return;
      }
      // GET (initial list of existing uploads) → empty.
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([]),
      });
    });

    await page.goto(`/chats/${sessionId}`);
    await expect(page.locator('textarea[placeholder*="Wayfinder"]')).toBeVisible();

    const attachButton = page.getByRole('button', { name: /attach a file for context/i });
    await expect(attachButton).toBeVisible();

    await page.locator('input[type="file"]').setInputFiles({
      name: 'context-notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Some background context for the AI to use.'),
    });

    // Use .first() because the outer pill <span> and the inner text <span> both
    // contain this string — strict mode requires a single-element locator.
    await expect(page.getByText('context-notes.txt').first()).toBeVisible();
    await expect(page.getByRole('button', { name: /remove context-notes\.txt/i })).toBeVisible();
    await page.screenshot({ path: 'screenshots/chat-composer-upload-pill.png', fullPage: true });
  });
});
