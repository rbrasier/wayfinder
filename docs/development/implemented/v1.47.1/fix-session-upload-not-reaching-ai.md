# Bug Fix — Attached session uploads don't reach the AI

## Symptom

A user attaches a document to the chat composer (e.g. `Dave.docx`, a short email
asking to "purchase Office 365 licences… about $99 each"), the upload succeeds
and shows a filename pill, but when the user sends a message the AI replies that
it "can't see the request details" — as if no document were attached. The
document content never influences the answer.

Severity: **Minor** — the app keeps working and the upload itself succeeds, but
the attach-context feature silently fails and the AI gives an uninformed answer.

## Reproduction

1. Open an active chat session.
2. Attach a short document as context (docx / txt) whose body is a request, e.g.
   the Dave email above.
3. Send a loosely-worded message such as *"Here is the request I've been asked to do"*.
4. Observe: the AI says it cannot see any details — the attached document was not
   consulted.

## Root cause (verified)

The chat turn injects document content into the prompt **only** via semantic RAG
retrieval, and that retrieval is gated by a single, relatively high similarity
threshold shared across all document sources.

- On each turn the stream route embeds the *user's latest message* as the search
  query and retrieves chunks (`apps/web/src/app/api/chat/[sessionId]/stream/route.ts:78`).
- Retrieval filters chunks by cosine similarity `>= 0.5` and returns the top `5`
  (`packages/application/src/use-cases/session/retrieve-document-chunks.ts:9-10`,
  enforced in `packages/adapters/src/repositories/drizzle-document-chunks-repository.ts:84`).
- The user's message *"Here is the request I've been asked to do"* is a
  meta-statement that is semantically **dissimilar** to the email body about
  purchasing licences, so the only relevant chunk scores below `0.5` and is
  filtered out. The AI sees nothing.

Crucially, the upload's full extracted text **is** stored on the `session_upload`
row (`apps/web/src/app/api/chat/[sessionId]/uploads/route.ts:101`) but the chat
turn never reads that stored text — it depends entirely on similarity-gated
retrieval.

The deeper modelling issue: **session uploads are not the same as flow context
docs.** A flow context doc is a curated, potentially large knowledge base where a
strict threshold keeps only on-point excerpts. A session upload is a (usually
small) document the operator *deliberately attached* for the current request, and
they reasonably expect it to be read. The two sources should not share one
retrieval threshold/limit.

## Fix plan

Give the two document scopes independent retrieval parameters in
`RetrieveDocumentChunks`:

- **Flow context docs** keep the strict defaults: `minSimilarity 0.5`, `limit 5`.
- **Session uploads** get permissive defaults: `minSimilarity 0.2`, `limit 8`, so a
  deliberately-attached document reaches the prompt even when the user's wording
  is only loosely related.

Implementation:

1. Split the single combined search into two scoped searches inside the use-case
   (one for the flow scope, one for the session scope), embedding the query once
   and passing each scope its own `limit` / `minSimilarity`. Merge and rank the
   results by similarity.
2. Update `RetrieveDocumentChunks` input to accept per-scope overrides
   (`flowLimit` / `flowMinSimilarity` / `sessionLimit` / `sessionMinSimilarity`).
3. Callers (`route.ts`, `turn-helpers.ts`) need no change — they rely on the new
   defaults.

## Tests

- **Regression (unit, fail-first):** `retrieve-document-chunks.test.ts` asserts the
  session scope is searched with the permissive params (`minSimilarity 0.2`,
  `limit 8`) and the flow scope with the strict params — fails on the old
  single-threshold code.
- **E2E (Playwright):** upload a short document, send a loosely-worded message,
  assert the AI response reflects the document content. Skips gracefully when
  infra / AI keys are unavailable.

## Version

PATCH bump: `1.47.0` → `1.47.1` (behaviour fix, no schema change).
