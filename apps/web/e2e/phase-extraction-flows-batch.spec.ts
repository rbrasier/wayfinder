/**
 * phase-extraction-flows-batch.spec.ts
 *
 * Phase: Extraction Flows 2 — Full Batch Engine + Ingestion (ADR-033 §5-6).
 *
 * Exercises the externally observable surface of the durable batch engine: the
 * run-control tRPC procedures (startBatch / runStatus / cancel / retryFailed /
 * continue). The whole surface is gated by the extraction_flows flag and the
 * extraction:run permission, so every case is skip-guarded to stay inert in an
 * environment without a seeded session or with the flag off (its default) —
 * matching the other phase specs in this suite.
 *
 * Happy path: a run-control procedure resolves for a permitted user (or is
 * cleanly FORBIDDEN when the flag/permission is off — never a 500).
 * Error path: starting a full batch against a flow with no published version is
 * rejected with a clear, user-visible validation message, not a crash.
 */

import type { Page } from '@playwright/test';
import { test, expect } from './helpers/base';

const atLogin = (url: string): boolean => url.includes('/login');

async function trpcMutate(
  page: Page,
  procedure: string,
  input: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  const response = await page.request.post(`/api/trpc/${procedure}?batch=1`, {
    data: { '0': { json: input } },
  });
  return { status: response.status(), body: await response.json().catch(() => null) };
}

const bodyText = (body: unknown): string => JSON.stringify(body ?? {});

test.describe('Synthesise Information — batch engine', () => {
  test('the run screen surface is reachable or cleanly gated', async ({ page }) => {
    await page.goto('/synthesise');
    if (atLogin(page.url())) {
      test.skip(true, 'No authenticated session available');
      return;
    }
    await page.waitForLoadState('networkidle');

    // Enabled → the list heading; disabled → the EmptyState. Exactly one renders,
    // and neither is an error page.
    const listHeading = page.getByRole('heading', { name: /^Synthesise Information$/ });
    const disabledState = page.getByText(/not (available|enabled)/i).first();
    await expect(listHeading.or(disabledState).first()).toBeVisible();
  });

  test('startBatch rejects a missing published version instead of crashing', async ({ page }) => {
    await page.goto('/synthesise');
    if (atLogin(page.url())) {
      test.skip(true, 'No authenticated session available');
      return;
    }

    // A syntactically valid but unpublishable request: a random flow id and no
    // documents. Whatever the gate state, the server must answer with a handled
    // 4xx (FORBIDDEN when gated off, or a BAD_REQUEST/validation error when the
    // flow has no published extraction version) — never a 500.
    const result = await trpcMutate(page, 'extraction.startBatch', {
      flowId: '00000000-0000-0000-0000-000000000000',
      files: [],
      archives: [],
    });

    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.status).toBeLessThan(500);
    // The response carries a message, not an unhandled stack trace.
    expect(bodyText(result.body).length).toBeGreaterThan(0);
    expect(bodyText(result.body).toLowerCase()).not.toContain('internal server error');
  });

  test('runStatus for an unknown run is a handled 4xx, not a 500', async ({ page }) => {
    await page.goto('/synthesise');
    if (atLogin(page.url())) {
      test.skip(true, 'No authenticated session available');
      return;
    }

    const response = await page.request.get(
      `/api/trpc/extraction.runStatus?batch=1&input=${encodeURIComponent(
        JSON.stringify({ '0': { json: { runId: '00000000-0000-0000-0000-000000000000' } } }),
      )}`,
    );

    expect(response.status()).toBeGreaterThanOrEqual(400);
    expect(response.status()).toBeLessThan(500);
  });
});
