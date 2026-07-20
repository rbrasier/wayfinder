/**
 * phase-code-quality-hot-paths-group-e.spec.ts
 *
 * Covers Group E (boundary tightening) of the code-quality phase
 * (docs/development/to-be-implemented/code-quality-hot-paths-and-decomposition.phase.md).
 *
 * Item 17: the chat stream POST body is now Zod-validated (streamTurnRequestSchema)
 * instead of trusted via a bare cast, so a malformed body is a clean 400 rather
 * than a failure deep in the turn. This drives the authenticated endpoint with a
 * bad body and asserts the 400. (Items 15 and 18 — the getSessionToken dedupe and
 * ADR numbering notes — have no separate runtime surface.)
 */

import { test, expect } from './helpers/base';
import { loadSeedFixtures } from './helpers/seed';

test.describe('Code quality Group E: stream body validation', () => {
  test('a malformed stream body is rejected with 400', async ({ page }) => {
    const sessionId = loadSeedFixtures()?.sessionId;
    if (!sessionId) {
      test.skip(true, 'Seed fixtures unavailable — seed to enable this test');
      return;
    }

    // Authenticated (the base fixture carries the admin cookie) but the body's
    // `messages` is the wrong type, so schema validation must reject it.
    const response = await page.request.post(`/api/chat/${sessionId}/stream`, {
      data: { messages: 'not-an-array' },
      failOnStatusCode: false,
    });

    expect(response.status()).toBe(400);
  });
});
