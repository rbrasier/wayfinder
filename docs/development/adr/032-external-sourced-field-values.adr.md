# ADR-032 — External-sourced field values (named lookup registry + display/key model)

- **Status**: Proposed (scoped by `external-field-values.phase.md`, target v2.5.0)
- **Date**: 2026-07-17
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
unique `name` (slug), a `kind` (`directory` | `managed`), a `config`, a
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

The registry is CRUD-managed under **Configuration** (`/admin/settings`) with a
**Test** action that fetches a small sample and shows resolved `display / key`
pairs, so an admin validates wiring before any template uses it.

### 2. A generic `IValueSetProvider` port; adapters per kind

A new domain port abstracts the source so neither `application` nor the AI layer
knows where values come from:

```
search(sourceName, query, limit)  -> Result<ValueSetEntry[]>   // type-ahead
list(sourceName)                   -> Result<ValueSetEntry[]>   // small sets / cache fill
resolve(sourceName, values)        -> Result<ResolveOutcome>    // batch, step-end
```

`ValueSetEntry = { display: string; key?: string }`. Adapters live in
`packages/adapters`: the `directory` kind reuses the existing Graph/HR
directory; the `managed` kind reads admin-entered rows. A future `http` kind
slots in without touching domain or application. Every method returns the Result
pattern and **fails degraded** — a provider error yields last-known-good (§5),
never a throw across the boundary.

### 3. Display + optional key; store both; `Field.key` accessor

When a source declares a `keyField`, a resolved value carries both parts. We
persist both on the output field — the existing `StepOutputField` (jsonb) gains
an optional `valueKey` and a `sourceRef` snapshot, so **no migration on
`app_session_step_outputs`** is needed:

```
{ key, label, type, value: "Finance", valueKey: "FIN-001",
  sourceRef: { name: "departments", version, fetchedAt } }
```

The document renders the display (`value`); reporting reads the `valueKey`
automatically. A companion accessor `{{ Field.key }}` (e.g. `{{ Department.key }}`)
renders the stored key. It is resolved at **render time** from the parent field's
`valueKey` — not a separately-answered field — so the operator answers
`Department` once. A `.key` accessor on a source without a `keyField`, or on a
non-external field, renders empty and is flagged at upload.

### 4. Size-adaptive prompting and picking

A field bound to a source may have tens or thousands of values, so behaviour
adapts to set size (a per-source count from the cache):

- **Small** (≤ **30**): entries are inlined into the AI extraction prompt (as
  today's `describeType` does) and rendered as a dropdown.
- **Large** (> 30): values are **not** inlined. The model proposes a value from
  context; the picker is a server-side **type-ahead** (`search`). Correctness is
  guaranteed by the step-end resolve (§6), not by constraining the prompt.

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
  mechanics and admits new kinds (HTTP) without a domain change.
- Snapshotting makes an externally-derived constraint auditable — a
  differentiator, not just a safeguard — and lets the system stay up through a
  source outage.
- Reuses the existing directory adapter and the jsonb output field, so the schema
  footprint is two `kb_` tables and zero output-table migration.

**Negative**

- A second external axis (source availability, cache freshness) enters the
  generate/validate path. Mitigated by lazy caching, the inline fast-path for
  small sets, and fail-degraded resolution.
- Step-end validation can reject an AI-filled value the operator did not type,
  requiring a correction pass; the UX must make the flagged fields obvious.
- Duplicate display labels with distinct keys need disambiguation in the picker
  and rejection of ambiguous free/AI values at resolve time.

## Open questions — to resolve at build

- **Inline threshold** for "small" sets is **30** — confirm whether it is a
  fixed constant or a per-deployment/per-source override.
- **Conversation preview cap** is **3** — confirm the "ask to see all N"
  affordance wording and the trigger phrase(s) that expand to the full list.
- **`Field.key` mechanics** — confirm render-time accessor vs a synthetic parsed
  companion field; the ADR proposes render-time.
- **Cache TTL default** and whether **Test** forces a version bump on every run
  or only on content change (to avoid snapshot churn).
- **Managed source editing** — whether `managed` entries are edited inline in the
  admin UI or imported (CSV) — leaning inline for v1, import as follow-up.
