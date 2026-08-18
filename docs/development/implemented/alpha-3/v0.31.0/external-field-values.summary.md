# Implementation Summary — External-Sourced Field Values (v0.31.0)

- **Phase doc**: `external-field-values.phase.md` (this folder)
- **PRD**: `docs/development/prd/external-field-values.prd.md`
- **ADR**: ADR-050 — External-sourced field values (renumbered from 032 during review)
- **Version bump**: **MINOR**, `0.30.0` → `0.31.0` (new feature + additive schema)
- **Base branch**: `main` (release line `alpha-3`)

## What was built

An admin registers named **lookup sources** under Configuration → Directory &
security, tests one to discover what fields it returns, and picks which field is
the human label and which is the stable key. A template author binds a field's
valid set with `{{ Department (options-source: departments) }}`. Operators pick
from live values by type-ahead, and every external value is re-resolved against
its source when the step completes — attaching the key and a
`{ name, version, fetchedAt }` audit snapshot to the stored output.
`{{ Department.key }}` renders the code in the generated document. A source
outage degrades to the last-known-good set rather than halting the workflow.

Three source kinds ship: `directory` (the federated people directory),
`managed` (admin-entered rows), and `api` (a read-only HTTPS endpoint).

## Files created

**domain**
- `entities/lookup-source.ts` (+ test) — `LookupSource`, `ValueSetEntry`,
  `ValueSetProbe`, `FieldValueSnapshot`, `formatValueSetEntry`,
  `previewValueSetEntries`, `entriesMatchVersion`, `validateNewLookupSource`,
  `isValidLookupCredentialRef`, and the `30` / `3` / `3600` / `10` constants
- `ports/value-set-provider.ts` — `IValueSetProvider`, `ResolveOutcome`
- `ports/lookup-source-repository.ts` — `ILookupSourceRepository`, `CachedValueSet`
- `entities/template-field-value.ts` — value validation, extracted from
  `template-field.ts` so that file stays under the 800-line ceiling

**application**
- `use-cases/session/validate-external-fields.ts` (+ test)
- `use-cases/lookup/lookup-source.ts` (+ test) — CRUD, `TestLookupSource`,
  `ValidateTemplateLookupSources`
- `services/external-options.ts` (+ test) — `inlineExternalOptions`,
  `buildExternalOptionsPreview`

**adapters**
- `lookups/value-set-kind-adapter.ts` — the per-kind seam plus `recordsToEntries`
- `lookups/outbound-url-guard.ts` (+ test)
- `lookups/api-value-set-provider.ts` (+ test)
- `lookups/managed-value-set-provider.ts` (+ test)
- `lookups/caching-value-set-provider.ts` (+ test)
- `directory/directory-value-set-provider.ts` (+ test)
- `repositories/drizzle-lookup-source-repository.ts` (+ test)

**apps/web**
- `server/routers/lookup-source.ts` (+ test)
- `components/settings/lookup-sources-card.tsx` (+ test)
- `components/chat/lookup-value-input.tsx` (+ test)
- `lib/container-lookup-sources.ts`

## Files modified

- `domain`: `template-field.ts` (options-source parsing, `(multiple)`
  composition, external `describeType`, `templateFieldToLine` round-trip, the
  `Field.key` accessor check in `parseTemplateFields`),
  `session-step-output.ts` (`valueKey`, `sourceRef`), barrels
- `application`: `structured-fields.ts` and `resolve-field-values.ts` (optional
  `valueSetProvider`), `render-data.ts` (`<field>_key` accessor entries),
  `step-output-fields.ts` (key + snapshot, no options for external fields),
  `generate-document.ts` (the step-end resolve)
- `adapters`: `db/schema/kb.ts` (two tables)
- `apps/web`: `container.ts`, `container-document-use-cases.ts`,
  `container-people-directory.ts` (people use-cases moved in),
  `server/router.ts`, `app/(admin)/admin/settings/page.tsx`,
  `components/chat/document-edit-dialog.tsx`,
  `app/api/flows/[id]/nodes/[nodeId]/template/route.ts`

## Migrations

`packages/adapters/drizzle/0045_flat_ares.sql` — creates `kb_lookup_sources` and
`kb_lookup_source_entries`. Purely additive, so no `-- data-impact:` declaration
is required: the unique `name` is expressed inline in `CREATE TABLE`, which
`migration-safety.test.ts` does not flag (only `ADD CONSTRAINT … UNIQUE` and
`CREATE UNIQUE INDEX` need one). `app_session_step_outputs` is unchanged — the
key and snapshot ride the existing `fields` jsonb.

## Security controls

- `credentialRef` must name an environment variable in the `LOOKUP_CRED_`
  namespace, mirroring the MCP guard. Without it an admin could point a source
  at `DATABASE_URL` and have it sent as a bearer token to a host they control.
- Every `api` call is guarded: HTTPS only, and the target rejected if it is —
  or resolves to — loopback, link-local (including the cloud metadata address)
  or RFC1918 space. `GET`/`POST` only, 10s timeout, 5MB response cap.
- Localhost egress is permitted outside production only.
- The registry never returns a secret, only the reference naming one.

## Tests

No Playwright spec was added: none of this behaviour falls into the six groups
in `docs/guides/e2e-test-policy.md`. Coverage sits at the layer that owns each
rule — domain (parser, entity rules), application (step-end resolve, inlining,
preview, CRUD, generation), adapters (three kinds, egress guard, cache,
repository), and component/router level in `apps/web`. `./validate.sh` passes
25/25.

## Known limitations

1. **The conversation preview is not yet wired into the live chat turn.**
   `buildExternalOptionsPreview` is implemented and tested, but the
   conversational prompt is assembled in
   `packages/adapters/src/agents/flow-session-graph.ts`, which `validate.sh`
   check 24 protects (ADR-048). Wiring it there needs that guard's base ref
   moved deliberately, so it was left out rather than broken. Today the model
   receives an inlined small set and the operator sees the picker; the 3-option
   conversational cap awaits that wiring.
2. **`apps/api` is deliberately not wired.** That container runs no
   field-resolution path — no `resolveFieldValues`, no `extractStructuredFields`,
   no document generation — so a provider there would be dead code. This also
   removes the "two containers, two cache windows" risk the phase doc raised.
3. **The step-end resolve runs on the document-generation path.** Structured
   capture (`CaptureStructuredStepOutput`) does not yet re-resolve; a structured
   step with an external field stores the value without a key or snapshot.
4. **`managed` source entries have no editing UI yet.** The kind, its adapter
   and its storage all work, but rows must be seeded another way; inline editing
   was scoped as the follow-up the ADR describes.
5. **`api` pagination is a single bounded page** (`pageLimit`, default 500) for
   listing; large sets rely on `search`.

## Deviations from the approved summary

- The operator type-ahead landed in `components/chat/lookup-value-input.tsx`
  wired into `document-edit-dialog.tsx` — the component operators actually use
  to fill field values — rather than `canvas/field-value-selector.tsx`, which
  configures a field's *value source* at authoring time.
- `search` lives on the `lookupSource` router rather than under `flow`, keeping
  every lookup procedure in one place.
- `ResolveOutcome.matched` pairs each input with its entry instead of returning
  bare entries: canonicalisation rewrites the value, so a caller cannot re-derive
  the pairing by comparing strings.
- Two additions the plan did not anticipate, both security-motivated: the
  `LOOKUP_CRED_` namespace check, and `ValidateTemplateLookupSources` so an
  unregistered source name fails at template upload as the PRD requires.
- The people use-cases moved into `container-people-directory.ts` to keep
  `container.ts` under the size ratchet while adding the new wiring.
