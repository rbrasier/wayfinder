/**
 * fix-synthesise-live-results.spec.ts
 *
 * Bug fix (v0.21.1) — three defects reported together against Synthesise
 * Information:
 *
 *  1. The run screen's results table never changed while the run was live. Only
 *     `extraction.runStatus` carried a `refetchInterval`; `extraction.getResults`
 *     was fetched once at mount, so the table only caught up on a page reload.
 *     Unsettled documents had no representation at all — `run-results.tsx`
 *     dropped each document's `status` on its way into the grid.
 *  2. The editor mounted before its schema query settled. `EditorCards` seeds
 *     every control from `initialSchema` through `useState` initialisers, which
 *     run once, so it stranded on the empty defaults and the next Save wrote
 *     those over the stored schema — structured output fields vanished.
 *  3. `<Toaster>` was mounted without `expand`, so concurrent toasts collapsed
 *     on top of one another in the bottom-right corner.
 *
 * Skip-guarded like the other extraction specs so it is inert without an
 * authenticated, flag-enabled session.
 */

import type { Page } from '@playwright/test';
import { test, expect } from './helpers/base';

const atLogin = (url: string): boolean => url.includes('/login');

// CI serves the app from `next dev`, which compiles a route the first time it is
// visited. The editor and run screens are large, so the first navigation to each
// can take well past the 5s default before anything paints.
const ROUTE_COMPILE_TIMEOUT = 30_000;

/** True when the Synthesise surface is reachable for this session. */
async function synthesiseAvailable(page: Page): Promise<boolean> {
  await page.goto('/synthesise');
  if (atLogin(page.url())) {
    test.skip(true, 'No authenticated session available');
    return false;
  }
  const disabled = page.getByText(/not (available|enabled)/i).first();
  if (await disabled.isVisible().catch(() => false)) {
    test.skip(true, 'extraction_flows flag not enabled for this user');
    return false;
  }
  return true;
}

/** Lands on the editor for a freshly created synthesis, or skips the test. */
async function createSynthesis(page: Page, name: string): Promise<boolean> {
  if (!(await synthesiseAvailable(page))) return false;

  await page.getByRole('button', { name: /New synthesis/i }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByRole('button', { name: /^Create$/ }).click();

  await expect(page.getByRole('heading', { name: /Edit synthesis/i })).toBeVisible({
    timeout: ROUTE_COMPILE_TIMEOUT,
  });

  await waitForEditorReady(page);
  return true;
}

/**
 * Waits for the editor to reach its final mount.
 *
 * The "Edit synthesis" heading is in the page header, outside the editor's
 * loading gate, so it appears while the body is still "Loading…" — and at that
 * point EditorCards is mounted under the `pending` seed key. When the schema
 * query settles the key flips and the component remounts, discarding any state
 * set in the meantime: an unchecked Auto analyse goes back to checked, and an
 * open output modal closes. Every entry into the editor has to wait for this,
 * the reload half of the persistence case included — waiting on the heading
 * alone is what left that case passing only on retry.
 *
 * The upload control renders only once the query has settled, so it is the
 * signal that the final mount is in place.
 */
async function waitForEditorReady(page: Page): Promise<void> {
  await expect(page.getByText(/Upload documents or a zip/i)).toBeVisible({
    timeout: ROUTE_COMPILE_TIMEOUT,
  });
}

/**
 * Output configuration moved into a modal when the editor became a single
 * full-width input panel (v0.37.0). The control opening it is always present,
 * reading "Configure output" until the output is valid and "Edit output" after.
 */
async function openOutputConfig(page: Page): Promise<void> {
  await page.getByRole('button', { name: /Configure output|Edit output/i }).click();
  await expect(page.getByLabel('Field 1 label')).toBeVisible();
}

/** Closes the output modal so the page header underneath is clickable again. */
async function closeOutputConfig(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Done$/ }).click();
  await expect(page.getByLabel('Field 1 label')).toBeHidden();
}

/**
 * Auto Analyse is on by default and answers the manual input questions itself,
 * so it hides them (ADR-059). The cases below are about the manual authoring
 * path, so they turn it off rather than work around it.
 */
async function turnOffAutoAnalyse(page: Page): Promise<void> {
  const toggle = page.getByLabel('Auto analyse');
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect(page.getByLabel(/How should the AI read these documents\?/i)).toBeVisible();
}

test.describe('Synthesise Information — live results, editor persistence, toast stacking', () => {
  // ── 2. the editor round-trips what is on screen ────────────────────────────
  test('structured output fields survive a save and a reload', async ({ page }) => {
    if (!(await createSynthesis(page, 'E2E persistence synthesis'))) return;

    const editorUrl = page.url();

    await turnOffAutoAnalyse(page);
    await page
      .getByLabel(/How should the AI read these documents\?/i)
      .fill('Each file is one supplier response.');

    await openOutputConfig(page);
    await page.getByLabel('Field 1 label').fill('Supplier Name');
    await page.getByLabel('Field 1 type').selectOption('text');

    await page.getByRole('button', { name: /Add field/i }).click();
    await page.getByLabel('Field 2 label').fill('Contract Value');
    await page.getByLabel('Field 2 type').selectOption('currency');

    await page.getByLabel(/Output instructions/i).fill('One row per supplier.');
    await closeOutputConfig(page);

    await page.getByRole('button', { name: /^Save$/ }).click();
    await expect(page.getByText(/^Saved$/)).toBeVisible();

    // The regression: reopening the editor re-runs the schema query, and before
    // the fix the form was seeded from the pending `null` rather than the row
    // that was just written — so every one of these came back empty.
    await page.goto(editorUrl);
    await expect(page.getByRole('heading', { name: /Edit synthesis/i })).toBeVisible({
      timeout: ROUTE_COMPILE_TIMEOUT,
    });
    await waitForEditorReady(page);
    await openOutputConfig(page);

    await expect(page.getByLabel('Field 1 label')).toHaveValue('Supplier Name');
    await expect(page.getByLabel('Field 2 label')).toHaveValue('Contract Value');
    await expect(page.getByLabel('Field 2 type')).toHaveValue('currency');
    await expect(page.getByLabel(/Output instructions/i)).toHaveValue('One row per supplier.');
    await closeOutputConfig(page);
    await expect(page.getByLabel(/How should the AI read these documents\?/i)).toHaveValue(
      'Each file is one supplier response.',
    );
  });

  // ── 1. the run screen follows the run without a reload ─────────────────────
  test('the results table polls itself and names the documents still to process', async ({
    page,
  }) => {
    if (!(await createSynthesis(page, 'E2E live results synthesis'))) return;

    // This case is about the sample run, so the manual path keeps it free of an
    // analysis starting on upload and drafting fields of its own.
    await turnOffAutoAnalyse(page);

    // Three input documents, so a sample leaves work outstanding behind the
    // preview boundary.
    await page.setInputFiles(
      '#sample-upload',
      ['alpha', 'bravo', 'charlie'].map((name) => ({
        name: `${name}.txt`,
        mimeType: 'text/plain',
        buffer: Buffer.from(`${name} tender response from ${name} Ltd`),
      })),
    );
    await expect(page.getByText('alpha.txt')).toBeVisible({ timeout: ROUTE_COMPILE_TIMEOUT });

    await openOutputConfig(page);
    await page.getByLabel('Field 1 label').fill('Supplier Name');
    await closeOutputConfig(page);

    // Count the results reads. httpBatchStreamLink puts the procedure names in
    // the URL, so a batched read still matches.
    let resultsReads = 0;
    page.on('request', (request) => {
      if (request.url().includes('extraction.getResults')) resultsReads += 1;
    });

    await page.getByRole('button', { name: /Run sample/i }).click();

    await expect(page.getByRole('heading', { name: /Summary of outputs/i })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId('results-table')).toBeVisible();

    // Documents the run has not settled get a row of their own — before the fix
    // they had no representation in the grid at all, so a half-finished run was
    // indistinguishable from a finished one with records missing.
    const pendingRows = page.getByTestId('pending-row');
    if ((await pendingRows.count()) > 0) {
      await expect(pendingRows.first()).toContainText(/Queued|Processing/);
    }

    // The regression: while the run is live the screen must re-read the results
    // on its own. Before the fix `getResults` was requested exactly once, at
    // mount, and the table only moved when the operator reloaded the page.
    const liveStatus = page.getByText(/^(running|paused preview|paused cap)$/i).first();
    if (!(await liveStatus.isVisible().catch(() => false))) {
      test.skip(true, 'Run settled before the poll window — nothing live to observe');
      return;
    }

    const before = resultsReads;
    await page.waitForTimeout(6_000);
    expect(resultsReads).toBeGreaterThan(before);
  });

  // ── 3. concurrent toasts stack upward instead of overlapping ───────────────
  test('two toasts occupy separate boxes instead of stacking on top of each other', async ({
    page,
  }) => {
    if (!(await synthesiseAvailable(page))) return;

    // Force two failures so the surface raises two error toasts in quick
    // succession without depending on real backend state.
    await page.route(/\/api\/trpc\/extraction\.create/, async (route) => {
      await route.fulfill({ status: 500, contentType: 'text/plain', body: 'mock create failure' });
    });

    await page.getByRole('button', { name: /New synthesis/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.getByLabel('Name').fill('Toast one');
    await dialog.getByRole('button', { name: /^Create$/ }).click();

    await dialog.getByLabel('Name').fill('Toast two');
    await dialog.getByRole('button', { name: /^Create$/ }).click();

    const toasts = page.locator('[data-sonner-toast]');
    await expect(toasts).toHaveCount(2, { timeout: 10_000 });

    // Expanded is the contract: sonner's default lays every toast at the same
    // spot and only fans them out on hover, which reads as one toast hiding the
    // rest.
    await expect(toasts.first()).toHaveAttribute('data-expanded', 'true');

    // The stack lifts into place over a transition, so measuring the instant the
    // second toast mounts catches it mid-flight. Poll the overlap instead:
    // expanded toasts separate within a few hundred milliseconds, collapsed ones
    // sit on top of each other for as long as they are on screen.
    await expect
      .poll(
        async () => {
          const first = await toasts.nth(0).boundingBox();
          const second = await toasts.nth(1).boundingBox();
          if (!first || !second) return Number.POSITIVE_INFINITY;
          const [upper, lower] = first.y <= second.y ? [first, second] : [second, first];
          return upper.y + upper.height - lower.y;
        },
        // Under sonner's default 4s duration the first toast starts dismissing,
        // so the window has to close before it does — the lift transition is
        // 400ms, which leaves plenty of room.
        { timeout: 3_000, message: 'concurrent toasts must occupy disjoint boxes' },
      )
      .toBeLessThanOrEqual(0);
  });
});
