# v1.16.0 Implementation Summary

## What was built

Two admin analytics dashboards plus a template-field validation/reporting
pipeline that captures structured `{{ tag }}` values for reporting.

### Template field annotations
`{{ Field Name (annotation) }}` tags now support validation annotations:
type keywords (`text`, `date`, `currency`, `number`, `email`, `yesno`),
`options: A, B, C` enums, and constraints (`maxlen`, `max`, `min`, `optional`).
Annotations can be stacked and are whitespace-tolerant (`( email )`,
`(min:   60)`). Parsing is enforced at template upload — invalid annotations
reject the upload with an explanation. Parsed field definitions are stored on
the node config (`documentTemplateFields`).

### End-of-step data capture
Generated field values are now persisted as first-class "step output" records
(`app_session_step_outputs`) keyed by session + node, rather than being
discarded after rendering. This feeds the Flow Insights reporting section.

### Prompt injection
The system-prompt builder and document-generation prompt now inject a
`<field_formats>` constraints block so the AI reformats user input to the
required format (e.g. spoken dates → DD-MM-YYYY, amounts → currency) and only
asks the user when it genuinely cannot.

### Dashboards
- **Overview** — active sessions / completions / completion rate with
  period-on-period deltas, daily started-vs-completed dual-line chart, flow
  distribution donut, and an AI-confidence-across-session-lifetime area chart.
- **Flow Insights** — selectable flow cards (highest-use selected by default),
  per-step avg-confidence and drop-off bar charts, a node breakdown table
  (turns, avg time, colour-coded completion bar), and a template-field
  reporting section (per-field summaries + a values table).

## Files created

Domain:
- `packages/domain/src/entities/template-field.ts` (+ test) — annotation parser,
  key derivation, and prompt constraint formatting.
- `packages/domain/src/entities/session-step-output.ts` — step-output entity.
- `packages/domain/src/entities/analytics.ts` (+ test) — analytics DTOs and pure
  aggregation functions.
- `packages/domain/src/ports/session-step-output-repository.ts`
- `packages/domain/src/ports/analytics-repository.ts`

Application:
- `packages/application/src/use-cases/analytics/get-overview-dashboard.ts`
- `packages/application/src/use-cases/analytics/get-flow-deep-dive.ts`
- `packages/application/src/use-cases/analytics/analytics.test.ts`

Adapters:
- `packages/adapters/src/repositories/drizzle-session-step-output-repository.ts`
- `packages/adapters/src/repositories/drizzle-analytics-repository.ts`
- `packages/adapters/drizzle/0011_elite_lester.sql`

Web:
- `apps/web/src/server/routers/analytics.ts`
- `apps/web/src/app/(admin)/admin/dashboards/overview/{page,_content}.tsx`
- `apps/web/src/app/(admin)/admin/dashboards/flows/{page,_content}.tsx`

## Files modified

- `packages/adapters/src/documents/docx-generator.ts` — `extractFields()`;
  render key strips annotations (single source of truth with the parser).
- `packages/domain/src/entities/flow-node.ts` — `documentTemplateFields`.
- `packages/domain/src/ports/{document-generator,session-agent}.ts`
- `packages/adapters/src/agents/flow-session-graph.ts` — `<field_formats>` block.
- `packages/adapters/src/db/schema/wayfinder.ts` — `app_session_step_outputs`.
- `packages/application/src/use-cases/document/generate-document.ts` — field-aware
  prompt + step-output persistence.
- `apps/web/src/app/api/flows/[id]/nodes/[nodeId]/template/route.ts` — validate +
  persist field defs.
- `apps/web/src/components/canvas/template-tags-help-dialog.tsx` — full
  annotation reference (opened by the existing info icon on the upload box).
- `apps/web/src/lib/container.ts`, `apps/web/src/server/router.ts`,
  `apps/web/src/components/sidebar.tsx`, `apps/web/src/app/(admin)/admin/page.tsx`.

## Migrations

- `0011_elite_lester.sql` — creates `app_session_step_outputs`
  (session/flow/node FKs, `fields` jsonb, indexes on flow/session/node). Run
  `pnpm --filter @rbrasier/adapters db:migrate`.

## Dependencies

- Added `recharts@^2.15` to `apps/web` for the dashboard charts.

## Known limitations

- Analytics aggregation loads session/message rows into memory and computes in
  pure functions; fine for current scale, but very large datasets would benefit
  from SQL-side aggregation later.
- Step outputs are captured only for `generate_document` steps (by design). The
  table is generic enough to also capture conversational `contextGathered` data
  in a future iteration.
- "Flow distribution" groups sessions by flow (there is no separate flow
  category/type field in the schema).

## Version bump

MINOR: 1.15.2 → 1.16.0 (new feature + DB schema change)
