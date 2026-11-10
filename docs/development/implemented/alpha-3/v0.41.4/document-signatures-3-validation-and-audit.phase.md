# Phase — Document Signatures 3: Validation Panel, Off-System Signed PDFs, Audit Export

- **Status**: Draft — run `/doc-review` before `/build`
- **Target version**: PATCH — 0.41.3 → 0.41.4 (no schema change; PATCH by
  maintainer decision — see PRD §12)
- **Base branch**: `release/alpha-3` (maintainer override — see PRD §12)
- **PRD**: `docs/development/prd/document-signatures.prd.md`
- **ADRs**: ADR-067 (§4), ADR-068 (§5–6)
- **Depends on**: `document-signatures-2-certificate-signing.phase.md`

## 1. Goal

Make verification visible and auditable: a Signatures panel on every signed
document, on-demand revalidation, off-system approvals backed by an externally
signed PDF, and signature metadata export.

## 2. What is built

| Layer | File | Change |
| ----- | ---- | ------ |
| application | `use-cases/signing/list-session-signatures.ts` (+ test) | signer, time, certificate, timestamp, badge per approval |
| application | `use-cases/signing/revalidate-document.ts` (+ test) | re-run `ISignatureEngine.validate` on the current frozen PDF; update `digital_signature.validation`; audit `signature.validated` |
| application | `use-cases/approvals/record-off-system-approval.ts` | under `certificate` on a slot-claiming step: evidence must be a PDF, validate `valid`, signed revision must begin with the frozen PDF (sha256), signer must match nominee (ADR-068 §5); on success becomes current frozen revision |
| application | `use-cases/signing/export-signature-metadata.ts` (+ test) | CSV and JSON for a session or date range; reuses CSV writer port (ADR-054) |
| application | audit | `signature.signed`, `signature.rejected`, `signature.validated` event types and hash input inclusion |
| apps/web | session document view | **Signatures** panel: badge (valid / valid-but-expired / invalid-modified / unverifiable), reason tooltip, *Revalidate*, PDF download |
| apps/web | off-system approval dialog | signed-PDF requirement copy and rejection reasons on certificate steps |
| apps/web | audit area | *Export signature metadata* |
| apps/web | tRPC `signatures.listForSession`, `revalidate`, `exportMetadata` | added |
| mocks | `mocks/signing/dss.mjs` | scenarios for an externally signed PDF (matching / non-matching base revision) |

## 3. Database changes

None. Uses `app_session_approvals.digital_signature` from phase 2 and
`core_audit_log`.

## 4. Implementation order (tests first)

1. List / revalidate / export use cases with fakes.
2. Off-system rules: non-PDF, invalid, wrong base revision, wrong signer, valid.
3. Audit event types and hash input.
4. tRPC and UI.
5. Bump to 0.41.4; `./validate.sh`.

## 5. Tests

- Unit: badge rendering per mapping; revalidation updates record and audit; each
  off-system rejection reason; export columns stable.
- E2E (approval group): Signatures panel shows valid badge after signing; an
  off-system upload of an unsigned PDF on a certificate step is rejected.

## 6. Acceptance criteria

- [ ] Every signed document lists signer, time, certificate, timestamp and badge.
- [ ] *Revalidate* refreshes the badge and writes an audit event.
- [ ] Off-system approval on a certificate step accepts only a validly signed PDF
      over the frozen document from the nominated signer.
- [ ] Signing, rejection and validation events are in `core_audit_log`.
- [ ] Signature metadata exports as CSV and JSON.

## 7. Risks

- Revalidation depends on DSS and revocation responders being reachable; an
  outage shows `unverifiable` / `unavailable`, never a stale `valid` presented as
  fresh — the panel shows `checkedAt`.
