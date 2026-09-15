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

/**
 * Every id the seed endpoint returns, as a runtime value rather than a type
 * alone. seed.setup.ts iterates it to prove the response carried each one, so a
 * field added to SeedResult but never written here fails the setup project
 * instead of silently reaching specs as `undefined` — which reads to a spec as
 * "not seeded" and skips it. That failure mode hid the withdrawable-approval
 * fixture from its whole spec file for several releases.
 */
export const SEED_FIXTURE_KEYS = [
  'flowId',
  'sessionId',
  'forkFlowId',
  'confirmationSessionId',
  'approvalSessionId',
  'structuredSessionId',
  'structuredFlowId',
  'approvalSubjectSessionId',
  'approvalSubjectFlowId',
  'signatureWarningFlowId',
  'approvalFirstFlowId',
  'approvalWithdrawSessionId',
  'approvalWithdrawDraftStepName',
  'offSystemApprovalSessionId',
  'offSystemApprovalNextStepName',
  'extractionFlowId',
  'extractionRunId',
] as const;

export type SeedFixtures = Record<(typeof SEED_FIXTURE_KEYS)[number], string>;

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
 * The seed-backed counterpart to loadSeedFixtures: use this when a spec cannot
 * do its job without the fixtures.
 *
 * The `chromium` project declares `seed` as a dependency, so a spec body only
 * runs once the seed setup has passed. A missing fixture there is a broken
 * seed or a broken project graph — never a reason for the spec to excuse
 * itself. Skipping on it is how a spec goes green while asserting nothing, so
 * this throws instead and the run reports a failure with somewhere to look.
 *
 * Genuine capability gates are a different thing and stay as skips: no object
 * storage (E2E_OBJECT_STORAGE), PKI mode off, real-AI-only paths. Those
 * describe an environment that cannot run the test, not a suite that is broken.
 */
export function requireSeedFixtures(): SeedFixtures {
  const fixtures = loadSeedFixtures();
  if (fixtures) return fixtures;

  throw new Error(
    `No seed fixtures at ${SEED_FILE}. The seed setup project is a declared ` +
      `dependency of the project running this spec, so reaching here without ` +
      `them means the seed failed or the project graph changed — not that this ` +
      `spec is unrunnable. Check the "seed e2e fixtures" setup result.`,
  );
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
