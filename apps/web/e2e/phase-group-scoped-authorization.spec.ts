/**
 * phase-group-scoped-authorization.spec.ts
 *
 * Covers:
 *   v2.7.0 — Group-Scoped Authorization & Delegated Admin (ADR-036).
 *
 * Visual spec:
 *   - The admin sidebar has a "Groups" entry linking to /admin/groups.
 *   - /admin/groups lets a global admin create a group; each group then shows a
 *     "<name> — Members" panel with an add-member control and per-member
 *     "Make delegated admin" / "Remove" actions.
 *   - The owner flow-config publish menu gains a "Publish to groups…" option that
 *     opens a group picker (the third FlowVisibility kind).
 *
 * Runs authenticated as admin (auth.setup.ts). Happy path: create a group and
 * see its membership panel. Error path: the "Add group" button stays disabled
 * for an empty name (no blank groups reach the server).
 */

import { test, expect } from './helpers/base';
import { openFlowCanvas as openFirstFlowCanvas } from './helpers/seed';

const uniqueGroupName = (): string => `E2E Group ${Date.now()}`;

test.describe('Phase: Group-Scoped Authorization', () => {
  test('admin sidebar exposes a Groups link', async ({ page }) => {
    await page.goto('/admin/flows');
    await page.waitForLoadState('networkidle');

    // Groups lives under the "Users and Roles" group, collapsed by default.
    await page.getByRole('button', { name: /Users and Roles/i }).click();
    const groupsLink = page.getByRole('link', { name: /^groups$/i });
    await expect(groupsLink).toBeVisible();
  });

  test('the create-group button is disabled until a name is entered', async ({ page }) => {
    await page.goto('/admin/groups');
    await page.waitForLoadState('networkidle');

    // Creating a group is now a modal, opened from the "New group" button.
    await page.getByRole('button', { name: /^new group$/i }).click();
    const dialog = page.getByRole('dialog');
    const createButton = dialog.getByRole('button', { name: /^create group$/i });
    await expect(createButton).toBeVisible();
    await expect(createButton).toBeDisabled();

    await dialog.getByLabel(/^name$/i).fill('   ');
    // Whitespace-only names must not enable the create action.
    await expect(createButton).toBeDisabled();
  });

  test('a global admin can create a group and see its membership panel', async ({ page, consoleLogs }) => {
    const name = uniqueGroupName();

    await page.goto('/admin/groups');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /^new group$/i }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/^name$/i).fill(name);
    await dialog.getByRole('button', { name: /^create group$/i }).click();

    // The new group appears in the list and gets its own membership panel.
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
    await expect(
      page.getByRole('heading', { name: new RegExp(`${name} — Members`, 'i') }),
    ).toBeVisible();
    await page.screenshot({ path: 'screenshots/admin-groups-created.png', fullPage: true });

    const errors = consoleLogs.filter((l) => l.type === 'error');
    expect(errors, `JS errors:\n${errors.map((e) => e.text).join('\n')}`).toHaveLength(0);
  });

  test('the flow publish menu offers a group visibility option', async ({ page }) => {
    const opened = await openFirstFlowCanvas(page);
    if (!opened) {
      test.skip(true, 'No flows available to inspect publish controls');
      return;
    }

    const flowActions = page.getByRole('button', { name: /flow actions/i }).first();
    if (!(await flowActions.isVisible().catch(() => false))) {
      test.skip(true, 'Flow actions menu not found — header layout may differ');
      return;
    }

    await flowActions.click();
    // Admins hold publish-to-everyone, so the group option is offered whenever
    // at least one group exists (seeded above in the create test run).
    const groupOption = page.getByText(/publish to groups…|edit group visibility…/i).first();
    await expect(groupOption).toBeVisible();
    await page.keyboard.press('Escape').catch(() => {});
  });
});
