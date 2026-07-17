# PRD — External-Sourced Field Values

- **Status**: Draft
- **Date**: 2026-07-17
- **Author**: rbrasier
- **Target version**: 2.5.0  (bump: MINOR — new feature + additive schema; see `docs/guides/versioning.md`)

## 1. Problem

A template author fixes a field's allowed values by hand-typing them into the
Word tag: `{{ Department (options: Finance, HR, Legal) }}`. These lists drift
from the organisation's real data, cannot hold hundreds of live values (cost
centres, GL codes, the full department tree), and must be re-edited in every
template when the org changes. The operator then picks from a stale list, and
the generated document records only a display label — never the underlying code
a downstream system needs.

## 2. Users / Personas

- **Admin / configurator** — registers a named lookup source once (which
  directory/list, which field is the display, which is the key), tests it, and
  reuses it across many templates. No code.
- **Template author** — references a registered source by name in a tag instead
  of typing values: `{{ Department (options-source: departments) }}`.
- **Operator** (procurement officer, HR manager) — picks a value with
  type-ahead search against live data; never sees an out-of-date list.
- **Auditor / reporting consumer** — reads back both the human label
  (`Finance`) and the stable key (`FIN-001`) that was valid at the time.

## 3. Goals

- An admin can **CRUD** named lookup sources from a new admin menu entry and
  **test** each one (fetch a sample, see resolved display + key) before use.
- A source declares a **display field** and an **optional key field**. When both
  exist, the chosen value stores **both** — the display in the document, the key
  alongside it in the backend for automatic reporting.
- A template tag `(options-source: <name>)` binds a field's valid set to a
  registered source; it is mutually exclusive with inline `(options: …)`.
- A companion accessor `Field.key` (e.g. `{{ Department.key }}`) renders the
  stored key of the value chosen for `Department`.
- The value set is **size-adaptive**: small sets inline into the AI prompt and a
  dropdown; large sets switch to server-side type-ahead + propose-then-verify.
- Sets are **cached**; each output **snapshots** the source name + version that
  validated it; an outage degrades to last-known-good with a flag (never a hard
  stop).
- Validation is **hybrid**: live type-ahead in the manual picker, plus an
  authoritative **batch re-check of every external-sourced field at step end**.

## 4. Non-goals

- Arbitrary HTTP/API connectors configured per source (the port is designed to
  admit them later, but only `directory`-backed and admin-`managed` source kinds
  ship now).
- Writing back to the external system, or two-way sync.
- Cascading / dependent lookups (e.g. sub-department filtered by department).
- Free-typing the source name in a tag without a registered source (the name
  must resolve to a registry row at template-upload time).
- Per-operator personalised value sets / row-level security on the source.

## 5. Key entities

| Entity | Lives in | New / existing | Notes |
| ------ | -------- | -------------- | ----- |
| `LookupSource` | `packages/domain/src/entities/lookup-source.ts` | new | Registry row: `name` (slug used in tags), `label`, `kind` (`directory` \| `managed`), `config`, `displayField`, `keyField?`, `cacheTtlSeconds`, `enabled`. |
| `ValueSetEntry` | `packages/domain/src/entities/lookup-source.ts` | new | `{ display: string; key?: string }` — one resolved option. |
| `IValueSetProvider` | `packages/domain/src/ports/value-set-provider.ts` | new | `search`, `list`, `resolve` (batch) over a named source. Result pattern. |
| `TemplateField.optionsSource` | `packages/domain/src/entities/template-field.ts` | existing (add field) | Optional `string` ref; mutually exclusive with `options`. |
| `StepOutputField.valueKey` / `sourceRef` | `packages/domain/src/entities/session-step-output.ts` | existing (add fields) | Optional key + `{ name, version, fetchedAt }` snapshot; rides existing jsonb — no output-table migration. |
| `FieldValueSnapshot` | (inline on `StepOutputField`) | new (type) | The audit record of which source/version validated the value. |

## 6. User stories

1. As an **admin**, I can open **Configuration → Lookup Sources**, add a source
   named `departments` backed by the directory, choose `department` as the
   display field and `department_code` as the key field, click **Test**, and see
   sample rows resolve to `Finance / FIN-001`.
2. As a **template author**, I can write `{{ Department (options-source:
   departments) }}` and, on upload, get a clear error if no source named
   `departments` is registered.
3. As an **operator**, I can type "fin" in the Department field and pick
   `Finance` from live results, even when there are 4,000 departments.
4. As an **operator**, when the AI pre-fills `Department` from my documents, the
   step-end check either confirms it against the live set or flags it for me to
   correct before the step completes.
5. As a **reporting consumer**, I can read the generated document's `Department`
   = `Finance` *and* `Department.key` = `FIN-001` from the stored output without
   a second lookup.
6. As an **auditor**, I can see that the value was validated against
   `departments` version `2026-07-01T09:00Z`, even if the department was later
   renamed.

## 7. Pages / surfaces affected

- `/admin/settings` (**Configuration**) — new **Lookup Sources** section: list,
  create, edit, delete, **Test**.
- Node config / template review picker — external-sourced fields render a
  type-ahead search control instead of a static dropdown.
- Document template upload — parser accepts `(options-source: NAME)` and
  validates the name against the registry.
- tRPC: `admin.lookupSource.*` (list / create / update / delete / test);
  `flow` value picker gains a `lookupSource.search` query.
- `apps/api` — no new public endpoint; resolution runs inside existing
  generate/validate use-cases via the new port.

## 8. Database changes

| Table | Change | Prefix valid? |
| ----- | ------ | ------------- |
| `kb_lookup_sources` | NEW — registry (name unique, label, kind, config jsonb, display_field, key_field nullable, cache_ttl_seconds, enabled) | yes (`kb_` — curated reference data) |
| `kb_lookup_source_entries` | NEW — resolved/cached entries (source_id fk, display, key nullable, version, fetched_at); one active version per source | yes (`kb_`) |
| `app_session_step_outputs` | **No column change** — key + source snapshot ride the existing `fields` jsonb (`StepOutputField.valueKey`, `sourceRef`) | n/a |

All new tables carry `id` (uuid), `created_at`, `updated_at`; columns
snake_case.

## 9. Architectural decisions

- **New**: ADR-032 — External-sourced field values (named registry, the
  `IValueSetProvider` port, display+key model and the `Field.key` accessor,
  size-adaptive prompting, cache + snapshot degradation, hybrid step-end
  validation).
- **Assumes / extends**: ADR-018 (external directory degrades gracefully) — the
  same fail-degraded philosophy applied to constraint sets, hardened with a
  snapshot so audit survives an outage.
- Reuses the `packages/adapters/src/directory` adapter pattern
  (`IPeopleDirectory`, Graph/Entra + HR) for the `directory` source kind.

## 10. Acceptance criteria

- [ ] Admin can create / edit / delete a lookup source and **Test** it (sample
      rows resolve to display + key) from **Configuration**.
- [ ] A source stores a display field and an optional key field; a source with
      no key still works (display only).
- [ ] `(options-source: NAME)` parses into `TemplateField.optionsSource`; using
      it with inline `(options: …)` is a `VALIDATION_FAILED` error; an unknown
      `NAME` fails at upload with a clear message.
- [ ] When a key exists, the resolved output stores both display and key;
      `{{ Field.key }}` renders the key in the generated document.
- [ ] Small sets (≤ threshold) inline into the AI prompt and render a dropdown;
      large sets omit inline values and render a type-ahead search.
- [ ] Operator type-ahead returns live results via `IValueSetProvider.search`.
- [ ] At step end, every external-sourced field is batch-resolved: valid values
      canonicalise (display + key attached), invalid ones are flagged and block
      completion until corrected.
- [ ] Each stored value snapshots `{ sourceName, version, fetchedAt }`.
- [ ] Source outage serves last-known-good entries with a flag; generation /
      validation never hard-fails on the external call (Result pattern, fail
      degraded).
- [ ] Architecture boundaries intact (`domain` dependency-free; port in domain,
      adapters implement; Result at all boundaries).
- [ ] `VERSION` = `package.json#version` = `2.5.0`; `./validate.sh` passes.

## 11. Out of scope / future work

- Generic HTTP/API source kind (port already shaped for it).
- Dependent / cascading lookups and server-side filtering by another field.
- Scheduled background cache refresh (v1 refreshes lazily on TTL expiry / manual
  Test); a job-queue refresh (`job_`) is a follow-up.
- Bulk re-validation of historical outputs after a source changes.

## 12. Risks / open questions

- **Inline threshold** — the exact cut-off for "small enough to inline into the
  prompt" (proposed 50). Confirm at build.
- **`Field.key` companion** — whether it is a first-class parsed field or a
  render-time accessor resolved from the parent field's stored key. Leaning
  render-time to avoid a second required field. Pin down in the ADR/build.
- **Casing / duplicate displays** — two entries sharing a display but different
  keys (e.g. two "Operations"). Resolution must disambiguate by key in the
  picker and reject an ambiguous free-typed/AI value at step end.
- **Cache staleness vs audit** — TTL choice trades freshness against churn in
  the snapshot version; document the default.
