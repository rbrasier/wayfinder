# Phase — External-Sourced Field Values

- **Status**: Awaiting review
- **Target version**: 0.31.0  (bump: MINOR — new feature + additive `kb_` tables; no output-table migration)
- **Base branch**: `main` (release line `alpha-3`)
- **PRD**: `docs/development/prd/external-field-values.prd.md`
- **ADRs**: ADR-050 (registry, `IValueSetProvider` port, display/key model, Test-time field selection, `api` kind + egress guards, size-adaptive prompting, cache + snapshot, hybrid validation); extends ADR-018 (fail-degraded external lookup)
- **Depends on**: existing directory adapters (`packages/adapters/src/directory`, `IPeopleDirectory`), template-field parser (`packages/domain/src/entities/template-field.ts`), field resolution (`packages/application/src/services/resolve-field-values.ts`), step-output jsonb (`StepOutputField`), settings encryption (`packages/adapters/src/config/settings-encryption.ts`)

## 1. Problem

Field option lists are static text in Word tags — they drift, cannot hold large
live sets, and record only a label, never the underlying code. Admins need to
register a named source once (testing it to discover its fields, then choosing a
display field and an optional key field); authors reference it as
`(options-source: NAME)`; operators pick from live values; and the output stores
both label and key for automatic reporting. See the PRD for full detail.

## 2. Goals

- New **Configuration → Lookup Sources** admin surface: CRUD + **Test**.
- **Test probes the source**: it returns the field names found on the sample
  records, the admin selects `displayField` and optional `keyField` from them,
  and the sample re-renders as `display (key)` before saving.
- Three kinds: `directory`, `managed`, and `api` (read-only HTTPS endpoint with
  SSRF guards, `credentialRef` secret storage, timeout and size caps).
- Both display and key are stored on the output when a key exists.
- `(options-source: NAME)` binds a field's valid set to a registered source;
  mutually exclusive with inline `(options: …)` / `(multi-options: …)`, but
  composes with `(multiple)`.
- `{{ Field.key }}` renders the stored key of the chosen value; `{{ Field }}`
  renders the display alone.
- Selection surfaces render keyed values as `display (key)`; the generated
  document does not.
- Size-adaptive: small sets (≤ 30) inline into the AI prompt + dropdown; large
  sets use type-ahead + step-end verify.
- Conversational questions preview at most **3** options (with an "ask to see the
  full list" affordance), independent of inlining.
- Cache + snapshot; fail degraded on outage.
- Hybrid validation: live type-ahead + authoritative step-end batch resolve.

## 3. Non-goals

Write-back/sync, cascading lookups, `api` cursor pagination, background refresh
job, CSV import for `managed` entries, bulk re-validation of historical outputs.
(PRD §4 / §11.)

## 4. Approach

Build strictly bottom-up (domain → application → adapters → web), test file
before implementation file (CLAUDE.md). The port lives in `domain`; adapters
implement the `directory`, `managed` and `api` kinds. The output snapshot rides
the existing `StepOutputField` jsonb, so the only schema change is two additive
`kb_` tables. All boundaries return the Result pattern; the external call fails
degraded to last-known-good, never a throw.

**Testing layer** (per `docs/guides/e2e-test-policy.md`): none of this work falls
into the six browser-only groups. Parser and entity rules are domain tests;
inlining, preview and step-end resolve are application tests; providers, the SSRF
guard and the repository are adapter tests; the Lookup Sources card and the
type-ahead picker are component tests; the routers get router tests. **No new
Playwright spec.**

## 5. Key entities / files

| Layer | File | Change |
|-------|------|--------|
| domain | `packages/domain/src/entities/lookup-source.ts` | new — `LookupSource`, `LookupSourceKind` (`directory`\|`managed`\|`api`), `NewLookupSource`, `ValueSetEntry` (`{ display; key? }`), `ValueSetProbe` (`{ fields; sample }`), `formatValueSetEntry` (`display (key)`) |
| domain | `packages/domain/src/ports/value-set-provider.ts` | new — `IValueSetProvider` (`search`, `list`, `resolve`, `probe`), `ResolveOutcome` (`matched: ValueSetEntry[]`, `unresolved: string[]`, `ambiguous: string[]`, `stale: boolean`, `version`) |
| domain | `packages/domain/src/entities/template-field.ts` | add optional `optionsSource?: string`; parse `(options-source: NAME)`; reject combining with `options`/`multi-options`/type; **allow** `(multiple)` (relax the `multiple && !options` guard at line ~368); extend `describeTemplateFieldFormat` for external fields |
| domain | `packages/domain/src/entities/session-step-output.ts` | add optional `valueKey?: string` and `sourceRef?: { name; version; fetchedAt }` to `StepOutputField`; note that `options` stays empty for external fields |
| domain | `packages/domain/src/index.ts` | export new entities/port |
| application | `packages/application/src/services/resolve-field-values.ts` | inline small external sets for `ai` fields; leave large sets to step-end resolve |
| application | `packages/application/src/use-cases/document/structured-fields.ts` | when inlining, source small option lists via `IValueSetProvider.list`, formatted `display (key)` |
| application | `packages/application/src/use-cases/session/validate-external-fields.ts` | new — batch step-end resolve across all `optionsSource` fields; attach key + snapshot; return flagged/unresolved/ambiguous |
| application | `packages/application/src/use-cases/lookup/lookup-source.ts` | new — CRUD + `test(draftConfig)` returning a `ValueSetProbe` (there is no `use-cases/admin/` folder; use-cases are grouped by area) |
| adapters | `packages/adapters/src/db/schema/kb.ts` | `kb_lookup_sources`, `kb_lookup_source_entries` (both with id/created_at/updated_at) — `kb_` tables live here, not in `wayfinder.ts` |
| adapters | `packages/adapters/drizzle/<next>.sql` | migration: create the two `kb_` tables (no output-table change). Express the unique `name` inline in `CREATE TABLE`, or declare `-- data-impact: preserved — new table, no existing rows`, because `migration-safety.test.ts` flags `ADD CONSTRAINT … UNIQUE` / `CREATE UNIQUE INDEX` regardless of table age |
| adapters | `packages/adapters/src/repositories/drizzle-lookup-source-repository.ts` | new — registry + cached-entry persistence |
| adapters | `packages/adapters/src/directory/directory-value-set-provider.ts` | new — `directory` kind over the existing Graph/HR directory |
| adapters | `packages/adapters/src/lookups/managed-value-set-provider.ts` | new — `managed` kind over `kb_lookup_source_entries` |
| adapters | `packages/adapters/src/lookups/api-value-set-provider.ts` | new — `api` kind: HTTPS-only fetch, `recordsPath`/`searchParam` mapping, credential from the secret store, timeout + response-size cap |
| adapters | `packages/adapters/src/lookups/outbound-url-guard.ts` | new — reject non-HTTPS and loopback/link-local/RFC1918 targets before any `api` call |
| adapters | `packages/adapters/src/lookups/caching-value-set-provider.ts` | new — TTL cache + last-known-good/stale wrapper (ADR-018 fail-degraded); reuse the existing version when refreshed content is unchanged |
| web | `apps/web/src/server/routers/lookup-source.ts` | new tRPC — `list`/`create`/`update`/`delete`/`test` (routers are flat under `routers/`; there is no `admin/` subfolder) |
| web | `apps/web/src/server/routers/flow.ts` | add `lookupSource.search` query for the picker |
| web | `apps/web/src/components/settings/lookup-sources-card.tsx` | new card, mounted from `apps/web/src/app/(admin)/admin/settings/page.tsx` alongside the other `*-card.tsx` sections: table, editor (kind, config, **Test**-driven display/key selectors), sample preview |
| web | `apps/web/src/components/canvas/field-value-selector.tsx` (and the review picker) | type-ahead control for external fields; dropdown for small inlined sets; render `display (key)` |
| web | `apps/web/src/lib/container.ts` | wire `IValueSetProvider` (caching → directory/managed/api) |
| api | `apps/api/src/container.ts` | same wiring for the API side (the file is `src/container.ts`, not `lib/container.ts`); each process keeps its own cache instance, backed by the shared `kb_lookup_source_entries` rows |

## 6. Implementation steps (test-first per CLAUDE.md)

1. **Domain — entities + port.** Add `lookup-source.ts` and
   `value-set-provider.ts`; add `optionsSource` to `TemplateField` and
   `valueKey`/`sourceRef` to `StepOutputField`. Include `formatValueSetEntry`
   (`display (key)`, display alone when keyless). Export from `index.ts`. Domain
   stays dependency-free.

2. **Domain — parser.** Write `template-field.test.ts` cases first:
   (a) `(options-source: departments)` → `optionsSource: "departments"`, no
   `options`; (b) combining with `(options: …)` / a scalar type / `(multi-options:
   …)` → `VALIDATION_FAILED`; (c) `(options-source: …) (multiple)` → accepted,
   `multiple: true`; (d) `describeTemplateFieldFormat` for an external field with
   and without an inlined small set; (e) `Field.key` accessor tag
   parses/validates (render-time accessor, empty when no key). Then implement.

3. **Application — inline small sets + conversation preview.** Extend
   `resolve-field-values` / `structured-fields` so an `ai` external field with a
   small set (≤ 30) has its options inlined via `IValueSetProvider.list`
   (formatted `display (key)`), and a large set does not. Add a preview helper
   that caps the conversationally-shown options at **3** with an "ask to see all
   N" affordance, independent of inlining. Tests: small → options in prompt;
   large → omitted; conversational surface shows ≤ 3 with the affordance; "show
   all" expands to the full set; provider error → degrade, no throw.

4. **Application — step-end batch validate.** Write
   `validate-external-fields.test.ts` first: (a) all valid → canonicalised
   display + attached key + snapshot; (b) an invalid value → `unresolved`
   flagged, completion blocked; (c) duplicate display / distinct key →
   disambiguation by key, ambiguous free value rejected; (d) provider outage →
   last-known-good, `stale: true`, values accepted+flagged not blocked; (e) a
   `multiple` external field resolves every selected value. Then implement.

5. **Application — admin use-case.** `lookup-source` CRUD + `test`; Result
   pattern. Tests cover unique `name`, display field required, key field
   optional, and `test` returning a `ValueSetProbe` (field names + bounded
   sample) for an **unsaved draft** config.

6. **Adapters — schema + migration + repo.** Add the two `kb_` tables to
   `schema/kb.ts`, generate the migration (watch the unique-index rule above),
   implement the repository. Repo test asserts registry round-trip and one-active
   -version-per-source for entries. Confirm **no** change to
   `app_session_step_outputs`.

7. **Adapters — providers.** Implement `directory` (reusing Graph/HR), `managed`,
   `api`, the `outbound-url-guard`, and the `caching` wrapper. Tests:
   `search`/`list`/`resolve`/`probe` per kind; the guard rejects `http://`,
   loopback, link-local and RFC1918 targets; timeout and size cap enforced;
   credential read from the secret store and never echoed back; cache TTL +
   last-known-good on error (`stale: true`); unchanged content reuses the
   version; Result at every boundary.

8. **Web — tRPC + wiring.** Add `lookupSource.*` and `flow.lookupSource.search`;
   wire `IValueSetProvider` in `apps/web/src/lib/container.ts` and
   `apps/api/src/container.ts` (caching → directory / managed / api). Cover with
   router tests, including that `test` never returns the stored secret.

9. **Web — UI.** `lookup-sources-card.tsx` under Configuration (table, editor,
   **Test** panel that probes, offers the returned field names as display/key
   selectors, and previews `display (key)`); type-ahead picker for external
   fields, dropdown for small inlined sets; surface step-end flagged fields for
   correction. Component tests, no Playwright spec.

10. **Version + validate.** Bump `VERSION` and root `package.json#version` to
    `0.31.0`. Run `./validate.sh`; fix all failures. Move this phase doc to
    `docs/development/implemented/alpha-3/v0.31.0/` with an implementation
    summary (per the `to-be-implemented/` lifecycle; the line is `alpha-3`
    because the base branch is `main`).

## 7. Acceptance criteria

Mirror PRD §10. In particular:

- [ ] Admin can CRUD a lookup source and **Test** it from **Configuration**;
      Test returns the source's field names + a bounded sample, the admin picks
      display and optional key from them, and the sample re-renders as
      `display (key)`.
- [ ] A source cannot be saved without a display field; keyless sources show the
      display alone.
- [ ] All three kinds resolve (`directory`, `managed`, `api`).
- [ ] An `api` source rejects non-HTTPS and loopback/link-local/RFC1918 targets,
      enforces a timeout and response-size cap, and keeps its secret in the
      credential store — never in `config`, never in a client response.
- [ ] Source with a key stores both display and key on the output; a keyless
      source stores display only; both round-trip through the jsonb field.
- [ ] `(options-source: NAME)` parses to `optionsSource`; combining with inline
      options is `VALIDATION_FAILED`; combining with `(multiple)` is accepted;
      unknown `NAME` fails at upload.
- [ ] `{{ Field.key }}` renders the stored key; empty when no key/non-external.
      `{{ Field }}` renders the display alone.
- [ ] Selection surfaces render `display (key)`; the generated document does not.
- [ ] Small sets (≤ 30) inline into the AI prompt + dropdown; large sets use
      type-ahead and are verified at step end. `StepOutputField.options` is not
      populated for external fields.
- [ ] A conversational question previews at most 3 options with an "ask to see
      all" affordance; requesting the full list expands it; the cap is
      independent of inlining.
- [ ] Step-end batch resolves all external fields: valid canonicalise (display +
      key + snapshot), invalid block completion until corrected, ambiguous
      values rejected.
- [ ] Each stored value snapshots `{ name, version, fetchedAt }`; a refresh with
      unchanged content reuses the existing version.
- [ ] Source outage → last-known-good + stale flag; no hard failure (Result,
      fail degraded).
- [ ] Architecture boundaries intact (`domain` dependency-free; port in domain,
      adapters implement; Result at boundaries); only two additive `kb_` tables.
- [ ] `VERSION` = `package.json#version` = `0.31.0`; `./validate.sh` passes.

## 8. Risks / open questions

- Inline threshold (30) and conversation preview cap (3) are hard-coded constants
  for this version — not configurable.
- The `api` kind is the product's first admin-controlled outbound URL: SSRF,
  credential handling, untrusted response shapes, and a slow endpoint stalling a
  step. `outbound-url-guard` plus the timeout/size caps are the mitigation and
  need their own adapter tests (ADR-050 §2a).
- Preview affordance: confirm the "ask to see all N" wording and the trigger
  phrase(s) that expand to the full list.
- Duplicate display labels with distinct keys — the `display (key)` convention
  handles the picker; ambiguous AI/free values are rejected at resolve.
- `managed` source entry editing: inline vs CSV import (inline for v1).
- Both containers wire their own caching provider instance; shared state lives in
  `kb_lookup_source_entries`, so two processes can hold different in-memory TTL
  windows over the same rows. Acceptable for v1 — confirm no test asserts
  cross-process cache coherence.

## 9. Resolved since first draft

- **Version**: `2.5.0` was invalid (pre-1.0 rule — every version is
  `0.MINOR.PATCH`) and already taken by `implemented/alpha-2/v2.5.0/`. Now
  `0.31.0`, a MINOR bump from the current `0.30.0`.
- **Docs folder**: `implemented/alpha-3/v0.31.0/`, not `alpha-2` — the base
  branch is `main`.
- **ADR number**: renumbered 032 → **050**. Three ADRs held 032, and the accepted
  repeating-groups ADR-032 is cited from `session-step-output.ts` — the exact
  interface this phase extends.
- **`Field.key` mechanics**: settled as a render-time accessor (ADR-050 §3), no
  longer an open question.
- **Cache TTL**: default 3600s; a refresh writes a new version only when content
  changes, so Test runs do not churn the snapshot (ADR-050 §5).
- **File paths**: corrected to the real tree — `schema/kb.ts`,
  `use-cases/lookup/`, flat `routers/`, `components/settings/*-card.tsx`,
  `apps/api/src/container.ts`.
