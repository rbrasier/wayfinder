/**
 * enhance-hr-auto-detect.spec.ts
 *
 * Covers v1.39.0 — HR Column Mapping Auto-Detection (deferred from v1.37.0).
 *
 * Exercises the feature through the tRPC API: uploading an HR spreadsheet runs
 * the AiColumnMappingDetector so the stored dataset arrives with a pre-filled
 * column mapping for the operator to confirm — and an operator override via
 * hr.setMapping persists.
 *
 * The detector calls the configured language model server-side, which the
 * browser-level AI mock does not intercept; so the pre-fill assertion only fires
 * when a mapping actually came back, and the import-never-fails guarantee is the
 * deterministic assertion. The override path needs no AI at all. Skips gracefully
 * without TEST_AUTH_BYPASS / admin, matching the other phase specs.
 */

import { test, expect } from './helpers/base';
import type { Page } from '@playwright/test';

async function trpcMutate(
  page: Page,
  procedure: string,
  input: Record<string, unknown>,
): Promise<{ status: number; json: unknown }> {
  const response = await page.request.post(`/api/trpc/${procedure}?batch=1`, {
    data: { '0': { json: input } },
  });
  const body = (await response.json().catch(() => null)) as
    | Array<{ result?: { data?: { json?: unknown } } }>
    | null;
  return { status: response.status(), json: body?.[0]?.result?.data?.json ?? null };
}

const CSV = [
  'Email,Full Name,Line Manager,Job Title,Band,Business Unit',
  'ada@corp.test,Ada Lovelace,bob@corp.test,Analyst,APS6,Policy',
].join('\n');

type Dataset = { id: string; columns: string[]; columnMapping: Record<string, string> };

test.describe('HR column auto-detect: API', () => {
  test('uploading a spreadsheet pre-fills the column mapping and an override persists', async ({
    page,
  }) => {
    const probe = await page.request.get('/api/test/notifications');
    if (probe.status() === 404) {
      test.skip(true, 'TEST_AUTH_BYPASS not set');
      return;
    }

    const uploaded = await trpcMutate(page, 'hr.upload', {
      filename: 'people.csv',
      format: 'csv',
      contentBase64: Buffer.from(CSV).toString('base64'),
    });
    if (uploaded.status !== 200) {
      test.skip(true, 'HR upload not available for this user (admin only)');
      return;
    }

    const dataset = uploaded.json as Dataset;
    expect(dataset.columns).toContain('Email');
    expect(dataset.columns).toContain('Full Name');

    // Import must succeed regardless of detection. When a mapping was detected
    // (model reachable), it should recognise the obvious email/name columns.
    const detected = dataset.columnMapping ?? {};
    if (Object.keys(detected).length > 0) {
      expect(Object.values(detected)).toContain('email');
      expect(Object.values(detected)).toContain('name');
    }

    // Operator override — no AI involved — must persist.
    const override = await trpcMutate(page, 'hr.setMapping', {
      datasetId: dataset.id,
      mapping: { Email: 'email', 'Full Name': 'name', 'Line Manager': 'manager' },
    });
    expect(override.status).toBe(200);
    expect((override.json as Dataset).columnMapping).toEqual({
      Email: 'email',
      'Full Name': 'name',
      'Line Manager': 'manager',
    });
  });
});
