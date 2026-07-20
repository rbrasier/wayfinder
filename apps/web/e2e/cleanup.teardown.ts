/**
 * cleanup.teardown.ts
 *
 * Runs after the suite (Playwright project teardown). Calls the test-only
 * teardown endpoint to delete all seeded and test-created flow/session data.
 */

import { test as teardown, expect } from '@playwright/test';

teardown('remove e2e fixtures and test data', async ({ request }) => {
  // Deleting every flow/session row on a loaded dev server can exceed the
  // default 15s request timeout.
  const response = await request.post('/api/test/teardown', { timeout: 60_000 });
  expect(
    response.ok(),
    `Teardown failed (${response.status()}): ${await response.text()}`,
  ).toBeTruthy();

  console.log('🧹 Teardown: cleared E2E flow/session data');
});
