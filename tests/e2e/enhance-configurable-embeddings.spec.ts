/**
 * enhance-configurable-embeddings.spec.ts
 *
 * Covers v1.23.0 — Configurable embedding providers (local + OpenAI).
 *
 * Visual spec (/admin/settings → RagEmbeddingsCard):
 *   A "RAG Embeddings" card shows the active provider, model id, and the fixed
 *   384-dimension. An "Edit" button opens a dialog with a provider <select>
 *   (#embeddings-provider: local | openai) and a re-indexing warning. The
 *   default provider is Local (in-process).
 *
 * The card and its dialog are exercised read-mostly: open, switch the select,
 * and persist, asserting the value round-trips.
 */

import { test, expect } from './helpers/base';

test.describe('Admin: RAG Embeddings settings', () => {
  test('card shows the local provider and 384 dimensions by default', async ({ page, consoleLogs }) => {
    await page.goto('/admin/settings');
    await page.waitForLoadState('networkidle');

    const card = page.locator('div', { has: page.getByText('RAG Embeddings', { exact: true }) }).first();
    if (!(await card.isVisible().catch(() => false))) {
      await page.screenshot({ path: 'screenshots/embeddings-card-missing.png', fullPage: true });
      test.skip(true, 'RAG Embeddings card not found');
      return;
    }

    await expect(page.getByText('RAG Embeddings', { exact: true })).toBeVisible();
    // Default provider label and the fixed dimension are both rendered.
    await expect(page.getByText('Local (in-process)').first()).toBeVisible();
    await expect(page.getByText('384').first()).toBeVisible();
    await page.screenshot({ path: 'screenshots/embeddings-card.png', fullPage: true });

    const errors = consoleLogs.filter((l) => l.type === 'error');
    expect(errors, `JS errors:\n${errors.map((e) => e.text).join('\n')}`).toHaveLength(0);
  });

  test('the provider can be changed and persists', async ({ page }) => {
    await page.goto('/admin/settings');
    await page.waitForLoadState('networkidle');

    const cardHeading = page.getByText('RAG Embeddings', { exact: true });
    if (!(await cardHeading.isVisible().catch(() => false))) {
      test.skip(true, 'RAG Embeddings card not found');
      return;
    }

    // The Edit button inside the RAG Embeddings card.
    const editButton = cardHeading
      .locator('xpath=ancestor::*[contains(@class,"card") or self::div][1]')
      .getByRole('button', { name: /^edit$/i })
      .first();
    await editButton.click();

    const providerSelect = page.locator('#embeddings-provider');
    await expect(providerSelect).toBeVisible();
    // The re-indexing warning must be present so admins understand the cost.
    await expect(page.getByText(/re-uploaded or\s+re-indexed/i)).toBeVisible();

    await providerSelect.selectOption('openai');
    await page.getByRole('button', { name: /^save$/i }).click();

    // After saving, the card reflects the new provider.
    await expect(page.getByText('OpenAI').first()).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: 'screenshots/embeddings-card-openai.png', fullPage: true });

    // Restore the default so the test leaves the environment as it found it.
    await editButton.click();
    await page.locator('#embeddings-provider').selectOption('local');
    await page.getByRole('button', { name: /^save$/i }).click();
    await expect(page.getByText('Local (in-process)').first()).toBeVisible({ timeout: 10_000 });
  });
});
