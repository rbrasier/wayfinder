/**
 * enhance-repeating-group-editing.spec.ts
 *
 * End-to-end coverage for the repeating/structured-groups follow-up (v2.5.1):
 * a repeating group's extracted items are now visible as a table in the
 * "Show data" modal, rather than collapsing to a single blank row.
 *
 * The Show Data modal reads its payload from the `session.stepData` tRPC query.
 * tRPC batches queries, so rather than matching a solo request we intercept the
 * batch, fetch the real response, and splice our group-bearing payload into the
 * stepData slot by position — robust regardless of how the query is batched.
 * We then assert the browser renders the group as a table with humanised column
 * headers and per-item cells, exercising buildGroupTable and the GroupCell
 * renderer through the running app.
 *
 * The editor half of this enhancement (adding/removing/editing group items and
 * persisting them) is covered by unit and tRPC-router integration tests
 * (group-edit.test.ts, update-document-fields.test.ts, document.test.ts), since
 * the edit dialog only mounts on an editable generated-document message.
 */

import { test, expect } from './helpers/base';
import type { Route } from '@playwright/test';
import { loadSeedFixtures } from './helpers/seed';

const STEP_DATA_PAYLOAD = [
  {
    nodeId: 'node-eval',
    stepName: 'Supplier Evaluation',
    stepNumber: 1,
    completedAt: '2026-07-01T09:00:00.000Z',
    fields: [
      { key: 'summary', label: 'Summary', type: 'text', value: 'Three suppliers assessed.' },
      {
        key: 'suppliers',
        label: 'Suppliers',
        type: 'group',
        value: '',
        items: [
          { supplier: 'Acme Ltd', score: '82' },
          { supplier: 'Globex Inc', score: '76' },
        ],
      },
    ],
  },
];

const TRPC_MARKER = '/api/trpc/';

test.describe('enhance: repeating group items in Show Data', () => {
  test('a group renders as a table with humanised headers and per-item rows', async ({ page }) => {
    const sessionId = loadSeedFixtures()?.sessionId;
    test.skip(!sessionId, 'no seeded session available');

    // Intercept every tRPC call; only rewrite the batch slot that carries
    // session.stepData, passing everything else through untouched. The batch URL
    // lists procedures comma-joined in the same order as the response array.
    await page.route('**/api/trpc/**', async (route: Route) => {
      const pathname = new URL(route.request().url()).pathname;
      const procedures = pathname.slice(pathname.indexOf(TRPC_MARKER) + TRPC_MARKER.length).split(',');
      const stepIndex = procedures.indexOf('session.stepData');
      if (stepIndex === -1) {
        await route.continue();
        return;
      }

      const response = await route.fetch();
      const body = await response.json().catch(() => null);
      if (Array.isArray(body) && body[stepIndex]) {
        body[stepIndex] = { result: { data: { json: STEP_DATA_PAYLOAD } } };
        // Serialise the body ourselves rather than reusing the fetched response,
        // whose content-encoding header would not match the rewritten JSON.
        await route.fulfill({
          status: response.status(),
          contentType: 'application/json',
          body: JSON.stringify(body),
        });
        return;
      }
      await route.fulfill({ response });
    });

    await page.goto(`/chats/${sessionId}`, { waitUntil: 'domcontentloaded' });
    // The chat page holds an SSE connection open, so 'networkidle' is unreliable;
    // wait on the actions affordance instead.
    const actionsButton = page.getByRole('button', { name: 'Chat actions' });
    await expect(actionsButton).toBeVisible({ timeout: 20_000 });
    await actionsButton.click();
    await page.getByRole('button', { name: 'Show data' }).click();

    const dialog = page.getByRole('dialog').filter({ hasText: 'Session data' });
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Expand the completed step to reveal its outputs.
    await dialog.getByText('Supplier Evaluation', { exact: false }).click();

    // Scalar field still renders as a plain value row.
    await expect(dialog.getByText('Three suppliers assessed.', { exact: false })).toBeVisible();

    // The group renders as a table: humanised headers derived from item keys …
    await expect(dialog.getByText('Supplier', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Score', { exact: true })).toBeVisible();
    // … and one row per extracted item.
    await expect(dialog.getByText('Acme Ltd', { exact: false })).toBeVisible();
    await expect(dialog.getByText('Globex Inc', { exact: false })).toBeVisible();
    await expect(dialog.getByText('2 items', { exact: false })).toBeVisible();
  });
});
