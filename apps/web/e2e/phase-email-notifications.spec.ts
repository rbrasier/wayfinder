/**
 * phase-email-notifications.spec.ts
 *
 * Covers v1.35.0 — Email Notifications (session complete / flow shared).
 *
 * Sharing a flow (flow.grantOwner) must write exactly one `flow_shared` outbox
 * row per newly added user to app_notification_log, and a repeat grant must
 * not create a second row (the idempotency unique index). The outbox is read
 * back through the TEST_AUTH_BYPASS-only /api/test/notifications endpoint.
 *
 * Delivery status depends on the environment's SMTP_TRANSPORT_MODE /
 * NOTIFICATIONS_ENABLED: `sent` with the stream sink enabled, `pending` when
 * notifications are disabled, `failed` when no transport is configured. All
 * are valid here — the invariants under test are row creation, recipient
 * targeting, and deduplication, plus that the grant action itself always
 * succeeds regardless of email delivery.
 */

import { test, expect } from './helpers/base';
import { loadSeedFixtures } from './helpers/seed';
import type { Page } from '@playwright/test';

interface NotificationRow {
  id: string;
  recipient_email: string;
  trigger: string;
  resource_type: string;
  resource_id: string;
  status: string;
  subject: string;
}

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

async function fetchNotifications(page: Page, resourceId: string): Promise<NotificationRow[] | null> {
  const response = await page.request.get(`/api/test/notifications?resourceId=${resourceId}`);
  if (!response.ok()) return null;
  const body = (await response.json()) as { notifications: NotificationRow[] };
  return body.notifications;
}

test.describe('Email notifications: flow shared', () => {
  test('granting flow ownership writes one outbox row and a repeat grant does not duplicate it', async ({ page }) => {
    const flowId = loadSeedFixtures()?.flowId;
    if (!flowId) {
      test.skip(true, 'No seeded flow available — run the seed setup project first');
      return;
    }

    // The endpoint only exists with TEST_AUTH_BYPASS=true.
    const probe = await page.request.get(`/api/test/notifications?resourceId=${flowId}`);
    if (probe.status() === 404) {
      test.skip(true, '/api/test/notifications unavailable (TEST_AUTH_BYPASS not set)');
      return;
    }

    const recipientEmail = `notify-e2e-${Date.now()}@example.com`;
    const created = await trpcMutate(page, 'user.create', {
      email: recipientEmail,
      name: 'Notify Recipient',
    });
    expect(created.status, 'admin user.create should succeed').toBe(200);
    const createdBody = created.body as Array<{ result?: { data?: { json?: { id?: string } } } }>;
    const recipientId = createdBody?.[0]?.result?.data?.json?.id;
    expect(recipientId, 'created user id should be returned').toBeTruthy();

    const granted = await trpcMutate(page, 'flow.grantOwner', {
      flowId,
      userId: recipientId,
    });
    expect(granted.status, 'flow.grantOwner should succeed').toBe(200);

    // The notification is enqueued fire-and-forget after the grant commits.
    await expect
      .poll(
        async () => {
          const rows = await fetchNotifications(page, flowId);
          return rows?.filter((row) => row.recipient_email === recipientEmail).length ?? 0;
        },
        { message: 'expected one flow_shared outbox row', timeout: 10_000 },
      )
      .toBe(1);

    const rows = (await fetchNotifications(page, flowId)) ?? [];
    const row = rows.find((candidate) => candidate.recipient_email === recipientEmail);
    expect(row).toMatchObject({
      trigger: 'flow_shared',
      resource_type: 'flow',
      resource_id: flowId,
    });
    expect(['pending', 'sent', 'failed']).toContain(row?.status);
    expect(row?.subject).toContain('flow with you');

    // Re-granting the same user must succeed without a second outbox row.
    const regranted = await trpcMutate(page, 'flow.grantOwner', {
      flowId,
      userId: recipientId,
    });
    expect(regranted.status, 'repeat grant should still succeed').toBe(200);

    await page.waitForTimeout(2_000);
    const afterRepeat = (await fetchNotifications(page, flowId)) ?? [];
    expect(
      afterRepeat.filter((candidate) => candidate.recipient_email === recipientEmail),
    ).toHaveLength(1);
  });

  test('granting on a nonexistent flow fails visibly and writes no outbox row', async ({ page }) => {
    const probe = await page.request.get('/api/test/notifications');
    if (probe.status() === 404) {
      test.skip(true, '/api/test/notifications unavailable (TEST_AUTH_BYPASS not set)');
      return;
    }

    const missingFlowId = '00000000-0000-4000-8000-000000000000';
    const result = await trpcMutate(page, 'flow.grantOwner', {
      flowId: missingFlowId,
      userId: '00000000-0000-4000-8000-000000000001',
    });

    expect(result.status, 'grant on missing flow should be a client-visible error').not.toBe(200);

    const rows = (await fetchNotifications(page, missingFlowId)) ?? [];
    expect(rows).toHaveLength(0);
  });
});
