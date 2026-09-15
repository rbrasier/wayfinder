# PRD — First-Login Welcome Tour

- **Status**: Accepted
- **Date**: 2026-09-04
- **Author**: Richy Brasier
- **Target version**: 0.28.15 on the alpha-2 line (bump: PATCH — chosen by the maintainer over the usual MINOR on `main` for a new feature with an additive schema change)

## 1. Problem

A person signing in for the first time lands on an empty "My Chats" page with
no sense of what Wayfinder is for. Nothing explains that there are two things
to do here — run a guided chat, or design one — and the flow editor greets a
newcomer with a blank canvas, a node picker and vocabulary ("expert role",
"done when", "publish") that reads as a developer tool. Non-technical
operators, the audience Wayfinder is built for, bounce before they reach the
part that would have made sense to them.

## 2. Users / Personas

- **First-time operator** (procurement officer, HR manager, ops lead) — needs
  to know in under a minute whether to start a chat or build a flow, and to
  be walked through building one without reading documentation.
- **Returning flow author** — wants to re-watch the flow explainer when they
  come back to an empty canvas after a break.
- **Any signed-in user** — wants to replay the whole tour from Settings, for
  themselves or when showing a colleague.

## 3. Goals

- On first sign-in the user sees a welcome modal split into "Start a chat" and
  "Build a flow", each with a sentence or two of plain-language explanation.
- Every published flow appears in the chat half as a clickable chat type that
  opens a new chat of that type directly.
- The flow half opens the flows page with the New Flow dialog already open,
  the background dimmed, and a "Step 1" explainer callout visually connected
  to the dialog that explains each field.
- Saving the new flow lands on the configure page with a six-card explainer
  carousel open over a dimmed, blurred canvas, with previous/next arrows,
  position dots and one animated illustration per card.
- The final card's call to action dismisses the carousel and points at the
  "+ Create your first step" button.
- The carousel can be reopened from the flow's three-dot menu and from a
  subtle secondary link under the first-step button on an empty canvas.
- The whole tour can be restarted from the user settings page.
- The tour shows once and only once per user unless restarted.

## 4. Non-goals

- No tour for the admin area, Synthesise, Knowledge or Approvals.
- No per-step (node configuration modal) coaching.
- No analytics on tour completion.
- No partial-progress persistence: closing the browser mid-tour ends it; the
  user can restart it from Settings.

## 5. Key entities

| Entity | Lives in | New / existing | Notes |
| ------ | -------- | -------------- | ----- |
| `User.welcomeTourCompletedAt` | `packages/domain/src/entities/user.ts` | existing entity, new field | `null` means the tour is still pending. |
| `SetWelcomeTourCompleted` | `packages/application/src/use-cases/set-welcome-tour-completed.ts` | new | Marks the tour complete (stamps now) or restarts it (clears the stamp). |
| Tour stage (`new-flow`, `flow-explainer`) | `apps/web/src/components/tour/tour-stage.ts` | new | Carried in the `tour` URL search parameter between the pages of the journey. |
| Explainer cards | `apps/web/src/components/tour/flow-explainer-cards.ts` | new | The six cards' copy and the carousel navigation model. |

## 6. User stories

1. As a first-time operator, I can see at sign-in what Wayfinder does and pick
   between starting a chat and building a flow, so that I am not left on an
   empty page.
2. As a first-time operator, I can click one of the published workflows in
   the welcome modal and be taken straight into a new chat of that type.
3. As a first-time flow author, I can see what each field on the New Flow
   dialog is for while I fill it in.
4. As a first-time flow author, after saving my flow I am shown, in six short
   animated cards using a leave request and a procurement approval as
   examples, what a flow is, how steps work, how each step knows it is done,
   how a Word template becomes the form, how attached rules ground the AI,
   and what publishing does.
5. As a flow author on an empty canvas, I can re-watch the explainer from a
   subtle link under the first-step button or from the flow's menu.
6. As any user, I can restart the whole tour from Settings.

## 7. Pages / surfaces affected

- `(user)` layout — mounts the welcome-tour gate next to the organisation
  sign-in gate.
- `/chats` (and every `(user)` page) — welcome modal on first sign-in.
- `/flows?tour=new-flow` — New Flow dialog open on load with the Step 1
  callout; creating the flow continues to `/flows/<id>/config?tour=flow-explainer`.
- `/flows/<id>/config` — explainer carousel (on load during the tour, from the
  menu, or from the empty-canvas link); "Start here" pointer after the CTA.
- `/settings` — "Welcome tour" card with a restart button.
- tRPC: `user.me` gains `welcomeTourPending`; `user.completeWelcomeTour` and
  `user.restartWelcomeTour` added.
- `POST /api/auth/test-session` (test-only) — marks the user's tour complete
  unless the request asks for `tour: "pending"`, so the existing e2e suite
  never meets the modal.

## 8. Database changes

| Table | Change | Prefix valid? |
| ----- | ------ | ------------- |
| `core_users` | add column `welcome_tour_completed_at timestamptz` (nullable), backfilled to `now()` for rows that exist at migration time | n/a (existing) |

## 9. Architectural decisions

- ADR-056 — Welcome tour state lives on the user row; the journey hands off
  between pages through a `tour` URL stage rather than client-side state;
  animations are beat-sequenced in JS with CSS doing the drawing, so reduced
  motion can hold the final frame.
- Assumes ADR-038 §4 (organisation sign-in gate — the tour yields to it) and
  ADR-041 (the admin first-run wizard is a separate, unrelated onboarding).

## 10. Acceptance criteria

- [ ] A user whose `welcome_tour_completed_at` is null sees the welcome modal
      on a `(user)` page; a user with a timestamp does not.
- [ ] The modal follows the organisation nomination dialog whichever way that
      closes — confirmed or dismissed with "Not now".
- [ ] The modal lists every flow `session.listPublishedFlows` returns; clicking
      one creates a session and navigates to it; the tour is marked complete.
- [ ] "Build a flow" marks the tour complete and navigates to
      `/flows?tour=new-flow`; the dialog is open on load with the callout.
- [ ] A user without `workflow:create_own` sees the flow half disabled with a
      note rather than a broken link.
- [ ] Closing the New Flow dialog during the tour clears the `tour` parameter.
- [ ] Creating a flow with the stage set navigates to the configure page with
      `tour=flow-explainer`; the carousel is open on load.
- [ ] The carousel has six cards, previous/next arrows, six dots, arrow-key
      navigation, and its last card's CTA closes it and highlights the
      first-step button.
- [ ] The carousel opens from the flow menu item "How flows work" and from the
      empty-canvas link "Watch how flows work".
- [ ] Every animation holds its finished frame under
      `prefers-reduced-motion: reduce`.
- [ ] "Restart the welcome tour" in Settings clears the stamp and returns the
      user to `/chats`, where the modal shows again.
- [ ] Existing accounts are backfilled as complete by the migration.
- [ ] The existing e2e suite runs without ever meeting the modal.

## 11. Out of scope / future work

- Coaching inside the node configuration modal (instructions, done-when,
  template upload) — the cards describe these; a later phase could point at
  the real fields.
- A tour for the admin area.

## 12. Risks / open questions

- The modal must never stack on the organisation nomination dialog. The gate
  yields while that dialog is on screen — tracked as a shared dismissal rather
  than read off `organisation.signInState`, which keeps reporting `nominate`
  after a "Not now" and would otherwise suppress the tour for good.
- The animations are the largest piece of UI; they are decorative and hidden
  from assistive technology, with the card copy carrying the whole lesson.
