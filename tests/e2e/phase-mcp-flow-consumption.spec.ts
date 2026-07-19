/**
 * phase-mcp-flow-consumption.spec.ts
 *
 * Covers:
 *   v2.3.0 — MCP flow consumption (Phase 2b, ADR-032). An author can add a
 *            deterministic MCP Tool step from the node picker, and a
 *            conversational step exposes an allowed-MCP-tools picker.
 *
 * Visual spec:
 *   Canvas "Add step" → node-type picker includes "MCP Tool"; the MCP step
 *   config exposes a "MCP server" selector. A conversational step's config shows
 *   an "Add MCP" button beside the AI instructions that opens a tool picker modal.
 *
 * Assumes an authenticated admin plus at least one flow and one registered MCP
 * server. Requires a running stack; not executed in the migration sandbox.
 */

import { test, expect } from './helpers/base';
import { openFlowCanvas } from './helpers/seed';

test.describe('MCP flow consumption', () => {
  test('an author can add an MCP Tool step from the node picker', async ({ page }) => {
    // Opens the seeded flow on the canonical /flows/[id]/config route.
    expect(await openFlowCanvas(page)).toBe(true);

    await page.getByRole('button', { name: /add step/i }).first().click();
    await page.getByText('MCP Tool', { exact: true }).click();

    await expect(page.getByLabel('MCP server')).toBeVisible();
  });

  test('a conversational step exposes an allowed MCP tools picker', async ({ page }) => {
    expect(await openFlowCanvas(page)).toBe(true);

    // Open the first conversational step's config (double-click its canvas node).
    await page.locator('.react-flow__node').first().dblclick();

    // The MCP picker now lives behind an "Add MCP" button beside the AI
    // instructions, mirroring the skills picker, rather than an inline section.
    await page.getByRole('button', { name: 'Add MCP tools' }).click();
    await expect(page.getByRole('heading', { name: 'Add MCP tools' })).toBeVisible();
  });
});
