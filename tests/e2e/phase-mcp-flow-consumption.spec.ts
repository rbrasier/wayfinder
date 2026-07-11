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
 *   an "MCP tools" section.
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

    await expect(page.getByText('MCP tools', { exact: true })).toBeVisible();
  });
});
