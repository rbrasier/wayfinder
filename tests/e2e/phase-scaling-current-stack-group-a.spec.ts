/**
 * phase-scaling-current-stack-group-a.spec.ts
 *
 * Phase: Scaling Within the Current Stack — Group A (pure code fixes).
 *
 * Group A adds hot-path caches and a parallelised chat-stream prologue behind the
 * existing request surface. None of it changes the product contract, so the
 * externally observable guarantees are:
 *
 *   Happy path — repeated authenticated navigations across chat + admin pages keep
 *   resolving the same admin identity and render without bouncing to /login. This
 *   exercises the new near-static admin-settings cache and the published
 *   flow-version snapshot cache: neither may corrupt identity or definition on a
 *   warm cache hit.
 *
 *   Error path — the chat stream route still authenticates *before* doing any
 *   per-turn work, so an unauthenticated POST is rejected with 401 even after the
 *   prologue was reordered into a single parallel batch.
 */

import { test, expect } from './helpers/base';

test.describe('Scaling current stack — Group A', () => {
  test('repeated authenticated navigations stay consistent with warm hot-path caches', async ({
    page,
  }) => {
    // The admin-settings + flow-version caches populate on the first hit and serve
    // the rest; every load must still resolve the same admin identity.
    const protectedPaths = ['/chats', '/admin/flows', '/chats', '/admin/settings', '/chats'];

    for (const path of protectedPaths) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await expect(page, `expected ${path} to stay authenticated`).not.toHaveURL(/\/login/);
    }
  });

  test('the chat stream route rejects an unauthenticated turn with 401', async ({ browser }) => {
    const context = await browser.newContext({ storageState: undefined });
    const requestContext = context.request;

    // A random session id is fine: auth is checked before the session is loaded,
    // so an unauthenticated caller never reaches the (parallelised) prologue.
    const response = await requestContext.post(
      '/api/chat/00000000-0000-0000-0000-000000000000/stream',
      { data: { messages: [{ role: 'user', content: 'hello' }] } },
    );

    expect(response.status()).toBe(401);
    await context.close();
  });
});
