# PRD — External-Sourced Field Values

- **Status**: Draft
- **Date**: 2026-07-17
- **Revised**: 2026-08-17 — `api` source kind brought into scope; Test-time
  display/key field selection and the `value (key)` presentation convention
  added; version corrected to `0.31.0`; ADR renumbered to ADR-050
- **Revised**: 2026-08-21 — narrowing brought into scope (§3, §6, §10): an
  operator's word now reaches the source's word through a matching ladder and an
  AI shortlist, and `api` pagination moved from non-goal to shipped. Delivered
  across `0.32.0` and `0.33.0`; see ADR-051.
- **Author**: rbrasier
- **Target version**: 0.31.0 (bump: MINOR — new feature + additive schema; see `docs/guides/versioning.md`). Narrowing follows in `0.32.0`–`0.33.0`.

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
  directory, list, or API), tests it, picks which returned field is the display
  and which is the key, and reuses it across many templates. No code.
- **Template author** — references a registered source by name in a tag instead
  of typing values: `{{ Department (options-source: departments) }}`.
- **Operator** (procurement officer, HR manager) — picks a value with
  type-ahead search against live data; never sees an out-of-date list.
- **Auditor / reporting consumer** — reads back both the human label
  (`Finance`) and the stable key (`FIN-001`) that was valid at the time.

## 3. Goals

- An admin can **CRUD** named lookup sources from a new admin menu entry and
  **test** each one before use.
- **Test drives configuration, not just connectivity.** Testing a source fetches
  a sample, reports the field names it found, and lets the admin **select the
  display field and the key field** from them. The sample re-renders as resolved
  pairs so the choice is verifiable, and both selections are saved on the source.
- Three source kinds ship: `directory` (existing Graph/Entra + HR adapters),
  `managed` (admin-entered rows), and `api` (a configured read-only HTTP
  endpoint returning JSON records).
- When a key exists, the chosen value stores **both** — the display in the
  document, the key alongside it in the backend for automatic reporting.
- **Presentation convention**: wherever a keyed value is shown for selection or
  verification (Test panel, dropdown, type-ahead results, conversational preview,
  flagged-field list), it renders as `display (key)` — `Finance (FIN-001)`. A
  keyless source shows the display alone. The generated document is exempt: it
  renders the display only, with the key reachable via `{{ Field.key }}`.
- A template tag `(options-source: <name>)` binds a field's valid set to a
  registered source; it is mutually exclusive with inline `(options: …)` and
  `(multi-options: …)`, but composes with `(multiple)` for multi-select.
- A companion accessor `Field.key` (e.g. `{{ Department.key }}`) renders the
  stored key of the value chosen for `Department`.
- The value set is **size-adaptive**: small sets (≤ 30) inline into the AI prompt
  and a dropdown; large sets switch to server-side type-ahead +
  propose-then-verify.
- In a **conversation** prompt, the assistant previews at most **3** options when
  asking the question (with an "ask to see the full list" affordance), regardless
  of how many are inlined into the model's context — the operator sees the full
  set only on request.
- Sets are **cached**; each output **snapshots** the source name + version that
  validated it; an outage degrades to last-known-good with a flag (never a hard
  stop).
- Validation is **hybrid**: live type-ahead in the manual picker, plus an
  authoritative **batch re-check of every external-sourced field at step end**.
- **A value that fails the step-end check ends in a choice, not a wall.** The
  operator's word is narrowed against the cached set through a ladder — exact,
  then the same value spelled differently, then word overlap and letter
  similarity — and, where those find nothing, a single bounded AI call that
  shortlists what they probably meant. The block names the candidates rather
  than only naming the failure.
- **An unambiguous correction costs no turn.** A value that differs from exactly
  one entry by punctuation, a plural, or a single typo resolves on its own,
  provided no other entry is a comparably close match. Everything less certain
  is shortlisted for the operator to confirm.
- **Narrowing proposes; it never decides.** A suggestion is never substituted
  for the operator's value, and whatever they confirm passes the same step-end
  resolve as any other value. An AI-shortlisted candidate never auto-resolves.
- An `api` source **walks its pages** so the cache holds the whole set, bounded
  by an admin-settable record ceiling and a fixed page cap.

## 4. Non-goals

- Writing back to the external system, or two-way sync. The `api` kind is
  read-only (`GET`/`POST`-for-search only).
- Cascading / dependent lookups (e.g. sub-department filtered by department).
- Free-typing the source name in a tag without a registered source (the name
  must resolve to a registry row at template-upload time).
- Per-operator personalised value sets / row-level security on the source.
- Scheduled background cache refresh (v1 refreshes lazily on TTL expiry or on
  demand via Test).
- **An AI choosing a value on the operator's behalf.** Narrowing shortlists;
  the operator confirms. Auto-accepting a shortlisted candidate is out of scope
  and would defeat the step-end check (§10, ADR-050 §6).
- **Narrowing on the structured-capture path** — the step-end re-check still
  runs on the document-generation path only.

*No longer a non-goal:* cursor/`next`-link pagination for the `api` kind, which
shipped in `0.32.0`. `list` walks offset, page-numbered or cursor pagination
under a record ceiling instead of fetching one bounded page.

## 5. Key entities

| Entity | Lives in | New / existing | Notes |
| ------ | -------- | -------------- | ----- |
| `LookupSource` | `packages/domain/src/entities/lookup-source.ts` | new | Registry row: `name` (slug used in tags), `label`, `kind` (`directory` \| `managed` \| `api`), `config`, `displayField`, `keyField?`, `credentialRef?`, `cacheTtlSeconds`, `enabled`. |
| `ValueSetEntry` | `packages/domain/src/entities/lookup-source.ts` | new | `{ display: string; key?: string }` — one resolved option. |
| `ValueSetProbe` | `packages/domain/src/entities/lookup-source.ts` | new | `{ fields: string[]; sample: Array<Record<string, string>> }` — what Test returns so the admin can pick display/key. |
| `IValueSetProvider` | `packages/domain/src/ports/value-set-provider.ts` | new | `search`, `list`, `resolve` (batch) over a named source, `match` (batch narrowing), plus `probe` over a draft config. Result pattern. |
| `ValueSetCandidate` / `MatchTier` | `packages/domain/src/entities/value-set-matching.ts` | new (0.32.0) | One narrowed suggestion and how it was found: `exact`, `normalised`, `token`, `fuzzy`, `inferred`. Only the first two, and a near-certain third, resolve without the operator. |
| `IValueSetShortlister` | `packages/domain/src/ports/value-set-shortlister.ts` | new (0.33.0) | One bounded AI call: given a query and the cached set, return the ranked candidates it believes were meant. Never consulted until the string ladder has failed. |
| `TemplateField.optionsSource` | `packages/domain/src/entities/template-field.ts` | existing (add field) | Optional `string` ref; mutually exclusive with `options`; composes with `multiple`. |
| `StepOutputField.valueKey` / `sourceRef` | `packages/domain/src/entities/session-step-output.ts` | existing (add fields) | Optional key + `{ name, version, fetchedAt }` snapshot; rides existing jsonb — no output-table migration. `options` stays empty for external fields. |
| `FieldValueSnapshot` | (inline on `StepOutputField`) | new (type) | The audit record of which source/version validated the value. |

## 6. User stories

1. As an **admin**, I can open **Configuration → Lookup Sources**, add a source
   named `departments` backed by the directory, click **Test**, see the fields
   the source returns, choose `department` as the display and `department_code`
   as the key, and watch the sample re-render as `Finance (FIN-001)` before I
   save.
2. As an **admin**, I can register an `api` source by pasting an HTTPS endpoint
   and selecting a stored credential, and get a clear error — not a hung request
   — if the URL is unreachable, internal, or returns something that is not a
   list of records.
3. As a **template author**, I can write `{{ Department (options-source:
   departments) }}` and, on upload, get a clear error if no source named
   `departments` is registered.
4. As an **operator**, I can type "fin" in the Department field and pick
   `Finance (FIN-001)` from live results, even when there are 4,000 departments,
   and tell two identically-named departments apart by their keys.
5. As an **operator**, when the AI pre-fills `Department` from my documents, the
   step-end check either confirms it against the live set or flags it for me to
   correct before the step completes.
6. As a **reporting consumer**, I can read the generated document's `Department`
   = `Finance` *and* `Department.key` = `FIN-001` from the stored output without
   a second lookup.
7. As an **auditor**, I can see that the value was validated against
   `departments` version `2026-07-01T09:00Z`, even if the department was later
   renamed.

## 7. Pages / surfaces affected

- `/admin/settings` (**Configuration**) — new **Lookup Sources** card: list,
  create, edit, delete, and a **Test** panel that probes the source, offers the
  returned field names as display/key selectors, and previews resolved pairs.
  An `api` source also carries a **Pagination** panel (style, parameter names,
  page size, cursor path, record ceiling), and every source carries the number of
  entries sent for AI matching.
- Node config / template review picker — external-sourced fields render a
  type-ahead search control instead of a static dropdown, showing `display (key)`.
- Document template upload — parser accepts `(options-source: NAME)` and
  validates the name against the registry.
- tRPC: `admin.lookupSource.*` (list / create / update / delete / test);
  `flow` value picker gains a `lookupSource.search` query.
- `apps/api` — no new public endpoint; resolution runs inside existing
  generate/validate use-cases via the new port.

## 8. Database changes

| Table | Change | Prefix valid? |
| ----- | ------ | ------------- |
| `kb_lookup_sources` | NEW — registry (name unique, label, kind, config jsonb, display_field, key_field nullable, credential_ref nullable, cache_ttl_seconds, enabled) | yes (`kb_` — curated reference data) |
| `kb_lookup_source_entries` | NEW — resolved/cached entries (source_id fk, display, key nullable, version, fetched_at); one active version per source | yes (`kb_`) |
| `app_session_step_outputs` | **No column change** — key + source snapshot ride the existing `fields` jsonb (`StepOutputField.valueKey`, `sourceRef`) | n/a |

All new tables carry `id` (uuid), `created_at`, `updated_at`; columns
snake_case. Both are defined in `packages/adapters/src/db/schema/kb.ts` (where
the other `kb_` tables live) and ship as one additive generated migration.

`credential_ref` follows the `admin_mcp_servers` precedent: it points at the
encrypted secret store, and the secret is never stored on the row nor returned
to a client.

## 9. Architectural decisions

- **New**: ADR-050 — External-sourced field values (named registry, the
  `IValueSetProvider` port, display+key model and the `Field.key` accessor,
  Test-time field selection, the `api` kind and its egress guards, size-adaptive
  prompting, cache + snapshot degradation, hybrid step-end validation).
  Renumbered from 032, which three ADRs already claimed — one of them accepted
  and cited from shipped code (`session-step-output.ts`).
- **New**: ADR-051 — Narrowing a large value set to what the operator meant (the
  matching ladder, `api` pagination, the AI shortlist rung, the near-certain
  auto-resolve rule, and the invariant that narrowing proposes while the
  step-end resolve still decides). Extends ADR-050 without superseding it.
- **Assumes / extends**: ADR-018 (external directory degrades gracefully) — the
  same fail-degraded philosophy applied to constraint sets, hardened with a
  snapshot so audit survives an outage.
- Reuses the `packages/adapters/src/directory` adapter pattern
  (`IPeopleDirectory`, Graph/Entra + HR) for the `directory` source kind, and the
  `admin_mcp_servers` credential pattern for the `api` kind.

## 10. Acceptance criteria

- [ ] Admin can create / edit / delete a lookup source and **Test** it from
      **Configuration**.
- [ ] **Test** returns the source's field names and a bounded sample; the admin
      selects the display field and optionally the key field from those names;
      the sample re-renders as `display (key)`; both selections persist on save.
- [ ] A source cannot be saved without a display field; a source with no key
      field still works (display only, no empty parentheses shown).
- [ ] All three kinds resolve: `directory`, `managed`, and `api`.
- [ ] An `api` source rejects a non-HTTPS URL and a URL resolving to a loopback,
      link-local, or RFC1918 address; enforces a request timeout and a response
      size cap; and stores its secret via `credentialRef`, never in `config` and
      never in a client response.
- [ ] `(options-source: NAME)` parses into `TemplateField.optionsSource`; using
      it with inline `(options: …)` or `(multi-options: …)` is a
      `VALIDATION_FAILED` error; an unknown `NAME` fails at upload with a clear
      message; combining it with `(multiple)` is accepted and yields a
      multi-select whose every value is resolved at step end.
- [ ] When a key exists, the resolved output stores both display and key;
      `{{ Field.key }}` renders the key in the generated document, and
      `{{ Field }}` renders the display alone (no key, no parentheses).
- [ ] Selection surfaces (Test panel, dropdown, type-ahead, conversational
      preview, flagged-field list) render keyed values as `display (key)`.
- [ ] Small sets (≤ 30) inline into the AI prompt and render a dropdown; large
      sets omit inline values and render a type-ahead search.
- [ ] `StepOutputField.options` is not populated for external-sourced fields.
- [ ] A conversational question previews at most 3 options; the operator can ask
      for the full list, which is then shown; the preview cap is independent of
      whether the set is inlined into the model's context.
- [ ] Operator type-ahead returns live results via `IValueSetProvider.search`.
- [ ] At step end, every external-sourced field is batch-resolved: valid values
      canonicalise (display + key attached), invalid ones are flagged and block
      completion until corrected; a value matching two entries with distinct keys
      is rejected as ambiguous.
- [ ] Each stored value snapshots `{ name, version, fetchedAt }`.
- [ ] A refresh that returns identical content reuses the existing version; only
      changed content writes a new one.
- [ ] Source outage serves last-known-good entries with a stale flag; generation
      / validation never hard-fails on the external call (Result pattern, fail
      degraded).
- [ ] An `api` source with a paging block walks offset, page-numbered or cursor
      pagination until the source runs out, the record ceiling is reached, or the
      page cap is spent; a page failing mid-walk discards the walk rather than
      caching a truncated set.
- [ ] A value differing from exactly one entry only by punctuation, a joining
      word, or a plural resolves without a confirmation turn.
- [ ] A value differing from exactly one entry by a single typo resolves without
      a confirmation turn **only** when no other entry scores within the margin;
      two entries one character apart (`Region 1` / `Region 2`) are shortlisted,
      never auto-filled.
- [ ] When the string ladder finds nothing, one bounded AI call shortlists at
      most 5 candidates from the cached set; any option it returns that is not in
      that set is dropped; an AI-shortlisted candidate never auto-resolves.
- [ ] A blocked value's message names the candidates
      (`"Department" (procurement) — did you mean Finance (FIN-001)?`), and the
      value the operator confirms passes the same step-end resolve.
- [ ] A **stale** set is never narrowed, and a narrowing failure (no model, an
      outage, an unparseable response) leaves the block in place without
      suggestions rather than raising an error.
- [ ] Architecture boundaries intact (`domain` dependency-free; port in domain,
      adapters implement; Result at all boundaries).
- [ ] `VERSION` = `package.json#version` = `0.31.0`; `./validate.sh` passes.
      Narrowing lands at `0.32.0`, the AI shortlist and near-certain rule at
      `0.33.0`.

## 11. Out of scope / future work

- Dependent / cascading lookups and server-side filtering by another field.
- Scheduled background cache refresh for the `api` kind; a job-queue refresh
  (`job_`) is a follow-up. (Cursor-based pagination is no longer future work —
  it shipped in `0.32.0`.)
- Prompt caching of the entry list sent to the shortlist call; worth doing once
  real set sizes are known.
- Write-back / two-way sync to any source kind.
- Bulk re-validation of historical outputs after a source changes.
- CSV import for `managed` source entries (inline editing ships first).

## 12. Risks / open questions

- **Inline threshold (30)** and **conversation preview cap (3)** are **hard-coded
  constants** for this version — not configurable. Revisit if a deployment needs
  to tune them.
- **`api` kind is new exposure.** An admin-supplied outbound URL is the product's
  first SSRF surface, and it arrives with credential storage, untrusted response
  shapes, and the chance of a slow endpoint stalling a step. The guards in
  ADR-050 §2a are the mitigation and need explicit tests, including the
  address-rejection cases.
- **Preview affordance** — the wording ("ask to see all N") and the operator
  phrase(s) that expand to the full list are a UX detail to pin at build.
- **Casing / duplicate displays** — two entries sharing a display but different
  keys (e.g. two "Operations"). The `display (key)` convention disambiguates in
  the picker; an ambiguous free-typed/AI value is rejected at step end.
- **Cache staleness vs audit** — the default TTL is 3600s and a refresh only
  bumps the version when content changes, which bounds snapshot churn; a long TTL
  still means a value can validate against a set that has since moved.
- **Migration safety** — `migration-safety.test.ts` flags `ADD CONSTRAINT …
  UNIQUE` and `CREATE UNIQUE INDEX` regardless of table age, so the unique
  `name` must be inline in `CREATE TABLE` or carry a `-- data-impact: preserved`
  declaration.
- **The near-certain threshold is the one number that can seat a wrong value**
  without anyone confirming it. The runner-up margin, not the score, is the real
  protection; both are named constants with direct tests, and both are unvalidated
  against real data until a live source exercises them.
- **The AI shortlist costs a model call per distinct blocked value**, and sends
  the cached set in the prompt. Sets above the admin-settable budget are sampled,
  so the right answer can fall outside the slice — a missing suggestion, never a
  wrong one.
- **Stemming folds "Service" onto "Services"**, so a source deliberately holding
  both as distinct entries sees them shortlisted rather than one resolving.
