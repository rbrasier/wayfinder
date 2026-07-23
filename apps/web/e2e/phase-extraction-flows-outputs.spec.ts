/**
 * phase-extraction-flows-outputs.spec.ts
 *
 * Phase: Extraction Flows 3 — Outputs, Results Viewer + Analytics (ADR-033 §5-9).
 *
 * Exercises the externally observable surface of the outputs/viewer/analytics
 * slice: the new run-scoped tRPC procedures (getResults, listRuns, export,
 * generateDocuments, editResult, markComplete, runReport, summaryMarkdown) and
 * the two run-artifact REST download endpoints. The whole surface is gated by the
 * extraction_flows flag and the extraction:run permission plus per-run ownership,
 * so every case is skip-guarded and asserts a handled response — never a 500.
 *
 * Happy path: the run-history and run screens are reachable (or cleanly gated).
 * Error path: every outputs procedure and every run-artifact endpoint answers a
 * handled 4xx for an unknown/unauthorised run — ownership is enforced server-side.
 */

import type { Page } from '@playwright/test';
import { test, expect } from './helpers/base';

const UNKNOWN_UUID = '00000000-0000-0000-0000-000000000000';
const atLogin = (url: string): boolean => url.includes('/login');
const bodyText = (body: unknown): string => JSON.stringify(body ?? {});

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

async function trpcQuery(
  page: Page,
  procedure: string,
  input: Record<string, unknown>,
): Promise<number> {
  const response = await page.request.get(
    `/api/trpc/${procedure}?batch=1&input=${encodeURIComponent(
      JSON.stringify({ '0': { json: input } }),
    )}`,
  );
  return response.status();
}

const handled4xx = (status: number): void => {
  expect(status).toBeGreaterThanOrEqual(400);
  expect(status).toBeLessThan(500);
};

test.describe('Synthesise Information — outputs, viewer & analytics', () => {
  test('the run-history screen is reachable or cleanly gated', async ({ page }) => {
    await page.goto(`/synthesise/${UNKNOWN_UUID}/runs`);
    if (atLogin(page.url())) {
      test.skip(true, 'No authenticated session available');
      return;
    }
    await page.waitForLoadState('networkidle');
    // Either the Runs heading (enabled) or a gated/empty message renders — never
    // an unhandled error page.
    const runsHeading = page.getByRole('heading', { name: /^Runs$/ });
    const gated = page.getByText(/not (available|enabled)|not yet run|cannot/i).first();
    await expect(runsHeading.or(gated).first()).toBeVisible();
  });

  test('outputs mutations reject an unknown run with a handled 4xx, never a 500', async ({ page }) => {
    await page.goto('/synthesise');
    if (atLogin(page.url())) {
      test.skip(true, 'No authenticated session available');
      return;
    }

    for (const procedure of [
      'extraction.export',
      'extraction.generateDocuments',
      'extraction.markComplete',
    ]) {
      const result = await trpcMutate(page, procedure, { runId: UNKNOWN_UUID });
      handled4xx(result.status);
      expect(bodyText(result.body).toLowerCase()).not.toContain('internal server error');
    }

    const edit = await trpcMutate(page, 'extraction.editResult', {
      runId: UNKNOWN_UUID,
      recordId: UNKNOWN_UUID,
      fieldKey: 'supplier',
      newValue: 'Acme Ltd',
    });
    handled4xx(edit.status);
  });

  test('outputs queries reject an unknown run with a handled 4xx, never a 500', async ({ page }) => {
    await page.goto('/synthesise');
    if (atLogin(page.url())) {
      test.skip(true, 'No authenticated session available');
      return;
    }

    for (const procedure of [
      'extraction.getResults',
      'extraction.runReport',
      'extraction.summaryMarkdown',
    ]) {
      handled4xx(await trpcQuery(page, procedure, { runId: UNKNOWN_UUID }));
    }
    // listRuns is keyed by flow id.
    handled4xx(await trpcQuery(page, 'extraction.listRuns', { flowId: UNKNOWN_UUID }));
  });

  test('run-artifact REST endpoints enforce ownership without crashing', async ({ page }) => {
    // No ownership can resolve for a random run/document id, so every artifact
    // endpoint must answer a handled status (401/403/404/410) — never a 500.
    for (const artifact of ['document', 'summary', 'summary-doc', 'export-xlsx', 'export-json']) {
      const response = await page.request.get(
        `/api/synthesise/runs/${UNKNOWN_UUID}/artifacts/${artifact}`,
      );
      expect(response.status()).toBeLessThan(500);
      expect(response.status()).toBeGreaterThanOrEqual(400);
    }

    const sourceDoc = await page.request.get(`/api/synthesise/documents/${UNKNOWN_UUID}`);
    expect(sourceDoc.status()).toBeLessThan(500);
    expect(sourceDoc.status()).toBeGreaterThanOrEqual(400);
  });
});
