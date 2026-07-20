/**
 * phase-code-quality-hot-paths-group-f.spec.ts
 *
 * Covers Group F (in-process rate limiting) of the code-quality phase
 * (docs/development/to-be-implemented/code-quality-hot-paths-and-decomposition.phase.md).
 *
 * The auth POST endpoint is fronted by a per-instance token-bucket IRateLimiter
 * keyed by IP. Bursting past the configured capacity must return HTTP 429 with a
 * Retry-After header — proving the real limiter is wired into the route (the
 * bucket maths itself is unit-tested).
 */

import { test, expect } from './helpers/base';

test.describe('Code quality Group F: in-process rate limiting', () => {
  test('bursting the auth endpoint eventually returns 429', async ({ page }) => {
    // Fire a tight burst of sign-in attempts (bad credentials — we only care about
    // the limiter, which runs before the auth handler). One IP, one bucket: past
    // the configured burst the limiter must start refusing with 429.
    const attempts = 60;
    let sawTooManyRequests = false;
    let retryAfter: string | null = null;

    for (let attempt = 0; attempt < attempts; attempt++) {
      const response = await page.request.post('/api/auth/sign-in/email', {
        data: { email: `burst-${attempt}@example.com`, password: 'wrong-password' },
        failOnStatusCode: false,
      });
      if (response.status() === 429) {
        sawTooManyRequests = true;
        retryAfter = response.headers()['retry-after'] ?? null;
        break;
      }
    }

    expect(sawTooManyRequests, 'expected a 429 within the burst').toBe(true);
    // A throttled response tells the client when to retry.
    expect(retryAfter).not.toBeNull();
  });
});
