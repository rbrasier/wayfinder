# Phase — External-Sourced Field Values

- **Status**: Awaiting review
- **Target version**: 2.5.0  (bump: MINOR — new feature + additive `kb_` tables; no output-table migration)
- **PRD**: `docs/development/prd/external-field-values.prd.md`
- **ADRs**: ADR-032 (registry, `IValueSetProvider` port, display/key model, size-adaptive prompting, cache + snapshot, hybrid validation); extends ADR-018 (fail-degraded external lookup)
- **Depends on**: existing directory adapters (`packages/adapters/src/directory`, `IPeopleDirectory`), template-field parser (`packages/domain/src/entities/template-field.ts`), field resolution (`packages/application/src/services/resolve-field-values.ts`), step-output jsonb (`StepOutputField`)

## 1. Problem

Field option lists are static text in Word tags — they drift, cannot hold large
live sets, and record only a label, never the underlying code. Admins need to
register a named source once (choosing a display field and an optional key
field, with a Test action); authors reference it as `(options-source: NAME)`;
operators pick from live values; and the output stores both label and key for
automatic reporting. See the PRD for full detail.

## 2. Goals

- New **Configuration → Lookup Sources** admin surface: CRUD + **Test**.
- A source declares `displayField` and optional `keyField`; both are stored on
  the output when a key exists.
- `(options-source: NAME)` binds a field's valid set to a registered source;
  mutually exclusive with inline `(options: …)`.
- `{{ Field.key }}` renders the stored key of the chosen value.
- Size-adaptive: small sets inline into the AI prompt + dropdown; large sets use
  type-ahead + step-end verify.
- Cache + snapshot; fail degraded on outage.
- Hybrid validation: live type-ahead + authoritative step-end batch resolve.

## 3. Non-goals

Generic HTTP source kind, write-back/sync, cascading lookups, background refresh
job, bulk re-validation of historical outputs. (PRD §4 / §11.)

## 4. Approach

Build strictly bottom-up (domain → application → adapters → web), test file
before implementation file (CLAUDE.md). The port lives in `domain`; adapters
implement the `directory` and `managed` kinds. The output snapshot rides the
existing `StepOutputField` jsonb, so the only schema change is two additive `kb_`
tables. All boundaries return the Result pattern; the external call fails
degraded to last-known-good, never a throw.

## 5. Key entities / files

| Layer | File | Change |
|-------|------|--------|
| domain | `packages/domain/src/entities/lookup-source.ts` | new — `LookupSource`, `LookupSourceKind` (`directory`\|`managed`), `NewLookupSource`, `ValueSetEntry` (`{ display; key? }`) |
| domain | `packages/domain/src/ports/value-set-provider.ts` | new — `IValueSetProvider` (`search`, `list`, `resolve`), `ResolveOutcome` (`matched: ValueSetEntry[]`, `unresolved: string[]`, `stale: boolean`, `version`) |
| domain | `packages/domain/src/entities/template-field.ts` | add optional `optionsSource?: string`; parse `(options-source: NAME)`; reject combining with `options`/type/`multi-options`; extend `describeTemplateFieldFormat` for external fields |
| domain | `packages/domain/src/entities/session-step-output.ts` | add optional `valueKey?: string` and `sourceRef?: { name; version; fetchedAt }` to `StepOutputField` |
| domain | `packages/domain/src/index.ts` | export new entities/port |
| application | `packages/application/src/services/resolve-field-values.ts` | inline small external sets for `ai` fields; leave large sets to step-end resolve |
| application | `packages/application/src/use-cases/document/structured-fields.ts` | when inlining, source small option lists via `IValueSetProvider.list` |
| application | `packages/application/src/use-cases/session/validate-external-fields.ts` | new — batch step-end resolve across all `optionsSource` fields; attach key + snapshot; return flagged/unresolved |
| application | `packages/application/src/use-cases/admin/lookup-source.ts` | new — CRUD + `test(sourceName)` returning a sample of resolved entries |
| adapters | `packages/adapters/src/db/schema/wayfinder.ts` | `kb_lookup_sources`, `kb_lookup_source_entries` (both with id/created_at/updated_at) |
| adapters | `packages/adapters/drizzle/<next>.sql` | migration: create the two `kb_` tables (no output-table change) |
| adapters | `packages/adapters/src/repositories/drizzle-lookup-source-repository.ts` | new — registry + cached-entry persistence |
| adapters | `packages/adapters/src/directory/directory-value-set-provider.ts` | new — `directory` kind over the existing Graph/HR directory |
| adapters | `packages/adapters/src/lookups/managed-value-set-provider.ts` | new — `managed` kind over `kb_lookup_source_entries` |
| adapters | `packages/adapters/src/lookups/caching-value-set-provider.ts` | new — TTL cache + last-known-good/stale wrapper (ADR-018 fail-degraded) |
| web | `apps/web/src/server/routers/admin/lookup-source.ts` | new tRPC — `list`/`create`/`update`/`delete`/`test` |
| web | `apps/web/src/server/routers/flow.ts` | add `lookupSource.search` query for the picker |
| web | `apps/web/src/app/(admin)/admin/settings/**` | Lookup Sources section: table, editor (kind, config, display/key field selectors), **Test** panel |
| web | `apps/web/src/components/canvas/field-value-selector.tsx` (and the review picker) | type-ahead control for external fields; dropdown for small inlined sets |
| web | `apps/web/src/lib/container.ts` | wire `IValueSetProvider` (caching → directory/managed) |
| lib | `lib/container.ts` (apps/api if applicable) | same wiring for the API side |

## 6. Implementation steps (test-first per CLAUDE.md)

1. **Domain — entities + port.** Add `lookup-source.ts` and
   `value-set-provider.ts`; add `optionsSource` to `TemplateField` and
   `valueKey`/`sourceRef` to `StepOutputField`. Export from `index.ts`. Domain
   stays dependency-free.

2. **Domain — parser.** Write `template-field.test.ts` cases first:
   (a) `(options-source: departments)` → `optionsSource: "departments"`, no
   `options`; (b) combining with `(options: …)` / a scalar type / `(multi-options:
   …)` → `VALIDATION_FAILED`; (c) `describeTemplateFieldFormat` for an external
   field with and without an inlined small set; (d) `Field.key` accessor tag
   parses/validates (render-time accessor, empty when no key). Then implement.

3. **Application — inline small sets.** Extend `resolve-field-values` /
   `structured-fields` so an `ai` external field with a small set has its options
   inlined via `IValueSetProvider.list`, and a large set does not. Tests: small →
   options in prompt; large → omitted; provider error → degrade, no throw.

4. **Application — step-end batch validate.** Write
   `validate-external-fields.test.ts` first: (a) all valid → canonicalised
   display + attached key + snapshot; (b) an invalid value → `unresolved`
   flagged, completion blocked; (c) duplicate display / distinct key →
   disambiguation by key, ambiguous free value rejected; (d) provider outage →
   last-known-good, `stale: true`, values accepted+flagged not blocked. Then
   implement.

5. **Application — admin use-case.** `lookup-source` CRUD + `test`; Result
   pattern. Tests cover unique `name`, key-field optional, `test` returns a
   bounded sample.

6. **Adapters — schema + migration + repo.** Add the two `kb_` tables, generate
   the migration, implement the repository. Repo test asserts registry round-trip
   and one-active-version-per-source for entries. Confirm **no** change to
   `app_session_step_outputs`.

7. **Adapters — providers.** Implement `directory` (reusing Graph/HR),
   `managed`, and the `caching` wrapper. Tests: `search`/`list`/`resolve` per
   kind; cache TTL + last-known-good on error (`stale: true`); Result at every
   boundary.

8. **Web — tRPC + wiring.** Add `admin.lookupSource.*` and `flow.lookupSource.
   search`; wire `IValueSetProvider` in `container.ts` (caching → directory /
   managed). Cover with router tests.

9. **Web — UI.** Configuration → Lookup Sources (table, editor with display/key
   field selectors, **Test** panel showing resolved `display / key`); type-ahead
   picker for external fields, dropdown for small inlined sets; surface step-end
   flagged fields for correction.

10. **Version + validate.** Bump `VERSION` and root `package.json#version` to
    `2.5.0`. Run `./validate.sh`; fix all failures. Move this phase doc to
    `docs/development/implemented/alpha-2/v2.5.0/` with an implementation summary
    (per the `to-be-implemented/` lifecycle).

## 7. Acceptance criteria

Mirror PRD §10. In particular:

- [ ] Admin can CRUD a lookup source and **Test** it (sample resolves to
      display + key) from **Configuration**.
- [ ] Source with a key stores both display and key on the output; a keyless
      source stores display only; both round-trip through the jsonb field.
- [ ] `(options-source: NAME)` parses to `optionsSource`; combining with inline
      options is `VALIDATION_FAILED`; unknown `NAME` fails at upload.
- [ ] `{{ Field.key }}` renders the stored key; empty when no key/non-external.
- [ ] Small sets inline into the AI prompt + dropdown; large sets use type-ahead
      and are verified at step end.
- [ ] Step-end batch resolves all external fields: valid canonicalise (display +
      key + snapshot), invalid block completion until corrected.
- [ ] Each stored value snapshots `{ name, version, fetchedAt }`.
- [ ] Source outage → last-known-good + stale flag; no hard failure (Result,
      fail degraded).
- [ ] Architecture boundaries intact (`domain` dependency-free; port in domain,
      adapters implement; Result at boundaries); only two additive `kb_` tables.
- [ ] `VERSION` = `package.json#version` = `2.5.0`; `./validate.sh` passes.

## 8. Risks / open questions

- Inline threshold for "small" sets (proposed 50) — confirm / make configurable.
- `Field.key` as render-time accessor vs parsed companion field (leaning
  render-time) — confirm in step 2.
- Cache TTL default and whether **Test** bumps the snapshot version each run or
  only on content change (snapshot churn).
- Duplicate display labels with distinct keys — picker disambiguation + reject
  ambiguous AI/free values at resolve.
- `managed` source entry editing: inline vs CSV import (inline for v1).
- Wiring `IValueSetProvider` on both `apps/web` and `apps/api` containers without
  duplicating cache state.
