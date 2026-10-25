# Forward-merge — release/alpha-2 (0.28.40–0.28.44) into main

Source: scheduled forward-merge (`/release` Operation C, CONTRIBUTING §2), widened at the
maintainer's request from "fixes only" to the whole release line. No issue.
Version: 0.40.2 → 0.40.3 (PATCH, as requested for the merge-back).

## What came across

Everything on `release/alpha-2` since the last forward-merge (v0.28.39, `a8990d2`) — 65
commits, merged with `git merge`, so each release-line commit stays traceable in history.
Their own docs stay where they were written, under `implemented/alpha-2/v0.28.40` …
`v0.28.44`.

- **Unattended automation** (v0.28.41, ADR-063/064/065): Event Watch, webhook start, AI task
  and Email steps, run history, the stalled-run sweep, the ParlView and SMTP mocks.
- **Chat activity** (v0.28.43–44): "Thinking…" / "Consulting ParlView…" while a turn waits,
  the proactive tool-lookup prompt, and the tool note placed after the user's message.
- **Fixes**: body-parser, vite, vitest, follow-redirects and zod advisories; the Semgrep scan
  that actually runs; every GitHub Action pinned to a SHA; the container running as `node`;
  Dependabot cooldown; the security-waiver expiry check (`waiver-check.mjs`, §11c) and its
  weekly workflow; e2e route warm-up and heap ceilings.
- On top, for `main` only: `deploy/lambda`'s lockfile takes body-parser 2.4.0, and the lambda
  CI job's three actions are pinned like the rest — both needed for the security scan to pass.

## How the conflicts were resolved

`main`'s shape won; what each release change does was kept.

- **Package scope.** `main` renamed `@rbrasier/*` to `@wayfinder/*` (v0.35.1); every import
  the release line added was renamed to match.
- **Migrations.** The release line's `0046`–`0048` collided with `main`'s chain. The schema was
  merged in `db/schema/*.ts` and regenerated with `drizzle-kit generate` as
  `0057_unattended_automation.sql` — byte-identical to alpha-2's `0046`, which confirms the
  schema merge — and the seed data as custom `0058_seed_unattended_automation.sql`, both with
  their `-- data-impact:` lines. alpha-2's `0048_mcp_stored_credentials` was dropped: see below.
- **MCP credentials and governance.** alpha-2 stored MCP bearer tokens in a new
  `credential_encrypted` column, kept the `MCP_CRED_*` fallback, and let "external" servers run
  in flows. `main` already replaced all of that with ADR-062 — `credential_ciphertext` and
  custom headers through `DrizzleMcpServerSecretStore`, the `McpSdkClient`, and data
  classification where `external-write` servers never run in a flow. `main`'s version was kept
  throughout (entity, repository, use cases, router, admin page, picker, run-mcp-node), and
  alpha-2's edit dialog, legacy-credential source and `ai-sdk-mcp-client` were not carried. The
  a11y spec for that dialog was dropped with it.
- **MCP tool pre-pass.** alpha-2's "keep what the tools returned before the time limit" fix was
  ported onto `main`'s prepass, which already collects a record per call: an abort with records
  in hand returns them and bills the completed rounds. Tests rewritten against `main`'s client
  and tool cache.
- **Chat turn.** `runMcpToolPrepass` now returns the rendered tool results (with `main`'s
  numbered sources), the numbered citations, and a deferred `recordAudit`. The route builds
  the prompt inside `prepareTurn`, passing the results as `toolResults` and the citations on
  `PreparedTurn`, so citations (ADR-062 §6), tool progress events (ADR-062 §4) and the
  "Consulting…" annotation all survive. The AI task and step opener publish `tool.progress`
  on the session bus too.
- **Chat feed.** One activity row: `main`'s per-tool progress label when a tool is running,
  otherwise alpha-2's "Thinking…" / "Consulting …"; the queued-MCP-step wait and the
  background step activity each keep their own row.
- **Step picker.** alpha-2 stopped offering MCP Tool, letting the AI task supersede it. On
  `main` it stays offered beside AI task and Email: `main`'s MCP Tool is the queued,
  verbatim-governed call ADR-062 built, which the AI task does not replace.
- **Sessions.** `main`'s test-run `mode` and alpha-2's `origin` / trigger fields both reach
  `StartSession` and the repository; the `app_sessions` indexes keep `mode` and add the
  trigger-source index.
- **Elsewhere.** Both sides kept in the sidebar (embeddings attention + Event Watch badge), the
  e2e seed (extraction + automation fixtures), the mocks server, the session-event union, the
  settings router and `validate.sh` (waiver check §11c, Semgrep now §11d). `http/index.ts`
  exports only the outbound client, because `lookups/` already exports an `isBlockedAddress`.
- **Size ceilings.** The two lines' growth together pushed two files over `validate.sh`'s
  limits: the flow config page's flag queries moved to `_use-step-feature-flags.ts`, and the
  opening message's external-field tests to `initial-message-external-fields.test.ts`.
  `.trivyignore` carried the zod waiver twice; one entry is kept.

## Upgrading an alpha-2 database

A deployment that ran alpha-2's `0048` holds tokens in `credential_encrypted`, which `main`'s
schema does not read. As with `main`'s own `0056`, those servers need their token re-entered
on Admin → MCP servers after moving to the alpha-3 line.

## Regression guard

Typecheck, lint (no errors) and unit tests pass across every package. The release line's own
tests came across with its changes; the merged surfaces are covered by
`mcp-tool-prepass.test.ts` (partial results past the deadline), `mcp-turn-helpers.test.ts`
(main's citation rendering + alpha-2's proactive prompt, deferred audit and activity), and
`execute-turn.test.ts` (citations and audit order through `PreparedTurn`).

**E2E:** the release line's automation, a11y and chat-activity specs run in CI; nothing new.
