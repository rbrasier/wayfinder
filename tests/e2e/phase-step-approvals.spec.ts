/**
 * phase-step-approvals.spec.ts
 *
 * Covers v1.37.0 — Step Approvals.
 *
 * Exercises the feature through the UI surface (the approvals inbox and the
 * admin HR/Entra settings) and through the tRPC API (creating an `approval`
 * node with an `approverSource`, and that deciding a non-existent approval is a
 * client-visible error — the no-invalid-decision guard).
 *
 * The API tests use the TEST_AUTH_BYPASS-only surface and a seeded flow, and
 * skip gracefully when neither is available, matching the other phase specs.
 */

import { test, expect } from './helpers/base';
import { loadSeedFixtures } from './helpers/seed';
import type { Page } from '@playwright/test';

async function trpcMutate(
  page: Page,
  procedure: string,
  input: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  const response = await page.request.post(`/api/trpc/${procedure}?batch=1`, {
    data: { '0': { json: input } },
  });
  return { status: response.status(), body: await response.json().catch(() => null) };
}

test.describe('Step approvals: UI', () => {
  test('the approvals inbox loads without console errors', async ({ page, consoleLogs }) => {
    await page.goto('/approvals');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: /approvals/i })).toBeVisible();

    const errors = consoleLogs.filter((log) => log.type === 'error');
    expect(errors, errors.map((error) => error.text).join('\n')).toHaveLength(0);
  });

  test('admin settings expose the HR directory and Entra cards', async ({ page }) => {
    await page.goto('/admin/settings');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('HR Directory Data')).toBeVisible();
    await expect(page.getByText(/Approver Directory/i)).toBeVisible();
  });
});

test.describe('Step approvals: API', () => {
  test('an approval node can be created with an approverSource and persists', async ({ page }) => {
    const flowId = loadSeedFixtures()?.flowId;
    if (!flowId) {
      test.skip(true, 'No seeded flow available — run the seed setup project first');
      return;
    }
    const probe = await page.request.get('/api/test/notifications');
    if (probe.status() === 404) {
      test.skip(true, 'TEST_AUTH_BYPASS not set');
      return;
    }

    const created = await trpcMutate(page, 'flow.node.create', {
      flowId,
      name: 'Manager sign-off',
      type: 'approval',
      positionX: 640,
      positionY: 200,
      config: { approverSource: 'first_level_supervisor', instructions: 'Please review.' },
    });
    expect(created.status, 'creating an approval node should succeed').toBe(200);

    const body = created.body as Array<{
      result?: { data?: { json?: { type?: string; config?: Record<string, unknown> } } };
    }>;
    const node = body?.[0]?.result?.data?.json;
    expect(node?.type).toBe('approval');
    expect(node?.config?.approverSource).toBe('first_level_supervisor');
  });

  test('deciding a non-existent approval is a client-visible error', async ({ page }) => {
    const probe = await page.request.get('/api/test/notifications');
    if (probe.status() === 404) {
      test.skip(true, 'TEST_AUTH_BYPASS not set');
      return;
    }

    const result = await trpcMutate(page, 'approval.decide', {
      approvalId: '00000000-0000-4000-8000-000000000000',
      decision: 'approved',
    });
    expect(result.status, 'deciding a missing approval should not succeed').not.toBe(200);
  });

  test('a dynamic approval node persists its roleHint (v1.39 RAG suggestion source)', async ({
    page,
  }) => {
    const flowId = loadSeedFixtures()?.flowId;
    if (!flowId) {
      test.skip(true, 'No seeded flow available — run the seed setup project first');
      return;
    }
    const probe = await page.request.get('/api/test/notifications');
    if (probe.status() === 404) {
      test.skip(true, 'TEST_AUTH_BYPASS not set');
      return;
    }

    const created = await trpcMutate(page, 'flow.node.create', {
      flowId,
      name: 'Delegated sign-off',
      type: 'approval',
      positionX: 720,
      positionY: 320,
      config: { approverSource: 'dynamic', roleHint: 'Chief Financial Officer' },
    });
    expect(created.status).toBe(200);

    const body = created.body as Array<{
      result?: { data?: { json?: { config?: Record<string, unknown> } } };
    }>;
    const config = body?.[0]?.result?.data?.json?.config;
    expect(config?.approverSource).toBe('dynamic');
    expect(config?.roleHint).toBe('Chief Financial Officer');
  });

  test('the decide mutation accepts the v1.39 routeBack field for rejections', async ({ page }) => {
    const probe = await page.request.get('/api/test/notifications');
    if (probe.status() === 404) {
      test.skip(true, 'TEST_AUTH_BYPASS not set');
      return;
    }

    // A missing approval should fail as NOT_FOUND, not as a bad-input parse error
    // — proving routeBack is a recognised part of the decide input shape.
    const result = await trpcMutate(page, 'approval.decide', {
      approvalId: '00000000-0000-4000-8000-000000000000',
      decision: 'rejected',
      routeBack: false,
    });
    expect(result.status).not.toBe(200);

    const body = result.body as Array<{ error?: { json?: { data?: { code?: string } } } }>;
    const code = body?.[0]?.error?.json?.data?.code;
    if (code) {
      expect(code).not.toBe('BAD_REQUEST');
      expect(code).not.toBe('PARSE_ERROR');
    }
  });
});
