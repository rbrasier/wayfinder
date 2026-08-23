# Implementation summary — one Organisations card (v0.28.7)

Phase doc: [`organisations-card-merge.phase.md`](./organisations-card-merge.phase.md).

## What changed

Admin → Configuration → General showed two adjacent cards: an **Organisations**
card holding only the enable toggle, and below it a card titled **General**
holding the organisation name — inside a section also titled General. Switching
the toggle on made the lower card vanish with nothing to say where per-organisation
names were now set.

They are now one card:

| State | What the card shows |
| --- | --- |
| Organisations off (and while the setting loads) | `ORGANISATION NAME` + helper text + input + Save, a divider, then `ENABLE ORGANISATIONS` with its toggle. |
| Organisations on | A line of copy with a link to `/admin/organisations`, the divider, then the toggle. The card itself stays put. |

The toggle's helper copy changed from "the single organisation name **below**"
to "**above**", matching the new order.

## Files

| File | Change |
| --- | --- |
| `apps/web/src/components/settings/organisations-card-model.ts` | New. `resolveOrganisationsCardMode(isEnabled: boolean \| undefined)` → `"single-name" \| "managed-elsewhere"`. |
| `apps/web/src/components/settings/organisations-card-model.test.ts` | New. Written first; three cases. |
| `apps/web/src/components/settings/organisations-card.tsx` | New. The merged card. Toggle markup and mutation moved verbatim from the deleted card. |
| `apps/web/src/components/settings/organisation-name-card.tsx` | `OrganisationNameFields` extracted (no `Card` wrapper); `OrganisationNameCard` is now that component inside a `Card`, for the wizard. `#org-name` id preserved. |
| `apps/web/src/components/settings/organisations-toggle-card.tsx` | **Deleted.** |
| `apps/web/src/app/(admin)/admin/settings/page.tsx` | Renders `<OrganisationsCard />`. The page-level `organisation.isEnabled` query, the conditional, its comment and the now-unused `trpc` import removed. |
| `VERSION`, `package.json` | 0.28.6 → 0.28.7. |

## Deviations from the approved change summary

One addition, requested mid-build after the summary was approved: when
organisations are enabled the name section is replaced by a **link to
`/admin/organisations`**, rather than simply being absent. The link target
matches the sidebar entry that is itself only revealed while the feature is on,
so it never points somewhere the admin cannot reach. This also changed the model
from a boolean to the two-valued `OrganisationsCardMode`.

Nothing else deviates. Layout order, the wizard being left alone, and the
PATCH-on-`release/alpha-2` target are all as approved.

## Database

None. No table, column, index or migration. `organisation_name` and
`organisations_enabled` keep their existing storage and readers
(`cached-admin-settings.ts`, the chat prompt path).

## Tests

- **Unit** — `organisations-card-model.test.ts`: enabled `true` →
  `"managed-elsewhere"`; `false` → `"single-name"`; `undefined` (query in flight)
  → `"single-name"`. That last case preserves the old page-level `data !== true`
  behaviour; the alternative flashes an empty card on every visit.
- **No Playwright spec written.** Measured against
  [`e2e-test-policy.md`](../../../../guides/e2e-test-policy.md), a conditional
  render inside one settings card falls into none of the six groups — not auth
  session lifecycle, streaming, file transfer, navigation state across a page
  load, the accessibility tree, or smoke. Coverage belongs at the layer owning
  the logic, which is the unit test above.
- **One existing spec needed updating.**
  `apps/web/e2e/code-quality-hot-paths.spec.ts` (Group D — settings page
  decomposition) asserts that every extracted settings card still renders its
  own `<h3>` title, guarding against a card being dropped. Its `CARD_TITLES`
  list contained `'General'`, which was `OrganisationNameCard`'s title on
  `/admin/settings`. The merged card is titled `'Organisations'`, so the entry
  was updated. This was **missed in the phase doc**, which stated no e2e spec
  touched this surface — see "Known limitations".
- **Existing e2e still covers the wizard path.**
  `apps/web/e2e/phase-admin-first-login-setup.spec.ts` asserts `#org-name` is
  visible on the wizard's single-organisation branch and absent on the multi
  branch. The wizard still renders `OrganisationNameCard` and the extraction kept
  the input id, so both assertions hold unchanged.
- The four specs calling `openSettingsSection(page, 'General')` are unaffected:
  that helper targets the section's `aria-expanded` button (an `<h2>`), which was
  not renamed. `openAllSettingsSections` likewise only clicks
  `button[aria-expanded]`, so it never touches the organisations switch
  (`role="switch"`, `aria-checked`).
- `./validate.sh` — 24 passed, 0 failed. The web suite went from 81 files / 821
  tests to 82 / 824.

## Known limitations

- **The e2e impact analysis was incomplete.** The phase doc checked
  `phase-admin-first-login-setup.spec.ts` (which references `#org-name`) but not
  `code-quality-hot-paths.spec.ts`, which asserts card *titles* rather than
  field ids and so did not surface in a search for the field. CI caught it:
  1 failed of 132. The lesson for the next card rename is to grep the e2e suite
  for the **card title** as well as its testids and element ids.

- **ADR-038 drift, carried not fixed.** ADR-038 §6 states organisations have no
  enable/disable toggle and need no disable-guard; the app has had
  `organisations_enabled` since v2.10.0. This change makes that toggle more
  prominent without reconciling the ADR. Out of scope for a PATCH — a later
  change should amend or supersede ADR-038.
- **Two ADRs are numbered 038** (`-organisations-as-sharing-scope` and
  `-step-output-types`). Unrelated subjects, so no decision is ambiguous, but a
  bare "ADR-038" citation is. Pre-existing.
- The link copy is static; it does not report how many organisations exist.
