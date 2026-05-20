/**
 * helpers/base.ts
 *
 * Extended Playwright test fixture for Wayfinder E2E tests.
 *
 * Provides:
 *   - consoleLogs: captures ALL browser console messages (log, warn, error)
 *     so they appear in the HTML report alongside screenshots
 *   - AI mock: intercepts api.anthropic.com / api.openai.com / api.mistral.ai
 *     and returns fixture responses unless USE_REAL_AI=true
 */

import { test as base, expect, Page, Route } from '@playwright/test';
import {
  anthropicStreamResponse,
  openaiStreamResponse,
  MOCK_RESPONSES,
} from '../fixtures/ai-responses';

export type ConsoleMessage = {
  type: 'log' | 'info' | 'warning' | 'error' | 'debug';
  text: string;
  location: string;
  timestamp: number;
};

export type WayfinderFixtures = {
  /** All browser console messages captured during the test */
  consoleLogs: ConsoleMessage[];
  /** Page with AI mocking already set up */
  page: Page;
};

const USE_REAL_AI = process.env.USE_REAL_AI === 'true';

export const test = base.extend<WayfinderFixtures>({
  consoleLogs: async ({}, use) => {
    // Initialised per-test; populated by the page fixture below
    await use([]);
  },

  page: async ({ page, consoleLogs }, use) => {
    // ── 1. Capture all console output ─────────────────────────────────────
    page.on('console', (msg) => {
      consoleLogs.push({
        type: msg.type() as ConsoleMessage['type'],
        text: msg.text(),
        location: msg.location().url ?? '',
        timestamp: Date.now(),
      });
    });

    // Log uncaught page errors too
    page.on('pageerror', (err) => {
      consoleLogs.push({
        type: 'error',
        text: `[Uncaught] ${err.message}\n${err.stack ?? ''}`,
        location: 'page',
        timestamp: Date.now(),
      });
    });

    // ── 2. AI mock intercept ───────────────────────────────────────────────
    if (!USE_REAL_AI) {
      // Intercept Anthropic Messages API
      await page.route('**/api.anthropic.com/v1/messages**', mockAnthropicRoute);

      // Intercept OpenAI Chat Completions (also used by Mistral via compatibility)
      await page.route('**/api.openai.com/v1/chat/completions**', mockOpenAIRoute);
      await page.route('**/api.mistral.ai/v1/chat/completions**', mockOpenAIRoute);

      // Intercept Wayfinder's internal API route that proxies AI calls
      // (Next.js route handlers call the AI SDK which then calls the provider)
      await page.route('**/api/chat**', mockInternalChatRoute);
      await page.route('**/api/ai/**', mockInternalChatRoute);
    }

    await use(page);

    // ── 3. After test: attach console log summary to the report ───────────
    const errors = consoleLogs.filter(l => l.type === 'error');
    const warnings = consoleLogs.filter(l => l.type === 'warning');

    if (consoleLogs.length > 0) {
      const summary = consoleLogs
        .map(l => `[${l.type.toUpperCase()}] ${l.text}`)
        .join('\n');
      // This appears as an attachment in the HTML report
      await test.info().attach('console-logs.txt', {
        contentType: 'text/plain',
        body: Buffer.from(summary),
      });
    }

    if (errors.length > 0) {
      // Also attach just errors separately for quick scanning
      const errorSummary = errors.map(l => l.text).join('\n\n');
      await test.info().attach('console-ERRORS.txt', {
        contentType: 'text/plain',
        body: Buffer.from(errorSummary),
      });
    }

    // Annotate the test with counts so they appear in the report overview
    test.info().annotations.push({
      type: 'console',
      description: `${consoleLogs.length} messages (${errors.length} errors, ${warnings.length} warnings)`,
    });
  },
});

export { expect };

// ── AI mock route handlers ─────────────────────────────────────────────────

/**
 * Choose a mock response text based on the request body content.
 * Looks at the last user message to pick the most appropriate fixture.
 */
function pickResponse(body: unknown): string {
  try {
    const parsed = typeof body === 'string' ? JSON.parse(body) : body;
    const messages: Array<{ role: string; content: string }> =
      parsed?.messages ?? parsed?.body?.messages ?? [];
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    const text = (lastUser?.content ?? '').toLowerCase();

    if (text.includes('hello') || text.includes('hi') || messages.length <= 1) {
      return MOCK_RESPONSES.greeting;
    }
    if (text.includes('document') || text.includes('generate') || text.includes('report')) {
      return MOCK_RESPONSES.documentGeneration;
    }
    if (text.length > 0) {
      return MOCK_RESPONSES.acknowledgement;
    }
    return MOCK_RESPONSES.fallback;
  } catch {
    return MOCK_RESPONSES.fallback;
  }
}

async function mockAnthropicRoute(route: Route) {
  const body = route.request().postData();
  const responseText = pickResponse(body);

  await route.fulfill({
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'x-mock-ai': 'true',
    },
    body: anthropicStreamResponse(responseText),
  });
}

async function mockOpenAIRoute(route: Route) {
  const body = route.request().postData();
  const responseText = pickResponse(body);

  await route.fulfill({
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'x-mock-ai': 'true',
    },
    body: openaiStreamResponse(responseText),
  });
}

async function mockInternalChatRoute(route: Route) {
  // Wayfinder's Next.js API routes stream using the Vercel AI SDK data format
  // The Vercel AI SDK `useChat` hook consumes a specific text/plain stream format
  const body = route.request().postData();
  const responseText = pickResponse(body);

  // Vercel AI SDK stream format: '0:"<text chunk>"\n'
  const chunks = responseText.match(/.{1,15}/g) ?? [responseText];
  const streamBody = chunks
    .map(chunk => `0:${JSON.stringify(chunk)}\n`)
    .join('') + `d:{"finishReason":"stop","usage":{"promptTokens":10,"completionTokens":${chunks.length}}}\n`;

  await route.fulfill({
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'x-vercel-ai-data-stream': 'v1',
      'x-mock-ai': 'true',
    },
    body: streamBody,
  });
}
