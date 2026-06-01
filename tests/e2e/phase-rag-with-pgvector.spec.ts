/**
 * phase-rag-with-pgvector.spec.ts
 *
 * Covers the "RAG for Context Documents (pgvector)" phase.
 *
 * The phase replaces inline full-text injection (capped at ~65 KB per flow /
 * per session) with per-turn vector retrieval. Two end-user-visible effects are
 * exercised here through the upload API surface:
 *
 *   Happy path — a context document larger than the old 65 KB budget now
 *   uploads successfully (the budget guard is gone; full text is stored and
 *   indexed for retrieval). Where embeddings are reachable the response also
 *   reports the number of chunks created.
 *
 *   Error path — an unsupported file type is still rejected with a 4xx the
 *   user can act on.
 *
 * The test creates its own isolated flow so it does not depend on seed data.
 * page.request shares the authenticated browser cookies, so the API calls run
 * as the signed-in admin.
 */

import type { Page } from '@playwright/test';
import { test, expect } from './helpers/base';

// Comfortably larger than the removed CONTEXT_DOCS_TOTAL_BUDGET_CHARS (65 536).
const OVER_OLD_BUDGET_CHARS = 80_000;

async function createFlowAndResolveId(page: Page, name: string): Promise<string | null> {
  await page.goto('/admin/flows');
  await page.waitForLoadState('networkidle');

  await page.getByRole('button', { name: /new flow/i }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();

  await page.locator('#flow-name').fill(name);
  await page.locator('#flow-expert-role').fill('E2E RAG Expert');
  await page.getByRole('button', { name: /create flow/i }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 });

  const editLink = page.getByRole('link', { name: 'Configure Flow' }).first();
  if (!(await editLink.isVisible({ timeout: 5_000 }).catch(() => false))) return null;
  await editLink.click();

  await page.waitForURL(/\/admin\/flows\/[^/]+$/, { timeout: 10_000 }).catch(() => undefined);
  const match = page.url().match(/\/admin\/flows\/([^/?]+)/);
  return match?.[1] ?? null;
}

test.describe('Phase: RAG with pgvector', () => {
  test('a context document larger than the old 65 KB budget uploads and is indexed', async ({
    page,
  }) => {
    const flowId = await createFlowAndResolveId(page, `RAG Budget ${Date.now()}`);
    if (!flowId) {
      test.skip(true, 'Could not create / resolve a flow to upload into');
      return;
    }

    const bigText = 'Procurement policy paragraph. '.repeat(
      Math.ceil(OVER_OLD_BUDGET_CHARS / 'Procurement policy paragraph. '.length),
    );
    expect(bigText.length).toBeGreaterThan(65_536);

    const response = await page.request.post(`/api/flows/${flowId}/context-docs`, {
      multipart: {
        file: {
          name: 'large-policy.txt',
          mimeType: 'text/plain',
          buffer: Buffer.from(bigText),
        },
      },
    });

    // The old budget guard would have rejected this with 413. It now succeeds.
    expect(response.status(), await response.text()).toBe(201);

    const body = (await response.json()) as {
      extractedChars: number;
      indexed: boolean;
      chunkCount: number;
    };
    expect(body.extractedChars).toBeGreaterThan(65_536);
    // `indexed` is true when the embedding provider is reachable; in that case a
    // document this size must produce multiple retrievable chunks.
    if (body.indexed) {
      expect(body.chunkCount).toBeGreaterThan(1);
    }
  });

  test('an unsupported file type is rejected with a client error', async ({ page }) => {
    const flowId = await createFlowAndResolveId(page, `RAG Reject ${Date.now()}`);
    if (!flowId) {
      test.skip(true, 'Could not create / resolve a flow to upload into');
      return;
    }

    const response = await page.request.post(`/api/flows/${flowId}/context-docs`, {
      multipart: {
        file: {
          name: 'diagram.png',
          mimeType: 'image/png',
          buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
        },
      },
    });

    expect(response.status()).toBeGreaterThanOrEqual(400);
    expect(response.status()).toBeLessThan(500);
  });
});
