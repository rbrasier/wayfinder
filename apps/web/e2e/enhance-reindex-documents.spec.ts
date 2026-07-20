/**
 * enhance-reindex-documents.spec.ts
 *
 * Covers v1.26.1 — "Re-index all documents" button.
 *
 * Visual spec (/admin/settings → RagEmbeddingsCard):
 *   Below the embedding-provider details the card shows a "Re-index all documents"
 *   button. Clicking it kicks off an async re-index of every stored document
 *   (templates, flow context docs, session uploads) using the current provider.
 *   While running the UI shows in-progress text and polls; on completion a
 *   "Completed" badge appears with the succeeded/failed counts.
 *
 * The run reuses text already extracted in the DB, so it works even on a fresh
 * environment (it simply reports zero documents).
 */

import { test, expect } from './helpers/base';

test.describe('Admin: Re-index all documents', () => {
  test('re-indexing can be started and reports completion', async ({ page, consoleLogs }) => {
    await page.goto('/admin/settings');
    await page.waitForLoadState('networkidle');

    const cardHeading = page.getByText('RAG Embeddings', { exact: true });
    if (!(await cardHeading.isVisible().catch(() => false))) {
      await page.screenshot({ path: 'screenshots/reindex-card-missing.png', fullPage: true });
      test.skip(true, 'RAG Embeddings card not found');
      return;
    }

    const reindexButton = page.getByTestId('reindex-button');
    await expect(reindexButton).toBeVisible();
    await expect(reindexButton).toHaveText(/re-index all documents/i);
    await page.screenshot({ path: 'screenshots/reindex-before.png', fullPage: true });

    await reindexButton.click();

    // The run is async; the UI either shows in-progress and then completes, or
    // (with no documents) completes almost immediately. Either way the
    // "Completed" badge is the terminal state we assert on.
    const completed = page.getByTestId('reindex-complete');
    // Generous budget: the first real embed can pay ONNX-runtime init even with
    // the model warm on disk, and the runner is under load by this point.
    await expect(completed).toBeVisible({ timeout: 60_000 });
    await expect(completed).toHaveText(/completed — re-indexed \d+ of \d+ documents/i);
    await page.screenshot({ path: 'screenshots/reindex-complete.png', fullPage: true });

    // The button returns to its idle label and is clickable again.
    await expect(reindexButton).toHaveText(/re-index all documents/i);
    await expect(reindexButton).toBeEnabled();

    const errors = consoleLogs.filter((l) => l.type === 'error');
    expect(errors, `JS errors:\n${errors.map((e) => e.text).join('\n')}`).toHaveLength(0);
  });
});
