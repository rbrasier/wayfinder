import { test, expect } from "./helpers/base";

// E2E regression for the new-user registration bug (fix: better-auth-uuid-id).
//
// Driven by the /e2e (Playwright MCP) skill against a running stack — excluded
// from the vitest unit run. The bug: Better Auth generated random string ids
// while every core_* table declares `id` as a Postgres uuid column, so the
// sign-up insert failed with "invalid input syntax for type uuid" and the user
// was never created. The form surfaced "Registration failed" and stayed on
// /register instead of redirecting to /chats.
//
// The assertion is the success contract: a fresh email registers and lands the
// user on /chats with no error message. On the unfixed code the insert throws,
// the error paragraph renders, and the redirect never happens.

const REGISTER_PATH = process.env.E2E_REGISTER_PATH ?? "/register";

test.describe("new user registration", () => {
  // Registration must run logged-out: the shared chromium project applies the
  // admin storageState, and an authenticated visit to /register redirects to
  // /chats before the form renders.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("registers a fresh account and redirects to /chats", async ({ page }) => {
    const uniqueEmail = `e2e-register-${Date.now()}@example.com`;
    const password = "correct horse battery";

    await page.goto(REGISTER_PATH);

    await page.getByLabel("Name").fill("E2E Register");
    await page.getByLabel("Email").fill(uniqueEmail);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByLabel("Confirm password").fill(password);

    await page.getByRole("button", { name: "Create account" }).click();

    // The redirect proves the user row was inserted with a valid uuid id.
    await page.waitForURL("**/chats", { timeout: 15000 });
    await expect(page).toHaveURL(/\/chats/);
  });
});
