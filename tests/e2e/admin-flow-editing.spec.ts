/**
 * admin-flow-editing.spec.ts
 *
 * Tests admin canvas editing:
 *
 *   Two-step linear flow
 *     Step 1 (Gather Requirements) → Step 2 (Generate Summary)
 *     Connected by a single edge drawn via handle-drag.
 *
 *   Branching flow (used by chat-flow-scenarios.spec.ts)
 *     Step 1 (Gather Info, conversation) → Step 2 (Generate Report, document)
 *     Step 2 → Step 3A (Technical Review) AND Step 2 → Step 3B (Non-Technical Review)
 *     This structure lets the chat test build confidence through steps 1–2,
 *     trigger document generation, then exercise the branch override at step 2.
 *
 * Both tests create their own isolated flow. Screenshots are taken at every
 * meaningful milestone so the HTML report tells the full story.
 *
 * Branch creation uses ReactFlow's "drag from source handle to empty pane"
 * gesture which triggers onConnectEnd, auto-wiring a pending edge on save.
 */

import type { Page } from '@playwright/test';
import { test, expect } from './helpers/base';

async function createFlowAndOpenCanvas(page: Page, name: string): Promise<void> {
  await page.goto('/admin/flows');
  await page.waitForLoadState('networkidle');

  await page.getByRole('button', { name: /new flow/i }).click();
  await expect(page.getByRole('dialog')).toBeVisible();

  await page.locator('#flow-name').fill(name);
  await page.locator('#flow-expert-role').fill('E2E Test Expert');
  await page.getByRole('button', { name: /create flow/i }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 });

  const editLink = page.getByRole('link', { name: 'Edit' }).first();
  await expect(editLink).toBeVisible({ timeout: 5_000 });
  await editLink.click();

  await page.waitForURL(/\/admin\/flows\/[^/]+$/, { timeout: 10_000 });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1_200);
}

async function fillNodeConfig(
  page: Page,
  options: {
    name: string;
    instruction: string;
    doneWhen: string;
    outputType?: 'conversation_only' | 'generate_document';
  },
): Promise<void> {
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });
  await page.locator('#node-name').fill(options.name);
  await page.locator('#ai-instruction').fill(options.instruction);
  await page.locator('#done-when').fill(options.doneWhen);

  if (options.outputType === 'generate_document') {
    await page.locator('label', { hasText: 'Generate document' }).click();
  }

  await page.getByRole('button', { name: /^Save$/i }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 });
}

async function dragSourceHandleToPane(
  page: Page,
  nodeIndex: number,
  offsetX: number,
  offsetY: number,
): Promise<void> {
  const handle = page
    .locator('.react-flow__node')
    .nth(nodeIndex)
    .locator('.react-flow__handle-right');

  const box = await handle.boundingBox();
  if (!box) throw new Error(`Source handle on node ${nodeIndex} not found`);

  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 5, startY, { steps: 3 });
  await page.mouse.move(startX + offsetX, startY + offsetY, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(600);
}

test.describe('Admin: Two-Step Linear Flow', () => {
  test('admin creates a two-step linear flow', async ({ page, consoleLogs }) => {
    const flowName = `E2E Two-Step ${Date.now()}`;
    await createFlowAndOpenCanvas(page, flowName);
    await page.screenshot({ path: 'screenshots/two-step-01-empty-canvas.png', fullPage: true });

    // Step 1 — added via toolbar button
    await page.getByRole('button', { name: '+ Add step' }).click();
    await page.screenshot({ path: 'screenshots/two-step-02-step1-dialog.png', fullPage: true });

    await fillNodeConfig(page, {
      name: 'Gather Requirements',
      instruction: 'Ask the user what they need and collect their requirements in detail.',
      doneWhen: 'The user has clearly described all their requirements.',
    });
    await page.screenshot({ path: 'screenshots/two-step-03-step1-on-canvas.png', fullPage: true });
    await expect(page.locator('.react-flow__node')).toHaveCount(1);

    // Step 2 — drag from step 1's source handle to empty canvas space.
    // onConnectEnd fires: creates a temp node at the drop position and opens
    // the config modal with a pending edge (step 1 → new node) ready to save.
    await dragSourceHandleToPane(page, 0, 320, 0);
    await page.screenshot({ path: 'screenshots/two-step-04-step2-dialog.png', fullPage: true });

    await fillNodeConfig(page, {
      name: 'Generate Summary',
      instruction: 'Produce a concise summary document based on the gathered requirements.',
      doneWhen: 'A complete requirements summary has been generated.',
    });
    await page.screenshot({ path: 'screenshots/two-step-05-two-nodes.png', fullPage: true });

    await expect(page.locator('.react-flow__node')).toHaveCount(2);
    await expect(page.locator('.react-flow__edge')).toHaveCount(1);
    await page.screenshot({ path: 'screenshots/two-step-06-connected.png', fullPage: true });

    await page.getByRole('button', { name: /^Publish$/i }).click();
    await page.waitForTimeout(1_000);
    await page.screenshot({ path: 'screenshots/two-step-07-published.png', fullPage: true });

    const errors = consoleLogs.filter(l => l.type === 'error');
    expect(errors, `Errors in two-step flow:\n${errors.map(e => e.text).join('\n')}`).toHaveLength(0);
  });
});

test.describe('Admin: Branching Flow', () => {
  test('admin creates a branching flow with document step then two paths', async ({ page, consoleLogs }) => {
    const flowName = `E2E Branch ${Date.now()}`;
    await createFlowAndOpenCanvas(page, flowName);
    await page.screenshot({ path: 'screenshots/branch-01-empty-canvas.png', fullPage: true });

    // Step 1 — conversation step to gather information
    await page.getByRole('button', { name: '+ Add step' }).click();
    await page.screenshot({ path: 'screenshots/branch-02-step1-dialog.png', fullPage: true });

    await fillNodeConfig(page, {
      name: 'Gather Info',
      instruction: 'Ask the user for their name, organisation, and the nature of their request. Confirm their details before proceeding.',
      doneWhen: 'The user has provided their name, organisation, and request type.',
    });
    await page.screenshot({ path: 'screenshots/branch-03-step1-on-canvas.png', fullPage: true });
    await expect(page.locator('.react-flow__node')).toHaveCount(1);

    // Step 2 — document generation step, connected from step 1
    await dragSourceHandleToPane(page, 0, 320, 0);
    await page.screenshot({ path: 'screenshots/branch-04-step2-dialog.png', fullPage: true });

    await fillNodeConfig(page, {
      name: 'Generate Report',
      instruction: 'Using the information gathered, produce a structured intake report for this request.',
      doneWhen: 'A complete intake report has been generated.',
      outputType: 'generate_document',
    });
    await page.screenshot({ path: 'screenshots/branch-05-step2-on-canvas.png', fullPage: true });
    await expect(page.locator('.react-flow__node')).toHaveCount(2);
    await expect(page.locator('.react-flow__edge')).toHaveCount(1);

    // Step 3A — first branch from step 2, dragged upward
    await dragSourceHandleToPane(page, 1, 320, -130);
    await page.screenshot({ path: 'screenshots/branch-06-step3a-dialog.png', fullPage: true });

    await fillNodeConfig(page, {
      name: 'Technical Review',
      instruction: 'Walk the user through technical resolution steps for their issue.',
      doneWhen: 'The technical issue has been fully resolved.',
    });
    await page.screenshot({ path: 'screenshots/branch-07-step3a-on-canvas.png', fullPage: true });
    await expect(page.locator('.react-flow__node')).toHaveCount(3);
    await expect(page.locator('.react-flow__edge')).toHaveCount(2);

    // Step 3B — second branch from step 2, dragged downward
    await dragSourceHandleToPane(page, 1, 320, 130);
    await page.screenshot({ path: 'screenshots/branch-08-step3b-dialog.png', fullPage: true });

    await fillNodeConfig(page, {
      name: 'Non-Technical Review',
      instruction: 'Walk the user through non-technical resolution steps for their issue.',
      doneWhen: 'The non-technical issue has been fully resolved.',
    });
    await page.screenshot({ path: 'screenshots/branch-09-step3b-on-canvas.png', fullPage: true });

    await expect(page.locator('.react-flow__node')).toHaveCount(4);
    await expect(page.locator('.react-flow__edge')).toHaveCount(3);
    await page.screenshot({ path: 'screenshots/branch-10-full-canvas.png', fullPage: true });

    await page.getByRole('button', { name: /^Publish$/i }).click();
    await page.waitForTimeout(1_000);
    await page.screenshot({ path: 'screenshots/branch-11-published.png', fullPage: true });

    const errors = consoleLogs.filter(l => l.type === 'error');
    expect(errors, `Errors in branching flow:\n${errors.map(e => e.text).join('\n')}`).toHaveLength(0);
  });
});
