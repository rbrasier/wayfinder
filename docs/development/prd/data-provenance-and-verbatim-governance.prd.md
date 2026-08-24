# PRD — Data Provenance and Verbatim Governance

- **Status**: Draft
- **Date**: 2026-08-24
- **Author**: rbrasier
- **Target version**: 0.32.0  (bump: MINOR — additive `admin_mcp_servers.verbatim_only` column
  + new feature)

## 1. Problem

Every extracted value in Wayfinder looks the same. `ExtractionFieldResult` carries one number:

```typescript
export interface ExtractionFieldResult {
  key: string;
  value: string;
  confidence: number;
  rationale: string;
}
```

That number means "how sure the model is that this value is correct" — an *accuracy*
self-assessment. It is the only provenance signal there is, and it is applied uniformly to
values that were arrived at in completely different ways.

Three problems follow.

**Verbatim and processed data are conflated.** A value copied unchanged from a tool result and a
value the model composed are indistinguishable in the data. They warrant different questions:
for a copied value the risk is *did it pick the right one*; for a composed value the risk is
*is it right at all*. One `confidence` field cannot answer both.

**Human corrections masquerade as model certainty.** `applyFieldEdit` stamps a corrected field
`confidence: 1`. A human saying so and a model being certain are recorded identically, so the
strongest provenance in the system — a person typed it — is invisible.

**There is no way to require verbatim handling.** `McpServer` lets an administrator classify a
connection as internal or external (`communicatesExternally`), but nothing lets them require
that a connection's raw tool results are used as-is. For a regulated source — a rate table, a
statutory register — "the AI may paraphrase this" is the wrong default and there is no way to
turn it off.

The word "verbatim" appears nowhere in the codebase as a governance concept today.

## 2. Users / Personas

- **System administrator** — registers MCP connections and must be able to require that a
  regulated source is never paraphrased.
- **Operator** — reviews extracted fields and needs to see at a glance which values were copied,
  which were composed, which were calculated, and which a person corrected.
- **Auditor / reviewer** — reconstructs how a value came to exist, from source reference through
  to derivation.

## 3. Goals

- An administrator can require verbatim-only processing per MCP connection.
- A verbatim-sourced field reports selection confidence; a processed field reports accuracy
  confidence; the two are never averaged or compared.
- Derived (calculated) fields are distinguishable from source data, carry their calculation
  method, and keep references to the fields they were computed from.
- Human-corrected values are recorded as such rather than as maximum model confidence.
- Provenance survives export in every format.

## 4. Non-goals

- Retrofitting provenance onto historical extraction records — absent reads as `processed`.
- A calculation *engine*. This phase records a derivation and its inputs; it does not add a
  formula language or evaluate expressions.
- Extending verbatim enforcement to non-MCP sources (uploads, RAG chunks, lookup sources).
- Changing the red/amber/green thresholds or the extraction confidence floor.

## 5. Key entities

| Entity | Lives in | New / existing | Notes |
| ------ | -------- | -------------- | ----- |
| `FieldProvenance` | `packages/domain/src/entities/field-provenance.ts` | new | `"verbatim" \| "processed" \| "derived" \| "human_corrected"` |
| `ConfidenceKind` | same file | new | `"selection" \| "accuracy"`; derived from provenance, never set independently |
| `FieldDerivation` | same file | new | `method` (documented calculation) + `sourceKeys` |
| `FieldSourceRef` | same file | new | Field-level source reference — document id plus locator |
| `ExtractionFieldResult` | `packages/domain/src/entities/extraction-record.ts` | changed | Gains optional `provenance`, `sourceRef`, `derivation` |
| `McpServer` | `packages/domain/src/entities/mcp-server.ts` | changed | Gains `verbatimOnly: boolean` |

## 6. User stories

1. As an administrator, I can require verbatim-only processing on a connection, so that a
   regulated source is never paraphrased.
2. As an administrator, I am asked to confirm before that setting changes, so that a governance
   guarantee is never toggled by accident.
3. As an operator, I can see at a glance which values were copied, composed, calculated or
   corrected, so that I know where to spend my review effort.
4. As an operator, I see selection confidence on a copied value and accuracy confidence on a
   composed one, so that the number in front of me answers the right question.
5. As an auditor, I can follow any value back to its source reference, and any calculated value
   back to its method and inputs.

## 7. Pages / surfaces affected

- MCP server admin (`apps/web/src/components/admin/`) — verbatim-only toggle with a confirmation
  step, alongside the existing external-communication classification.
- Extraction record review (`apps/web/src/components/extraction/`) — provenance styling,
  confidence label reflecting kind, derivation and source-reference access.
- `confidence-bar.tsx` — labels the metric by kind rather than assuming accuracy.
- Exports (xlsx, JSON, CSV) — provenance columns/keys.

## 8. Database changes

| Table | Change | Prefix valid? |
| ----- | ------ | ------------- |
| `admin_mcp_servers` | add column `verbatim_only boolean not null default false` | n/a (existing `admin_` table) |
| `app_extraction_records` | none — provenance rides inside the existing `fields` jsonb (`$type<ExtractionFieldResult[]>`) | n/a |

Note the prefix: MCP servers live in `admin_mcp_servers`
(`packages/adapters/src/db/schema/admin.ts:169`), not under `app_`.

The column mirrors `communicates_externally` exactly — `boolean` with `notNull().default(false)`
— so every existing connection is unaffected, which is this requirement's own criterion. The
migration declares:

```
-- data-impact: preserved — defaulted boolean column; every existing connection keeps current behaviour
```

Provenance needs no migration at all: `app_extraction_records.fields` is already
`jsonb().$type<ExtractionFieldResult[]>()`, and the new members are optional.

## 9. Architectural decisions

- **New:** ADR-053 — provenance is a property of the field result, and confidence has two
  distinct meanings derived from it.
- **Assumes:** ADR-024 (operator correction), ADR-032 (MCP tool-loop pre-pass and its captured
  `McpToolCallRecord`), ADR-033 (extraction records and the confidence/rationale model).

## 10. Acceptance criteria

**Requirement: Verbatim Processing Control**

- [ ] A per-connection toggle enforces verbatim-only processing.
- [ ] The setting survives save and reload.
- [ ] When enabled, no step may transform that connection's raw tool results — only select from them.
- [ ] Changing it requires an explicit administrator confirmation.
- [ ] Existing connections are unaffected — `verbatim_only` defaults `false`.

**Requirement: Provenance Differentiation**

- [ ] Verbatim-sourced fields display selection confidence.
- [ ] Processed fields display accuracy confidence.
- [ ] Visual styling differs by provenance type.
- [ ] A source reference is reachable for every data element.
- [ ] Every export format preserves provenance.

**Requirement: Derived Field Handling**

- [ ] Derived fields are visually distinct from source fields.
- [ ] The calculation method is documented and accessible.
- [ ] Source-data references are preserved for audit.
- [ ] Derived fields carry a confidence metric appropriate to their kind.
- [ ] Exports keep derived and source data distinguishable.

## 11. Out of scope / future work

- Verbatim enforcement for uploads, RAG chunks and lookup sources.
- A formula language or calculation engine for derived fields.
- Back-filling provenance onto historical records.
- Provenance on conversational step outputs (`SessionStepOutput`) — extraction records only here.

## 12. Risks / open questions

- **Confidence semantics are a silent breaking read.** Every existing reader of `confidence`
  assumes accuracy. Introducing selection confidence changes what the number means for some rows
  without changing its type. Mitigation: a single accessor that returns value *and* kind, made
  the only supported way to read it.
- **`verbatimOnly` is a governance claim.** A toggle that asserts a guarantee the system does not
  actually enforce is worse than no toggle. Enforcement must be at the point where tool results
  enter the prompt, not merely advisory in the UI.
- **"Transform" needs a hard definition.** Truncation, whitespace normalisation and unit
  conversion are all arguably transformations. Open question — current position: verbatim means
  byte-identical selection from the tool result, with any normalisation making it `processed`.
- **`aggregateConfidence` mixes kinds.** It takes the minimum across a record's fields; once two
  kinds exist, that minimum spans incomparable scales. Must either aggregate per kind or state
  plainly that it is a triage floor and nothing more.
