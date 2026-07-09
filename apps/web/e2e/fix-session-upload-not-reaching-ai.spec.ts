import { expect, test } from "@playwright/test";

// E2E for the bug fix: a deliberately-attached session upload must reach the AI
// even when the user's message is only loosely related to the document body.
// (docs/development/implemented/alpha-1/v1.47.1/fix-session-upload-not-reaching-ai.md)
//
// Driven by the /e2e (Playwright MCP) skill against a running stack — it is
// excluded from the vitest unit run and requires real embeddings + an AI key,
// because the regression is in similarity-gated retrieval. The flow under test:
//   1. Attach a short document whose body is a request ("purchase Office 365
//      licences… about $99 each").
//   2. Send a loosely-worded message ("Here is the request I've been asked to
//      do") that is semantically dissimilar to the document body.
//   3. The assistant's reply reflects the document content (mentions the
//      licences / cost) instead of claiming it cannot see any details.
//
// On the unfixed code the upload chunk scored below the shared 0.5 threshold and
// was filtered out, so the AI answered "I don't see the request details". With
// the permissive session-upload threshold (0.2) the chunk is retrieved.
//
// Assumes a seeded active session (see apps/web/src/lib/e2e-fixtures.ts). Set
// E2E_SESSION_PATH to override the path.

const SESSION_PATH = process.env.E2E_SESSION_PATH ?? "/chats/e2e-seed-session";

const DAVE_EMAIL = [
  "Hey,",
  "",
  "Can you organise to purchase an Office 365 licences for the team? It should be about $99 each.",
  "",
  "Cheers",
  "Dave",
].join("\n");

test.describe("session upload reaches the AI", () => {
  test("a loosely-worded message still consults the attached document", async ({ page }) => {
    await page.goto(SESSION_PATH);

    const attachButton = page.getByRole("button", { name: /attach a file for context/i });
    test.skip(
      !(await attachButton.isVisible().catch(() => false)),
      "Composer is read-only on this session — no attach control",
    );

    // Attach the Dave email as a context document and wait for its pill.
    await page.locator('input[type="file"]').setInputFiles({
      name: "Dave.docx",
      mimeType: "text/plain",
      buffer: Buffer.from(DAVE_EMAIL),
    });
    await expect(page.getByText("Dave.docx").first()).toBeVisible();

    // Send a message that does not itself mention the request details.
    const composer = page.getByRole("textbox");
    await composer.fill("Here is the request I've been asked to do");
    await composer.press("Enter");

    // The assistant's latest reply should reflect the document body — proving the
    // attached upload reached the prompt despite the loosely-worded message.
    const reply = page.getByText(/office 365|licen|\$?99/i).last();
    await expect(reply).toBeVisible({ timeout: 30_000 });

    // And it must NOT fall back to "I can't see the request details".
    await expect(page.getByText(/don't see the request details/i)).toHaveCount(0);
  });
});
