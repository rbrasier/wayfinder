/**
 * admin-flow-editing.spec.ts
 *
 * Tests admin canvas editing:
 *
 *   Two-step linear flow
 *     Step 1 (Gather Requirements) + Step 2 (Generate Summary) added via the
 *     toolbar button, then connected by dragging source handle → target handle.
 *
 *   Branching flow (used by chat-flow-scenarios.spec.ts)
 *     Step 1 (Gather Info, conversation) → Step 2 (Generate Report, document)
 *     Step 2 → Step 3A (Technical Review) AND Step 2 → Step 3B (Non-Technical Review)
 *     All four nodes are added via the toolbar button first, then wired with edges.
 *     The connection node[1]→node[3] uses a Y-offset detour so the drag path
 *     doesn't accidentally land on node[2]'s target handle (they share the same Y).
 *
 * Both tests create their own isolated flow. Screenshots are taken at every
 * meaningful milestone so the HTML report tells the full story.
 */

import type { Page } from '@playwright/test';
import { test, expect } from './helpers/base';

async function createFlowAndOpenCanvas(page: Page, name: string): Promise<void> {
  await page.goto('/admin/flows');
  await page.waitForLoadState('networkidle');

  await page.getByRole('button', { name: /new flow/i }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();

  await page.locator('#flow-name').fill(name);
  await page.locator('#flow-expert-role').fill('E2E Test Expert');
  await page.getByRole('button', { name: /create flow/i }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 });

  const editLink = page.getByRole('link', { name: 'Configure Flow' }).first();
  await expect(editLink).toBeVisible({ timeout: 5_000 });
  await editLink.click();

  // The canvas route is heavy (ReactFlow). In dev mode the first navigation
  // also triggers on-demand compilation, so allow the full navigation timeout.
  // "Configure Flow" links to the single canonical editor at /flows/[id]/config.
  await page.waitForURL(/\/flows\/[^/]+\/config$/, { timeout: 30_000 });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1_200);
}

// Publishing lives in the "⋯" Flow actions menu as a flat item:
// Flow actions → Publish globally (everyone).
async function publishGlobally(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Flow actions' }).click();
  await page.getByRole('button', { name: /publish globally/i }).click();
  await page.waitForTimeout(1_000);
}

async function addAndConfigureStep(
  page: Page,
  options: {
    name: string;
    instruction: string;
    doneWhen: string;
    outputType?: 'conversation_only' | 'generate_document';
  },
): Promise<void> {
  await page.getByRole('button', { name: '+ Add step' }).click();
  await page.getByRole('button', { name: 'Conversational' }).click();
  await expect(page.locator('#node-name')).toBeVisible({ timeout: 5_000 });

  await page.locator('#node-name').fill(options.name);
  await page.locator('#ai-instruction').fill(options.instruction);
  await page.locator('#done-when').fill(options.doneWhen);

  if (options.outputType === 'generate_document') {
    await page.locator('label', { hasText: 'Generate document' }).click();
  }

  await page.getByRole('button', { name: /^Save$/i }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(400);
}

async function connectNodes(page: Page, srcIndex: number, tgtIndex: number): Promise<void> {
  // Click the empty pane to deselect any active node. After a successful drag
  // ReactFlow leaves the source node [active]; its ring overlay intercepts
  // pointer events on adjacent handles when the next drag begins.
  await page.locator('.react-flow__pane').click({ position: { x: 10, y: 10 }, force: true });
  await page.waitForTimeout(200);

  // Fit all nodes into the viewport. ReactFlow positions nodes via CSS transforms
  // on a panning canvas; standard browser scroll has no effect, so nodes added
  // beyond the visible area stay out of viewport until Fit View resets the pan.
  await page.getByRole('button', { name: 'Fit View' }).click();
  await page.waitForTimeout(400);

  const src = page.locator('.react-flow__node').nth(srcIndex).locator('.react-flow__handle-right');
  const tgt = page.locator('.react-flow__node').nth(tgtIndex).locator('.react-flow__handle-left');
  await src.dragTo(tgt, { force: true });
  await page.waitForTimeout(800);
}

// When the drag path would pass through another node's target handle (same Y row),
// use a detour that drops below/above the intervening nodes before reaching the target.
async function connectNodesDetour(
  page: Page,
  srcIndex: number,
  tgtIndex: number,
  detourOffsetY: number,
): Promise<void> {
  // Same viewport fix as connectNodes — must fit view before reading boundingBox
  // coordinates, otherwise off-screen nodes return positions outside the viewport.
  await page.locator('.react-flow__pane').click({ position: { x: 10, y: 10 }, force: true });
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: 'Fit View' }).click();
  await page.waitForTimeout(400);

  const src = page.locator('.react-flow__node').nth(srcIndex).locator('.react-flow__handle-right');
  const tgt = page.locator('.react-flow__node').nth(tgtIndex).locator('.react-flow__handle-left');

  const srcBox = await src.boundingBox();
  const tgtBox = await tgt.boundingBox();
  if (!srcBox || !tgtBox) throw new Error(`Handle not found (src=${srcIndex} tgt=${tgtIndex})`);

  const sx = srcBox.x + srcBox.width / 2;
  const sy = srcBox.y + srcBox.height / 2;
  const tx = tgtBox.x + tgtBox.width / 2;
  const ty = tgtBox.y + tgtBox.height / 2;

  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 5, sy, { steps: 2 });
  await page.mouse.move(sx, sy + detourOffsetY, { steps: 5 });
  await page.mouse.move(tx, ty + detourOffsetY, { steps: 15 });
  await page.mouse.move(tx, ty, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(1_000);
}

test.describe('Admin: Two-Step Linear Flow', () => {
  test('admin creates a two-step linear flow', async ({ page, consoleLogs }) => {
    const flowName = `E2E Two-Step ${Date.now()}`;
    await createFlowAndOpenCanvas(page, flowName);
    await page.screenshot({ path: 'screenshots/two-step-01-empty-canvas.png', fullPage: true });

    await addAndConfigureStep(page, {
      name: 'Gather Requirements',
      instruction: 'Ask the user what they need and collect their requirements in detail.',
      doneWhen: 'The user has clearly described all their requirements.',
    });
    await page.screenshot({ path: 'screenshots/two-step-02-step1-on-canvas.png', fullPage: true });
    await expect(page.locator('.react-flow__node')).toHaveCount(1);

    await addAndConfigureStep(page, {
      name: 'Generate Summary',
      instruction: 'Produce a concise summary document based on the gathered requirements.',
      doneWhen: 'A complete requirements summary has been generated.',
    });
    await page.screenshot({ path: 'screenshots/two-step-03-step2-on-canvas.png', fullPage: true });
    await expect(page.locator('.react-flow__node')).toHaveCount(2);

    await connectNodes(page, 0, 1);
    await page.screenshot({ path: 'screenshots/two-step-04-connected.png', fullPage: true });
    await expect(page.locator('.react-flow__edge')).toHaveCount(1);

    await publishGlobally(page);
    await page.screenshot({ path: 'screenshots/two-step-05-published.png', fullPage: true });

    const errors = consoleLogs.filter(l => l.type === 'error');
    expect(errors, `Errors in two-step flow:\n${errors.map(e => e.text).join('\n')}`).toHaveLength(0);
  });
});

test.describe('Admin: Branching Flow', () => {
  test('admin creates a branching flow with document step then two paths', async ({ page, consoleLogs }) => {
    const flowName = `E2E Branch ${Date.now()}`;
    await createFlowAndOpenCanvas(page, flowName);
    await page.screenshot({ path: 'screenshots/branch-01-empty-canvas.png', fullPage: true });

    await addAndConfigureStep(page, {
      name: 'Gather Info',
      instruction: 'Ask the user for their name, organisation, and the nature of their request. Confirm their details before proceeding.',
      doneWhen: 'The user has provided their name, organisation, and request type.',
    });
    await page.screenshot({ path: 'screenshots/branch-02-step1-on-canvas.png', fullPage: true });

    await addAndConfigureStep(page, {
      name: 'Generate Report',
      instruction: 'Using the information gathered, produce a structured intake report for this request.',
      doneWhen: 'A complete intake report has been generated.',
      outputType: 'generate_document',
    });
    await page.screenshot({ path: 'screenshots/branch-03-step2-on-canvas.png', fullPage: true });

    await addAndConfigureStep(page, {
      name: 'Technical Review',
      instruction: 'Walk the user through technical resolution steps for their issue.',
      doneWhen: 'The technical issue has been fully resolved.',
    });
    await page.screenshot({ path: 'screenshots/branch-04-step3a-on-canvas.png', fullPage: true });

    await addAndConfigureStep(page, {
      name: 'Non-Technical Review',
      instruction: 'Walk the user through non-technical resolution steps for their issue.',
      doneWhen: 'The non-technical issue has been fully resolved.',
    });
    await page.screenshot({ path: 'screenshots/branch-05-all-nodes.png', fullPage: true });
    await expect(page.locator('.react-flow__node')).toHaveCount(4);

    // Wire the edges. All four nodes sit in a horizontal row at the same Y.
    // node[0]→node[1] and node[1]→node[2] are adjacent: simple dragTo.
    await connectNodes(page, 0, 1);
    await page.screenshot({ path: 'screenshots/branch-06-edge1.png', fullPage: true });

    await connectNodes(page, 1, 2);
    await page.screenshot({ path: 'screenshots/branch-07-edge2.png', fullPage: true });

    // node[1]→node[3] skips node[2], whose target handle sits on the same horizontal
    // path. Detour 80px below the node row to avoid accidentally landing on node[2].
    await connectNodesDetour(page, 1, 3, 80);
    await page.screenshot({ path: 'screenshots/branch-08-edge3.png', fullPage: true });

    await expect(page.locator('.react-flow__edge')).toHaveCount(3);
    await page.screenshot({ path: 'screenshots/branch-09-full-canvas.png', fullPage: true });

    await publishGlobally(page);
    await page.screenshot({ path: 'screenshots/branch-10-published.png', fullPage: true });

    const errors = consoleLogs.filter(l => l.type === 'error');
    expect(errors, `Errors in branching flow:\n${errors.map(e => e.text).join('\n')}`).toHaveLength(0);
  });
});
