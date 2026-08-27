/**
 * enhance-synthesise-summary.spec.ts
 *
 * Enhancement: Summary of outputs enhancements (v2.16.2), extended for CSV
 * export (v0.32.0).
 *
 * Covers the reworked run screen — the header bar, one-click Excel download, the
 * overflow menu holding JSON, CSV and document generation, the flat
 * one-row-per-record table with its RAG indicators, and the expandable detail
 * row carrying the source files that used to live in a left sidebar.
 *
 * It reaches that screen through the seeded extraction run rather than by
 * authoring a synthesis and running a sample. The preamble used to do the
 * latter, and carried four `test.skip()` guards on conditions it probed itself —
 * no session, flag off, no staged documents, no records — three of them reached
 * through `isVisible().catch(() => false)`. Both patterns are non-negotiable
 * under docs/guides/e2e-test-policy.md, and a CSV case appended to them could
 * report green having downloaded nothing. The seed now builds the run
 * (`seedExtractionRun`) and enables the `extraction_flows` flag, so every guard
 * is gone and a missing fixture fails loudly instead of skipping.
 */

import { test, expect } from './helpers/base';
import { requireSeedFixtures } from './helpers/seed';

// CI serves the app from `next dev`, which compiles a route the first time it is
// visited. The run screen is heavy, so allow the full navigation timeout.
const ROUTE_COMPILE_TIMEOUT = 30_000;

// Lands on the seeded run's screen, ready to drive. No skip guards: the seed
// project is a declared dependency of this one, so the fixtures are either there
// or the run has a real failure to report.
const openRunScreen = async (page: import('@playwright/test').Page): Promise<void> => {
  const { extractionFlowId, extractionRunId } = requireSeedFixtures();

  await page.goto(`/synthesise/${extractionFlowId}/runs/${extractionRunId}`);
  await expect(page.getByRole('heading', { name: /Summary of outputs/i })).toBeVisible({
    timeout: ROUTE_COMPILE_TIMEOUT,
  });
};

test.describe('Synthesise Information — summary of outputs', () => {
  test('header offers a one-click Excel download and an overflow menu for JSON, CSV and documents', async ({
    page,
  }) => {
    await openRunScreen(page);

    // The screen has the standard header bar: back affordance + title, and the
    // run's actions on the right rather than in a button row in the body.
    await expect(page.getByRole('link', { name: /Back to edit the flow/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Summary of outputs/i })).toBeVisible();

    // Download Excel is a single action — no reveal-then-click intermediate step.
    const downloadExcel = page.getByRole('button', { name: /^Download Excel$/ });
    await expect(downloadExcel).toBeVisible();
    await expect(page.getByRole('button', { name: /^Download data$/ })).toHaveCount(0);

    const download = await Promise.all([
      page.waitForEvent('download', { timeout: ROUTE_COMPILE_TIMEOUT }),
      downloadExcel.click(),
    ]).then(([event]) => event);
    expect(download.suggestedFilename()).toMatch(/\.xlsx$/);

    // JSON, CSV and document generation live in the overflow menu, CSV directly
    // beneath JSON.
    await page.getByRole('button', { name: /Run actions/i }).click();
    await expect(page.getByRole('button', { name: /^Download JSON$/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Download CSV$/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Generate documents$/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /^All runs$/ })).toBeVisible();

    // Escape closes it, like the editor's menu.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: /^Download JSON$/ })).toBeHidden();
  });

  // Group 3 (file upload and download): the bytes being right in object storage
  // and the browser receiving them as a CSV file are genuinely different facts.
  test('the overflow menu downloads the run as CSV', async ({ page }) => {
    await openRunScreen(page);

    await page.getByRole('button', { name: /Run actions/i }).click();
    const downloadCsv = page.getByRole('button', { name: /^Download CSV$/ });
    await expect(downloadCsv).toBeVisible();

    const download = await Promise.all([
      page.waitForEvent('download', { timeout: ROUTE_COMPILE_TIMEOUT }),
      downloadCsv.click(),
    ]).then(([event]) => event);

    expect(download.suggestedFilename()).toMatch(/\.csv$/);

    // A CSV whose bytes are correct in storage but mis-served — truncated, or
    // sent as the XLSX it was exported beside — is a browser-only failure, so
    // read the stream rather than trusting the filename.
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString('utf8');

    expect(body.startsWith('Record,Supplier,Address')).toBe(true);
    // The seeded values carry a comma, an embedded quote and a line break —
    // quoted per RFC 4180 on the way out, and still intact on the way back.
    expect(body).toContain('"Acme, Ltd"');
    expect(body).toContain('"12 High Street, ""the old mill"""');
    expect(body).toContain('"40 Long Road\nSecond line"');
  });

  test('an export failure surfaces an error rather than downloading an empty file', async ({
    page,
  }) => {
    await openRunScreen(page);

    // Fail the export itself, not the artifact fetch: the artifact is only
    // reached once the export reports success, so this is the path an operator
    // hits when storage or the writer is unavailable. A plain 500 rather than a
    // hand-built tRPC error envelope — the client's own error formatting is not
    // what this asserts, and a malformed envelope would test that instead.
    await page.route(/\/api\/trpc\/extraction\.export/, (route) =>
      route.fulfill({ status: 500, contentType: 'text/plain', body: 'mock export failure' }),
    );

    let downloadStarted = false;
    page.on('download', () => {
      downloadStarted = true;
    });

    await page.getByRole('button', { name: /Run actions/i }).click();
    await page.getByRole('button', { name: /^Download CSV$/ }).click();

    // The operator is told, rather than handed a file that never arrived.
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(1, { timeout: 10_000 });
    expect(downloadStarted).toBe(false);

    // And the menu recovers rather than staying stuck on "Preparing…".
    await page.getByRole('button', { name: /Run actions/i }).click();
    const csvItem = page.getByRole('button', { name: /^Download CSV$/ });
    await expect(csvItem).toBeVisible();
    await expect(csvItem).toBeEnabled();
  });

  test('results are one row per record, expanding to reveal source files', async ({ page }) => {
    await openRunScreen(page);

    const table = page.getByTestId('results-table');
    await expect(table).toBeVisible({ timeout: ROUTE_COMPILE_TIMEOUT });

    // The left "Included files" sidebar is gone — provenance lives in the row.
    await expect(page.getByText('Included files')).toHaveCount(0);

    // The seed creates two records, so the count is asserted rather than probed.
    const rows = page.getByTestId('result-row');
    await expect(rows).toHaveCount(2);

    // Each value carries a RAG indicator that opens the rationale behind it.
    const confidenceDot = rows
      .first()
      .getByRole('button', { name: /confidence.*Show rationale/i })
      .first();
    await expect(confidenceDot).toBeVisible();
    await confidenceDot.click();
    const rationaleDialog = page.getByRole('dialog').filter({ hasText: /Confidence rationale/i });
    await expect(rationaleDialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(rationaleDialog).toBeHidden();

    // Expanding a row reveals its detail: source files and the paired field grid.
    const expandToggle = page.getByTestId('expand-record').first();
    await expect(expandToggle).toHaveAttribute('aria-expanded', 'false');
    await expandToggle.click();
    await expect(expandToggle).toHaveAttribute('aria-expanded', 'true');

    const detail = page.getByTestId('result-row-detail').first();
    await expect(detail).toBeVisible();
    await expect(detail.getByText('Source files')).toBeVisible();
    await expect(detail.getByText('Extracted fields')).toBeVisible();

    // And collapses again.
    await expandToggle.click();
    await expect(page.getByTestId('result-row-detail')).toHaveCount(0);
  });
});
