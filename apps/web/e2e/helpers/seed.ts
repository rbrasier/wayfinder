/**
 * helpers/seed.ts
 *
 * Shared access to the deterministic fixtures created by the seed setup project
 * (see seed.setup.ts → POST /api/test/seed). The seed writes the created ids to
 * a JSON file so specs can navigate directly to the seeded session/flow instead
 * of scraping the first item out of a list (which is non-deterministic once the
 * specs themselves create flows/sessions during the run).
 */

import fs from 'fs';
import path from 'path';
import type { Page } from '@playwright/test';

export const SEED_FILE = path.join('playwright', '.seed', 'fixtures.json');

export interface SeedFixtures {
  flowId: string;
  sessionId: string;
  // Optional because older seed files (and the graceful unseeded path) may not
  // carry them; specs that need one skip when it is absent.
  forkFlowId?: string;
  confirmationSessionId?: string;
  approvalSessionId?: string;
  structuredSessionId?: string;
}

export function writeSeedFixtures(fixtures: SeedFixtures): void {
  fs.mkdirSync(path.dirname(SEED_FILE), { recursive: true });
  fs.writeFileSync(SEED_FILE, JSON.stringify(fixtures, null, 2));
}

export function loadSeedFixtures(): SeedFixtures | null {
  try {
    return JSON.parse(fs.readFileSync(SEED_FILE, 'utf8')) as SeedFixtures;
  } catch {
    return null;
  }
}

/**
 * Open a flow's canvas/config page. Prefers the seeded flow (which has nodes),
 * falling back to the first "Configure Flow" link in the admin list so the
 * specs still work in an unseeded environment. Returns false when no flow is
 * available, so callers can skip.
 */
export async function openFlowCanvas(page: Page): Promise<boolean> {
  const flowId = loadSeedFixtures()?.flowId;
  if (flowId) {
    await page.goto(`/flows/${flowId}/config`);
    await page.waitForLoadState('networkidle');
    return true;
  }

  await page.goto('/admin/flows');
  await page.waitForLoadState('networkidle');
  const editLink = page.getByRole('link', { name: 'Configure Flow' }).first();
  if (!(await editLink.isVisible().catch(() => false))) return false;
  await editLink.click();
  await page.waitForLoadState('networkidle');
  return true;
}
