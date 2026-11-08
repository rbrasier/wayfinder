# ADR-068 — The Frozen PDF Is the Signed Record

- **Status**: Proposed (scoped by `document-signatures.prd.md`)
- **Date**: 2026-11-08
- **Builds on**: ADR-067 (signature methods, engine), ADR-043 (signature slot and
  re-render path), ADR-045 (approver field editing), ADR-055 (off-system approval),
  ADR-024 (manual document editing)
- **Amends**: ADR-043 §4 (Word signature machinery remains rejected, but under the
  certificate method the PDF, not the `.docx`, is the signed record); ADR-045
  (no approver edits once frozen); ADR-055 §1 (evidence on certificate steps must
  be a validly signed PDF).
- **Numbering**: 068 is free on both `release/alpha-3` and `main`.

## Context

ADR-043 re-renders the whole document after every approval decision
(`ApplyApprovalSignature`), and ADR-045 lets approvers edit fields before deciding.
That is correct for attestation text: each render produces a new `.docx` with the
latest blocks.

A PAdES signature covers specific bytes. Re-rendering the `.docx` and re-converting
would produce a different PDF and invalidate every earlier signature. A document
signed by several approvers must therefore stop being regenerated at the first
signature and accumulate later signatures as incremental PDF revisions.

The template still says *where* each signature belongs, through its ADR-043 slots,
but a converted PDF has no slots — only text at coordinates.

## Decision

### 1. Freeze at the first certificate signature

When the first slot-claiming approval on a document begins certificate signing,
`FreezeDocumentForSigning`:

1. renders the `.docx` with every decided slot filled as today and every
   *undecided* slot replaced by an **anchor** — a unique, invisible token
   (`⟦wf-slot:<slotKey>⟧`, white 1pt text);
2. converts it to PDF/A via `IPdfConverter`;
3. locates each anchor's page and bounding box by text extraction and records it;
4. stores the PDF and writes `SessionDocument.pdf = { storagePath, sha256,
   frozenAt, status: "frozen", slotAnchors }`.

From then on the frozen PDF is the record. `ApplyApprovalSignature`,
`GenerateDocument` regeneration, manual editing (ADR-024) and approver field
editing (ADR-045) all refuse with `VALIDATION_FAILED` ("document is frozen for
signing") for that document. The `.docx` remains available as a working copy but
is labelled as unsigned.

The approver previews the frozen PDF — not the `.docx` — before authorising, so
what they sign is what they saw. Conversion differences from Word are visible at
that point rather than discovered later.

### 2. Signatures land at their slot

Each certificate signature's visible appearance — the approver's drawing, name,
date and verification code — is placed at its slot's recorded anchor rectangle by
DSS's visible-signature parameters. A signature whose slot has no anchor (a
lone-slot fallback where the anchor could not be located) is placed on an appended
signature page rather than failing, and the anomaly is logged.

### 3. Changes requested or rejection restarts signing

A `changes_requested` or `rejected` decision on a frozen document marks
`SessionDocument.pdf.status = "superseded"`. The next generation produces a new
document; earlier certificate signatures are not carried over, because they cover
bytes that no longer represent the document. Superseded PDFs are retained for audit.

### 4. Drawn-method PDFs are not frozen

Under the `drawn` method with `convertToPdfOnSigning`, no cryptographic signature
exists to break, so each decision re-renders the `.docx` and re-converts — ADR-043's
re-render path is unchanged.

### 5. Off-system approval on certificate steps

On a slot-claiming step under the `certificate` method, ADR-055's evidence must be
a PDF that DSS validates as `valid` **and** whose signed revision's content is the
frozen document (the signed byte range begins with the frozen PDF's bytes,
compared against `SessionDocument.pdf.sha256`). The signing certificate's subject
or SAN email must match the nominated approver. On success the uploaded PDF becomes
the current frozen revision. Any other evidence is rejected with its reason.

### 6. The signature record lives on the approval row

One approval decision yields at most one signature, so the record is a nullable
`digital_signature jsonb` column on `app_session_approvals`: method, certificate
subject / issuer / serial / SHA-256 fingerprint, signing time, timestamp time,
PAdES level, PDF revision number, and the latest validation
`{ badge, reason, checkedAt }`. No new table (ADR-006).

`signature.signed`, `signature.rejected` and `signature.validated` events are
written to `core_audit_log` with the approval id, and the record is included in the
hash input of the decision's audit entry.

## Consequences

- Multi-signer certificate documents are coherent: each signature validates on its
  own revision and the whole chain validates in Acrobat.
- Approver edits and regeneration end at the first certificate signature — a
  deliberate behaviour change for certificate installs only.
- Attestation and drawn installs keep ADR-043's re-render behaviour.
- Anchor location depends on text extraction from the converted PDF; the
  appended-page fallback keeps signing working if it fails.

## Alternatives considered

- **Re-convert and re-sign everything each time** — invalidates earlier
  signatures; signers would have to sign repeatedly.
- **Invisible signatures only** — simpler, but signed documents would show blank
  slots on the page, with the signatures visible only in Acrobat's panel.
- **Defer conversion to the last approval** — earlier approvers would have nothing
  to sign.
