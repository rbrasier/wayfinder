/**
 * enhance-repeating-group-editing.spec.ts
 *
 * End-to-end coverage for the repeating/structured-groups follow-up (v2.8.0):
 * a repeating group's extracted items are now visible as a table in the
 * "Show data" modal, rather than collapsing to a single blank row.
 *
 * The seeded session's completed document step carries a "Recommendations"
 * group (see seedE2EFixtures), so the live `session.stepData` query returns it
 * with no mocking. We open "Show data", expand the step, and assert the group
 * renders as a table with humanised column headers and per-item rows —
 * exercising buildGroupTable and the GroupCell renderer through the running app.
 *
 * The editor half of this enhancement (adding/removing/editing group items and
 * persisting them) is covered by unit and tRPC-router integration tests
 * (group-edit.test.ts, update-document-fields.test.ts, document.test.ts), since
 * the edit dialog only mounts on an editable generated-document message.
 */

import { test, expect } from './helpers/base';
import { loadSeedFixtures } from './helpers/seed';

test.describe('enhance: repeating group items in Show Data', () => {
  test('a group renders as a table with humanised headers and per-item rows', async ({ page }) => {
    const sessionId = loadSeedFixtures()?.sessionId;
    test.skip(!sessionId, 'no seeded session available');

    await page.goto(`/chats/${sessionId}`, { waitUntil: 'domcontentloaded' });

    // The chat page holds an SSE connection open, so 'networkidle' is unreliable;
    // wait on the actions affordance instead.
    const actionsButton = page.getByRole('button', { name: 'Chat actions' });
    await expect(actionsButton).toBeVisible({ timeout: 20_000 });
    await actionsButton.click();
    await page.getByRole('button', { name: 'Show data' }).click();

    const dialog = page.getByRole('dialog').filter({ hasText: 'Session data' });
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Expand the completed document step to reveal its outputs.
    await dialog.getByText('Draft onboarding plan', { exact: false }).click();

    // A scalar field still renders as a plain value row.
    await expect(dialog.getByText('Jane Smith', { exact: false })).toBeVisible();

    // The group renders as a table: humanised headers derived from item keys …
    await expect(dialog.getByRole('columnheader', { name: 'Owner' })).toBeVisible();
    await expect(dialog.getByRole('columnheader', { name: 'Action' })).toBeVisible();
    // … one row per stored item …
    await expect(dialog.getByText('Provision laptop', { exact: false })).toBeVisible();
    await expect(dialog.getByText('Schedule induction', { exact: false })).toBeVisible();
    // … and the item count.
    await expect(dialog.getByText('2 items', { exact: false })).toBeVisible();
  });
});
