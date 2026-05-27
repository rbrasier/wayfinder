/**
 * auth.setup.ts
 *
 * Runs once before all tests. Authenticates as admin and saves
 * the session cookie to playwright/.auth/admin.json.
 *
 * Wayfinder uses magic-link auth. In test mode (TEST_AUTH_BYPASS=true),
 * a dedicated endpoint returns a session token directly — no email needed.
 */

import { test as setup, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const AUTH_FILE = 'playwright/.auth/admin.json';
const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL || 'admin@example.com';

setup('authenticate as admin', async ({ page, request }) => {
  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });

  if (process.env.TEST_AUTH_BYPASS !== 'true') {
    throw new Error(
      'TEST_AUTH_BYPASS=true must be set in your .env for E2E tests.\n' +
      'This enables the /api/auth/test-session endpoint used by the test auth setup.'
    );
  }

  // Hit the test-only endpoint that returns a session token for ADMIN_EMAIL
  const response = await request.post('/api/auth/test-session', {
    data: { email: ADMIN_EMAIL },
    timeout: 60000,
  });

  if (!response.ok()) {
    const body = await response.text();
    throw new Error(
      `Auth bypass failed (${response.status()}): ${body}\n` +
      'Make sure TEST_AUTH_BYPASS=true is set and the app is running.'
    );
  }

  const { token } = await response.json();

  // Inject the session cookie
  await page.context().addCookies([
    {
      name: 'better-auth.session_token',
      value: token,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    },
  ]);

  // Verify: navigate to a protected page and confirm we're in
  await page.goto('/admin/flows');
  await expect(page).not.toHaveURL(/login/, { timeout: 8000 });

  // Save the authenticated state
  await page.context().storageState({ path: AUTH_FILE });

  const aiMode = process.env.USE_REAL_AI === 'true' ? '🔴 REAL AI' : '🟢 MOCKED AI';
  console.log(`✅ Auth: session saved for ${ADMIN_EMAIL} | ${aiMode}`);
});
