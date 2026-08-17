# ADR-050 — External-sourced field values (named lookup registry + display/key model)

- **Status**: Proposed (scoped by `external-field-values.phase.md`, target v0.31.0)
- **Date**: 2026-07-17
- **Revised**: 2026-08-17 — renumbered from 032 (three ADRs held that number; the
  accepted repeating-groups ADR-032 is cited from shipped code); `api` source kind
  brought into scope; Test-time display/key field selection and the `value (key)`
  presentation convention added
- **Relates to**: ADR-018 (external directory degrades gracefully) — extends its
  fail-degraded philosophy from *value resolution* to *constraint sets*, adding a
  snapshot so audit survives an outage. Does not supersede any ADR.

## Context

A `TemplateField`'s allowed set (`options: string[]`) is a static list typed into
the Word tag at authoring time. That is fine for a handful of stable choices but
fails for organisational reference data — departments, cost centres, GL codes —
which is large, live, and owned outside the template. Authors also cannot capture
the **code** behind a label: the document records `Finance`, but a downstream
report needs `FIN-001`.

We already have an external-lookup precedent: `IPeopleDirectory` /
`IReportingLineResolver` (`packages/domain/src/ports`, adapters in
`packages/adapters/src/directory`) resolve *people* from Entra/HR and degrade to
empty when unconfigured (ADR-018). This ADR generalises that shape from people to
**arbitrary named value sets** used as a field's valid set.

Note the axis. `FieldValueSource` (`ai | literal | step_field | none`) decides
**who fills the answer**. This ADR is a different axis — **what set the answer is
validated against**. The two compose: an `ai`-filled field can still be
constrained by an external source.

## Decision

### 1. A named lookup registry, referenced from templates

Admins register **lookup sources** in a new `kb_lookup_sources` table, each with a
unique `name` (slug), a `kind` (`directory` | `managed` | `api`), a `config`, a
`displayField`, an optional `keyField`, a `cacheTtlSeconds`, and an `enabled`
flag. A template author references one by name:

```
{{ Department (options-source: departments) }}
```

`(options-source: NAME)` parses into a new optional `TemplateField.optionsSource`
(additive; back-compat). It is **mutually exclusive** with inline `(options: …)`
and `(multi-options: …)` — declaring both is `VALIDATION_FAILED`. An unknown
`NAME` fails at **template-upload** time (the registry is consulted then), so the
error surfaces to the author, not the operator.

`(options-source: …)` **may** be combined with `(multiple)`: the source supplies
the valid set, the operator picks several from it, and every picked value is
resolved and keyed at step end. The existing guard that rejects `(multiple)`
without an options list is relaxed to accept `optionsSource` as an options list.

The registry is CRUD-managed under **Configuration** (`/admin/settings`) with a
**Test** action (§2b), so an admin validates wiring before any template uses it.

### 2. A generic `IValueSetProvider` port; adapters per kind

A new domain port abstracts the source so neither `application` nor the AI layer
knows where values come from:

```
search(sourceName, query, limit)  -> Result<ValueSetEntry[]>   // type-ahead
list(sourceName)                   -> Result<ValueSetEntry[]>   // small sets / cache fill
resolve(sourceName, values)        -> Result<ResolveOutcome>    // batch, step-end
probe(config)                      -> Result<ValueSetProbe>     // Test / field selection
```

`ValueSetEntry = { display: string; key?: string }`. Adapters live in
`packages/adapters`: the `directory` kind reuses the existing Graph/HR
directory; the `managed` kind reads admin-entered rows; the `api` kind (§2a)
calls a configured HTTP endpoint. Every method returns the Result pattern and
**fails degraded** — a provider error yields last-known-good (§5), never a throw
across the boundary.

`probe` is the only method that takes a raw config rather than a registered
name, because Test must run against an **unsaved draft** — the admin has to see
the source's fields before choosing which is the display and which is the key
(§2b). It returns `ValueSetProbe = { fields: string[]; sample: Array<Record<string,
string>> }`: the selectable field names found on the returned records, plus a
bounded sample (10 records) of those records.

#### 2a. The `api` source kind

An admin can point a source at an HTTP endpoint that returns a JSON array of
records. Config: `{ url, method: "GET" | "POST", headers?, searchParam?,
recordsPath?, pageLimit? }`. `recordsPath` is a dotted path to the array inside
the response body (empty means the body *is* the array); `searchParam` names the
query parameter that carries the type-ahead term — when it is absent the adapter
fetches the full set and filters in memory, which also caps the source at the
`list`-able size.

Three constraints make this safe enough to ship:

- **Read-only.** `GET` and `POST` (for endpoints that require a search body)
  only; no write-back, no other verbs. This ADR does not introduce two-way sync.
- **Credentials are never stored on the row.** Following the `admin_mcp_servers`
  precedent, `kb_lookup_sources` carries a `credential_ref` pointing at the
  encrypted secret store (`SettingsEncryptionService`); the secret itself is
  never persisted in `config` and never returned to a client.
- **Egress is guarded.** The URL is validated before every call: `https` only
  (except explicit localhost in development), and the resolved address is
  rejected if it is loopback, link-local, or RFC1918 — an admin-supplied URL is
  an SSRF vector, and this is the first place in the product where one exists.
  Requests carry a timeout and a response-size cap; a breach fails degraded like
  any other provider error.

The `http`-shaped kind was previously deferred; bringing it forward does not
change the port, which was designed to admit it.

#### 2b. Test selects the display and key fields

**Test** is not just a connectivity check — it is how display and key get chosen.
The admin fills in the kind and config, clicks **Test**, and the editor calls
`probe(config)`. Two things come back: the field names present on the returned
records, and a sample of the records themselves. The admin then picks the
**display field** and, optionally, the **key field** from those names, and the
sample re-renders as resolved pairs so the choice is verifiable before saving.
Both selections are persisted on the source (`display_field`, `key_field`), and
both are stored on every value the source later validates (§3).

Re-running Test on a saved source re-probes and lets the admin change either
selection. A source cannot be saved without a display field; the key field stays
optional.

### 3. Display + optional key; store both; `Field.key` accessor

When a source declares a `keyField`, a resolved value carries both parts. We
persist both on the output field — the existing `StepOutputField` (jsonb) gains
an optional `valueKey` and a `sourceRef` snapshot, so **no migration on
`app_session_step_outputs`** is needed:

```
{ key, label, type, value: "Finance", valueKey: "FIN-001",
  sourceRef: { name: "departments", version, fetchedAt } }
```

**Presentation convention.** Wherever a keyed value is shown to a human for
*selection or verification* — the admin Test panel, the operator's dropdown and
type-ahead results, the conversational preview, and the flagged-field correction
list — it renders as `display (key)`: `Finance (FIN-001)`. A source with no key
field renders the display alone, with no empty parentheses.

The **generated document is deliberately exempt**: `{{ Field }}` renders the
display only, exactly as it does today, and the key is available solely through
the `{{ Field.key }}` accessor. Selection surfaces show both because the admin
and operator are choosing between potentially ambiguous labels; the document
shows what the author asked for.

`{{ Field.key }}` (e.g. `{{ Department.key }}`) renders the stored key. It is
resolved at **render time** from the parent field's `valueKey` — not a
separately-answered field — so the operator answers `Department` once. A `.key`
accessor on a source without a `keyField`, or on a non-external field, renders
empty and is flagged at upload.

### 4. Size-adaptive prompting and picking

A field bound to a source may have tens or thousands of values, so behaviour
adapts to set size (a per-source count from the cache):

- **Small** (≤ **30**): entries are inlined into the AI extraction prompt (as
  today's `describeType` does) and rendered as a dropdown.
- **Large** (> 30): values are **not** inlined. The model proposes a value from
  context; the picker is a server-side **type-ahead** (`search`). Correctness is
  guaranteed by the step-end resolve (§6), not by constraining the prompt.

Inlined entries are written into the prompt as `display (key)` when a key exists,
so the model can propose an unambiguous value between duplicate labels. The
`StepOutputField.options` array is **not** populated for external fields — the
valid set lives in the source and its cache, and a copy on the output row would
silently disagree with `sourceRef.version`.

**Conversation preview is separate from inlining.** What the model *knows* (the
inlined set) and what the operator is *shown* when asked the question are two
different things. When a step surfaces the question conversationally, the
assistant previews **at most 3** options — e.g. "Finance, HR, Legal… — ask to see
the full list" — even for a small, fully-inlined set. The operator sees the
complete set only when they ask for it (the type-ahead search still backs the
full list). This keeps the conversational turn readable and avoids dumping 30
options into chat, while the model retains the full set for extraction and the
step-end resolve remains authoritative.

### 5. Cache + snapshot; fail degraded

Resolved entries are cached in `kb_lookup_source_entries` with a `version` and
`fetched_at`, refreshed lazily on TTL expiry (and on demand via **Test**). Two
consequences:

- **Availability**: if the source is unreachable, resolution serves the
  last-known-good version and marks the result **flagged/stale** rather than
  blocking the workflow — the ADR-018 rule ("a directory blip must not halt the
  process"), now applied to constraint sets.
- **Audit**: every stored value records the `{ name, version, fetchedAt }` it was
  validated against. A later rename of the department does not rewrite history —
  a reviewer sees the set that was authoritative at the time. This is the reason
  the snapshot is mandatory, not optional: Wayfinder's governance claim depends
  on "why was this valid then?" being answerable.

The default `cacheTtlSeconds` is **3600**. A refresh writes a new `version` only
when the resolved content differs from the current version — a Test run or a TTL
expiry that returns identical entries reuses the existing version, so snapshots
do not churn on every poll.

### 6. Hybrid validation — live type-ahead + authoritative step-end batch

Two checkpoints, because AI-filled and free-typed values must be caught even
though the picker offers only valid options:

1. **Live**: the manual picker validates as-you-type against `search` — cheap,
   immediate feedback.
2. **Step end** (authoritative): when the step completes, **all** external-sourced
   fields for the step are resolved in **one** `resolve(sourceName, values)` batch
   per source. Matches canonicalise (display + key attached, casing normalised);
   unmatched values are flagged and **block step completion** until corrected.
   This is the single point that attaches keys and writes the snapshot, and the
   natural place to amortise the external call.

## Consequences

**Positive**

- Reference data is maintained once by an admin, not per template; authors
  reference a name; operators always see live values.
- The document and the backend store both label and code, so reporting needs no
  second lookup and no reverse mapping.
- The `IValueSetProvider` port keeps `domain`/`application` ignorant of source
  mechanics; `directory`, `managed` and `api` differ only by adapter.
- Test-time field selection means an admin never has to know the source's field
  names in advance — the source tells them, and the sample proves the choice.
- Snapshotting makes an externally-derived constraint auditable — a
  differentiator, not just a safeguard — and lets the system stay up through a
  source outage.
- Reuses the existing directory adapter and the jsonb output field, so the schema
  footprint is two `kb_` tables and zero output-table migration.

**Negative**

- A second external axis (source availability, cache freshness) enters the
  generate/validate path. Mitigated by lazy caching, the inline fast-path for
  small sets, and fail-degraded resolution.
- The `api` kind puts an **admin-controlled outbound URL** in the product for the
  first time. SSRF, credential handling, untrusted response shapes, and a slow
  endpoint stalling a step are all new exposure; §2a's guards (scheme and address
  validation, `credential_ref`, timeout, size cap, read-only verbs) are the
  mitigation and must be tested, not assumed.
- Step-end validation can reject an AI-filled value the operator did not type,
  requiring a correction pass; the UX must make the flagged fields obvious.
- Duplicate display labels with distinct keys need disambiguation in the picker
  and rejection of ambiguous free/AI values at resolve time. The `display (key)`
  convention (§3) is what makes the picker case tractable.

## Open questions — to resolve at build

- **Inline threshold (30)** and **conversation preview cap (3)** are **hard-coded
  constants** for this version — not per-deployment or per-source configurable.
- **Preview affordance** — confirm the "ask to see all N" wording and the trigger
  phrase(s) that expand to the full list.
- **`api` pagination** — v1 fetches a single page (`pageLimit`, default 500) for
  `list`; whether to follow `next`-style cursors for very large sets is deferred.
- **Managed source editing** — whether `managed` entries are edited inline in the
  admin UI or imported (CSV) — leaning inline for v1, import as follow-up.
