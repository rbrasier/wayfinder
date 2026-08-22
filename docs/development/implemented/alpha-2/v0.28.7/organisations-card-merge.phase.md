# Phase — One Organisations Card in Admin Configuration

- **Status**: Implemented in v0.28.7
- **Target version**: 0.28.7 — **PATCH** (presentation only; no schema change,
  no tRPC change, no change to which setting grounds the AI)
- **Base branch**: `release/alpha-2`
- **Branch**: `claude/org-name-card-display-eg36j3`
- **ADR**: no new ADR, and no ADR governs this. The toggle being rearranged is
  **not** from `docs/development/adr/038-organisations-as-sharing-scope.adr.md` —
  that ADR's §6 explicitly says "there is no enable/disable toggle". The toggle
  was introduced later by
  `docs/development/implemented/alpha-2/v2.10.0/admin-orgs-ui-cleanup.phase.md`
  as a UI gate, which is the document this phase actually revises. See §7.
- **Supersedes**: the `web/settings/page.tsx` row of that v2.10.0 phase doc
  ("Show `OrganisationNameCard` only when orgs OFF") — the same rule now lives
  inside the card instead of on the page.
- **PRD**: `docs/development/prd/multi-organisation-support.prd.md` §7 names
  `/admin/settings` as an affected surface; this phase changes only the layout of
  that surface and adds no capability the PRD does not already list.

## 1. Goal

Admin → Configuration → General shows **one** card for organisations instead of
two adjacent ones whose relationship exists only in prose ("the single
organisation name **below**"), and whose lower card disappears entirely when the
toggle is switched on.

What becomes possible:

- An administrator on a single-organisation deployment sees the organisation
  name as the primary setting of the Organisations card, not as a second card
  titled "General" sitting inside a section also titled "General".
- Switching the toggle on removes the name field **in place** — the card stays
  put and tells the admin, with a link, that organisations are now managed at
  `/admin/organisations`. Today the card simply vanishes and nothing says where
  the per-organisation names went.
- The first-run wizard is untouched: it already asks single-or-multiple with its
  own choice buttons, so a second toggle there would contradict it.

## 2. Business rules

| Condition | Behaviour |
| --- | --- |
| `organisation.isEnabled` is `true` | The name field, its helper text and Save are not rendered. In their place: one line of copy and a link to `/admin/organisations`. |
| `organisation.isEnabled` is `false` | The name field, helper text and Save render above the toggle. No link. |
| `organisation.isEnabled` is still loading (`undefined`) | Treated as not enabled — the name section renders. This preserves today's `data !== true` page-level check; the alternative flashes an empty card on every visit. |
| Toggle is switched | `organisation.isEnabled` is invalidated on success (unchanged), so the card swaps sections without a reload. |
| Save is pressed | Writes the `organisation_name` setting, unchanged. |

The link target is fixed (`/admin/organisations`) and matches the sidebar entry
that ADR-038 already reveals only while the feature is on, so the link never
points somewhere the admin cannot reach.

## 3. What is built

| Layer | File(s) | Change |
| --- | --- | --- |
| apps/web | `components/settings/organisations-card-model.ts` (new) | `resolveOrganisationsCardMode(isEnabled: boolean \| undefined): "single-name" \| "managed-elsewhere"` — the whole visibility rule, including the loading case, as one pure function. |
| apps/web | `components/settings/organisation-name-card.tsx` | Extract the label, helper text, input and Save into an exported `OrganisationNameFields` with no `Card` wrapper. `OrganisationNameCard` becomes that component inside a `Card`, keeping the wizard's current appearance and the `#org-name` input id. |
| apps/web | `components/settings/organisations-card.tsx` (new) | The merged card. Title "Organisations". Renders `OrganisationNameFields` or the manage link per the model, a divider, then the toggle moved verbatim from `OrganisationsToggleCard`. Toggle helper copy: "below" → "above". |
| apps/web | `components/settings/organisations-toggle-card.tsx` | **Deleted** — its content now lives in `organisations-card.tsx`, and dead code is not kept. |
| apps/web | `app/(admin)/admin/settings/page.tsx` | Renders `<OrganisationsCard />`. The page-level `trpc.organisation.isEnabled` query, the conditional and its explanatory comment are removed — the card owns the rule now. |

Nothing outside `apps/web/src/components/settings` and the settings page is
touched. `packages/domain`, `packages/application` and `packages/adapters` are
not opened.

## 4. Database changes

None. No table, column, index or migration. `organisation_name` and
`organisations_enabled` keep their existing storage and their existing readers
(`cached-admin-settings.ts`, the chat prompt path).

## 5. Implementation order (tests first)

1. `organisations-card-model.test.ts` — the three input cases above. Then
   `organisations-card-model.ts`. Run `./validate.sh`.
2. Extract `OrganisationNameFields` from `organisation-name-card.tsx`, leaving
   `OrganisationNameCard` behaving identically for the wizard. Run
   `./validate.sh`.
3. Add `organisations-card.tsx` composing the fields, the manage link and the
   toggle. Run `./validate.sh`.
4. Point the settings page at it, delete `organisations-toggle-card.tsx`, and
   confirm no importer of the deleted file remains. Run `./validate.sh`.

## 6. Testing

- **Unit** — `apps/web/src/components/settings/organisations-card-model.test.ts`
  covers `true` → `"managed-elsewhere"`, `false` → `"single-name"`, `undefined`
  → `"single-name"`. This is the only branching logic the change introduces;
  everything else is markup.
- **No Playwright spec.** The changed behaviour is a conditional render inside
  one card. Measured against `docs/guides/e2e-test-policy.md` it falls into none
  of the six groups: it is not auth session lifecycle, not streaming, not file
  transfer, not navigation state across a page load, not an accessibility tree
  change, and it is not the smoke path. Per that policy the coverage belongs at
  the layer that owns the logic, which is the model unit test above.
- **Existing e2e must keep passing unchanged** —
  `apps/web/e2e/phase-admin-first-login-setup.spec.ts` asserts on
  `#org-name` inside the wizard (visible on the single branch, absent on the
  multi branch). The wizard keeps rendering `OrganisationNameCard`, and the
  extraction preserves the input id, so both assertions hold.

## 7. Risks

- **`#org-name` id drift.** If the extraction renames or drops the input id, the
  wizard e2e assertions fail in CI. Mitigated by keeping `OrganisationNameFields`
  a literal move of the existing markup.
- **Orphaned import.** Deleting `organisations-toggle-card.tsx` breaks any
  importer not found. Only `app/(admin)/admin/settings/page.tsx` imports it
  today; `./validate.sh` (typecheck) catches anything missed.
- **Two components mount the same query.** The merged card runs
  `organisation.isEnabled` where the page used to; when the wizard is open on
  the settings page the query is shared by React Query cache, not duplicated.
- **Pre-existing ADR drift, carried not fixed.** ADR-038 §6 states organisations
  have no enable/disable toggle and need no disable-guard; the shipped app has
  had `organisations_enabled` since v2.10.0. This phase makes that toggle *more*
  prominent without reconciling the ADR. Out of scope for a PATCH — flagged so a
  later change can either amend ADR-038 or supersede it.
- **Two ADRs are numbered 038** (`-organisations-as-sharing-scope` and
  `-step-output-types`). They decide unrelated things, so nothing here is
  ambiguous in substance, but any future citation of "ADR-038" must name the
  file. Pre-existing; not addressed here.
- Nothing here is destructive or irreversible — no data is written, deleted or
  migrated.

## 8. Out of scope

- The first-run wizard's deployment step (`wizard-deployment-step.tsx`) and its
  own single/multiple choice.
- `OrganisationMembershipCard` and the `/admin/organisations` page itself.
- Any change to how `organisation_name` reaches AI system prompts.
- Renaming or restructuring the other cards in the General section.
