# v1.39.0 — HR Deferred Elements (auto-detect, RAG approver, route-back)

Implements three of the four items deferred from v1.37.0. The fourth
(auto-invite / provisioning of free-typed approvers) remains explicitly out of
scope. Phase doc: `v1.37-deferred-elements.phase.md` (this folder).

**Version bump: MINOR** — new `IColumnMappingDetector` port. The phase originally
targeted 1.38.0, but that slot (and 1.38.1 / 1.38.2) shipped separately, so this
work released as **1.39.0**.

---

## 1. HR Column Mapping Auto-Detection

When an HR spreadsheet is uploaded with no mapping supplied, an AI call maps the
headers to the six canonical field kinds so the column-mapping UI arrives
pre-filled for confirmation. Detection never fails the import — a model error
falls back to an empty mapping.

- New `IColumnMappingDetector` port (domain).
- `AiColumnMappingDetector` (adapters) — a single bounded `generateObject` call
  over the injected `ILanguageModel`, with a `z.record(z.enum([...]))` schema;
  invented headers and non-kind values are sanitised out.
- `KeywordColumnMappingDetector` (adapters) — keyword-heuristic stub so no unit
  test hits a real LLM.
- `ImportHrDataset` gains an optional detector and an optional explicit
  `columnMapping`: supplied mapping wins; else detect; else empty.
- Container wires `AiColumnMappingDetector(llm)` into `ImportHrDataset`.

## 2. Dynamic Approver Resolution via RAG

The `dynamic` approver source now runs a retrieval step before falling back to
the plain `roleHint`. No new ports — it reuses `IEmbeddingsProvider`,
`IDocumentChunkRepository`, and `ILanguageModel` (all injected optionally).

- `SuggestApprover.resolveDynamicLookup`: embed `roleHint` (+ `instructions`),
  search flow/session chunks (`minSimilarity 0.75`, `limit 5`), extract
  `{ role?, band?, businessUnit? }` via `generateObject`, then call
  `findPositionHolder` with the extracted fields merged over `roleHint`.
- Fallback chain: RAG-extracted → `roleHint` → `null`. Suggestion stays
  operator-confirmed.
- New shared schema `delegationPositionSchema`.
- Container passes `embeddings`, `documentChunks`, `llm` into `SuggestApprover`.

## 3. Reject / Changes-Requested Route-Back

- `DecideApprovalInput` gains optional `routeBack` (only meaningful for
  `rejected`).
- `changes_requested` always routes the session back to
  `graphCheckpoint.advancedFrom`; `rejected` routes back only when
  `routeBack: true`, otherwise the session is `cancelled`. A missing previous
  node forces a cancel.
- `SessionStatus` gains `"cancelled"` (TS union + Drizzle `text` enum — no
  migration; the enum is a type-level constraint, not a DB CHECK).
- The originator email now reads "returned for revision" vs "declined" via the
  notifier's new `routedBack` flag.
- `approval.decide` tRPC input forwards `routeBack`; the approvals inbox shows a
  "Route back to originator" / "Close request" choice on reject.

---

## Files

### Created
- `packages/domain/src/ports/column-mapping-detector.ts`
- `packages/adapters/src/ai/ai-column-mapping-detector.ts` (+ `.test.ts`)
- `packages/adapters/src/ai/keyword-column-mapping-detector.ts` (+ `.test.ts`)
- `packages/shared/src/schemas/approvals.ts`
- `tests/e2e/enhance-hr-auto-detect.spec.ts`
- `docs/development/implemented/v1.39.0/` (this summary + phase doc)

### Modified
- `packages/domain/src/ports/index.ts` — export new port.
- `packages/domain/src/entities/session.ts` — `cancelled` status.
- `packages/adapters/src/ai/index.ts` — export both detectors.
- `packages/adapters/src/db/schema/wayfinder.ts` — session status enum + `cancelled`.
- `packages/shared/src/schemas/index.ts` — export approvals schema.
- `packages/application/src/use-cases/hr/import-hr-dataset.ts` (+ `hr.test.ts`).
- `packages/application/src/use-cases/approvals/suggest-approver.ts` (+ `approvals.test.ts`).
- `packages/application/src/use-cases/approvals/decide-approval.ts` (+ `approvals.test.ts`).
- `packages/application/src/use-cases/notifications/notify-on-approval-decided.ts`.
- `packages/application/src/use-cases/notifications/approval-templates.ts`.
- `apps/web/src/lib/container.ts` — wire detector + RAG deps.
- `apps/web/src/server/routers/approval.ts` — forward `routeBack`.
- `apps/web/src/app/(user)/approvals/_content.tsx` — route-back / close choice.
- `tests/e2e/phase-step-approvals.spec.ts` — dynamic node + routeBack wiring.
- `VERSION`, `package.json` — `1.39.0`.

## Migrations

None. `SessionStatus`'s new `cancelled` value is a type-level Drizzle `text`
enum constraint, not a database enum/CHECK, so the existing column accepts it
without DDL.

## Tests

- Unit (`packages/adapters`): `KeywordColumnMappingDetector` (4) and
  `AiColumnMappingDetector` (4) — no real LLM calls.
- Unit (`packages/application`): `ImportHrDataset` detector paths (3),
  `SuggestApprover` RAG paths (3), `DecideApproval` route-back / cancel (5).
- E2E (`tests/e2e`): `enhance-hr-auto-detect.spec.ts` (upload → pre-fill →
  override) and `phase-step-approvals.spec.ts` additions (dynamic `roleHint`
  persistence; `decide` accepts `routeBack`). API-surface and skip-safe without
  `TEST_AUTH_BYPASS`, matching the existing approval specs.

## Known limitations

- HR auto-detect e2e asserts the pre-fill only when a mapping is returned: the
  detector calls the model server-side, which the browser-level AI mock does not
  intercept, so the deterministic guarantees are import-never-fails and the
  no-AI override path.
- Route-back is single-hop (`advancedFrom` only); multi-hop is out of scope.
- No confidence scores / per-field uncertainty on detected mappings, and no
  re-running detection on an already-mapped dataset.
