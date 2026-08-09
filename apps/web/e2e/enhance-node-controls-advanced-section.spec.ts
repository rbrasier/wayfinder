/**
 * enhance-node-controls-advanced-section.spec.ts
 *
 * Covers v0.27.5 — secondary step controls collapse behind an "Advanced"
 * disclosure so the config modal leads with what defines a step.
 *
 * What is tested:
 *   1. A new conversational step (default output type "generate document")
 *      opens with Advanced collapsed: "Done when…", "Allow manual field
 *      editing", "Require confirmation" and the notify toggle are all out of
 *      sight, while the instruction and output-type controls stay visible.
 *   2. Opening the disclosure reveals those controls, and a new step arrives
 *      with "Require confirmation" already on.
 *   3. Switching the output type to "Unstructured conversation" expands the
 *      section on its own, because "Done when…" is that type's only completion
 *      control.
 *   4. A control moved into Advanced still round-trips: turning the notify
 *      toggle on, saving, and re-opening shows it on.
 *
 * Blocks skip cleanly when their prerequisites are unavailable.
 */

import { test, expect } from './helpers/base';
import type { Page } from '@playwright/test';

const ADVANCED = '[data-advanced-section="section"]';

async function createFlowAndOpenCanvas(page: Page, name: string): Promise<void> {
  await page.goto('/admin/flows');
  await page.waitForLoadState('networkidle');

  await page.getByRole('button', { name: /new flow/i }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.locator('#flow-name').fill(name);
  await page.locator('#flow-expert-role').fill('E2E Advanced Section Expert');
  await page.getByRole('button', { name: /create flow/i }).click();
  // Creating a flow lands on the canvas editor directly (v0.21.0).
  await page.waitForURL(/\/flows\/[^/]+\/config$/, { timeout: 30_000 }).catch(() => undefined);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1_200);
}

async function addConversationalStep(page: Page): Promise<void> {
  await page.getByRole('button', { name: '+ Add step' }).first().click();
  await page.getByRole('button', { name: 'Conversational' }).click();
  await expect(page.locator('#node-name')).toBeVisible({ timeout: 10_000 });
}

const isOpen = (page: Page): Promise<boolean> =>
  page.locator(ADVANCED).evaluate((element: HTMLDetailsElement) => element.open);

test.describe('node config: Advanced section', () => {
  test('a new conversational step opens with the secondary controls collapsed', async ({
    page,
  }) => {
    await createFlowAndOpenCanvas(page, `Advanced Section ${Date.now()}`);
    await addConversationalStep(page);

    // What defines the step stays in the primary body.
    await expect(page.locator('#ai-instruction')).toBeVisible();
    await expect(page.locator('label', { hasText: 'Generate document' })).toBeVisible();

    // The disclosure exists and starts closed for the default output type.
    await expect(page.locator(ADVANCED)).toBeAttached();
    expect(await isOpen(page)).toBe(false);

    // Its contents are present in the DOM but not visible — <details> keeps the
    // subtree mounted, which the approval lone-slot effect depends on.
    await expect(page.locator('#done-when-mode')).toBeAttached();
    await expect(page.locator('#done-when-mode')).not.toBeVisible();
    await expect(page.locator('#allow-manual-edit')).not.toBeVisible();
    await expect(page.locator('#require-confirmation')).not.toBeVisible();
    await expect(page.locator('#notify-on-complete')).not.toBeVisible();
  });

  test('opening Advanced reveals the controls, with confirmation on by default', async ({
    page,
  }) => {
    await createFlowAndOpenCanvas(page, `Advanced Reveal ${Date.now()}`);
    await addConversationalStep(page);

    await page.locator(`${ADVANCED} summary`).click();

    await expect(page.locator('#done-when-mode')).toBeVisible();
    await expect(page.locator('#allow-manual-edit')).toBeVisible();
    await expect(page.locator('#notify-on-complete')).toBeVisible();

    // v0.27.5 — a new step holds for the operator's Proceed rather than
    // advancing the session past output nobody has read.
    await expect(page.locator('#require-confirmation')).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  test('switching to an unstructured conversation expands the section', async ({ page }) => {
    await createFlowAndOpenCanvas(page, `Advanced Unstructured ${Date.now()}`);
    await addConversationalStep(page);

    expect(await isOpen(page)).toBe(false);

    // An unstructured conversation has no template and no field set, so
    // "Done when…" is the only thing deciding when the step ends.
    await page.locator('label', { hasText: 'Unstructured conversation' }).click();

    await expect(page.locator('#done-when-mode')).toBeVisible({ timeout: 5_000 });
    expect(await isOpen(page)).toBe(true);

    // "All fields captured" belongs to the two output types that declare
    // fields, so an unstructured step does not offer it.
    await expect(page.locator('#done-when-mode option[value="template"]')).toHaveCount(0);
  });

  test('a control moved into Advanced still round-trips through save', async ({ page }) => {
    await createFlowAndOpenCanvas(page, `Advanced Roundtrip ${Date.now()}`);
    await addConversationalStep(page);

    await page.locator('#node-name').fill('Gather requirements');
    await page.locator('#ai-instruction').fill('Ask the user what they need.');
    await page.locator('label', { hasText: 'Unstructured conversation' }).click();

    // Unstructured expands the section on its own; drive the controls in it.
    await expect(page.locator('#done-when-mode')).toBeVisible({ timeout: 5_000 });
    await page.locator('#done-when-mode').selectOption('condition');
    await page.locator('#done-when').fill('The user has described what they need.');
    await page.locator('#notify-on-complete').click();
    await expect(page.locator('#notify-on-complete')).toHaveAttribute('aria-checked', 'true');

    await page.getByRole('button', { name: /^Save$/i }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(500);

    await page.locator('.react-flow__node', { hasText: 'Gather requirements' }).first().dblclick();
    await expect(page.locator('#node-name')).toBeVisible({ timeout: 10_000 });

    // Saved as unstructured, so the section expands again on re-open.
    await expect(page.locator('#notify-on-complete')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#notify-on-complete')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#done-when')).toHaveValue(
      'The user has described what they need.',
    );
  });
});
