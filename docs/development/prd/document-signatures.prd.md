# PRD — Document Signatures (Drawn and Certificate-Based)

- **Status**: Draft
- **Date**: 2026-11-08
- **Author**: richy.brasier (from issue #386, raised by johntooth)
- **Target version**: 0.42.0 → 0.44.0 across three phases (bump: MINOR each —
  schema change in phases 1 and 2, new feature in phase 3). Targets
  `release/alpha-3` by explicit maintainer decision (see §12).
- **Builds on**: ADR-043 (signature tag, attestation block), ADR-033 (audit log),
  ADR-041/042 (DB-first config, live Test, deploy-time trust anchors), ADR-055
  (off-system approval), ADR-030 (sidecar pattern)
- **Introduces**: ADR-067, ADR-068

## 1. Problem

When someone approves a document in Wayfinder, the proof stays inside Wayfinder.
The ADR-043 attestation block (name, decision, date, verification code) is backed
by the audit log's hash chain — an *advanced* electronic signature that only
Wayfinder can check. Once a document leaves the system, nobody can independently
verify who signed it or whether it has changed.

Regulated customers — procurement contracts, delegations, HR instruments — need a
**digital signature anyone can verify with standard tools, years later**. That
blocks adoption. Separately, customers without that obligation still want the
familiar visual of a handwritten signature in the slot, which the text-only
attestation block does not give them.

Today Wayfinder generates `.docx` and `.xlsx` only, and nothing in the codebase
signs a document cryptographically.

## 2. Users / Personas

- **Application administrator** — chooses the install-wide signature method and
  configures the signing provider and timestamp authority, with a live Test.
- **Infrastructure engineer** — runs the PDF and signing sidecars and owns the
  deploy-time trust anchors.
- **Flow author** — decides per approval step whether the signed output becomes a
  PDF.
- **Approver** — signs: draws a signature once, or authorises a certificate
  signature at their remote-signing provider.
- **External recipient / auditor** — verifies a signed PDF in Adobe Acrobat or the
  EU DSS validator without Wayfinder; exports signature metadata.

## 3. Goals

- An admin selects one install-wide **signature method** on a new
  **PDF signatures** card: *Attestation only* (today, default), *Drawn signature*,
  or *Digital certificate*.
- With *Drawn signature*, an approver is prompted to draw their signature the
  first time they sign; it is remembered and placed into the signature slot of
  `.docx` and PDF documents on later signings.
- With *Digital certificate*, the approver signs through a CSC-API remote-signing
  provider and the result is a PAdES B-LTA PDF, with an RFC 3161 timestamp and
  embedded revocation data, that Acrobat and the EU DSS validator accept. The
  approver's drawn signature is the visible appearance of the signature.
- A flow author can set **Convert to PDF on signing** per approval step; it is
  forced on when the method is *Digital certificate*.
- Each document shows who signed, when, with which certificate and timestamp, and
  a validation badge: valid / valid-but-expired / invalid-modified /
  unverifiable.
- Certificate signing **fails closed**: a signing, timestamp, conversion or
  validation failure blocks the step and is never skipped.

## 4. Non-goals

- Local smartcard / USB-token signing in the browser (needs a native helper).
- Periodic archive re-timestamping beyond the B-LTA document timestamp at signing.
- Drawn signatures in `.xlsx` outputs — the attestation text remains there.
- Per-flow or per-step signature methods — the method is install-wide.
- Wayfinder acting as a certificate authority or signing service.
- Describing a drawn signature as a digital or qualified signature, anywhere.

## 5. Key entities

| Entity | Lives in | New / existing | Notes |
| ------ | -------- | -------------- | ----- |
| `SignatureMethod` | `packages/domain/src/entities/signature-settings.ts` | new | `"attestation" \| "drawn" \| "certificate"` |
| `SignatureSettings` | same | new | method + CSC provider, TSA, sidecar URLs; persisted in `admin_system_settings` |
| `DrawnSignature` | `packages/domain/src/entities/drawn-signature.ts` | new | the user's remembered image (storage path, captured at) |
| `DigitalSignatureRecord` | `packages/domain/src/entities/digital-signature.ts` | new | per approval: method, certificate subject/issuer/serial/fingerprint, signing time, timestamp time, level, latest validation |
| `SignatureValidation` | same | new | badge + reason (`expired`, `revoked`, `untrusted`, `wrong_key_usage`, `modified`, `unavailable`) |
| `SessionDocument.pdf` | `packages/domain/src/entities/session-message.ts` | existing, extended | optional frozen-PDF fields (storage path, sha256, frozenAt, status) |
| `ApprovalNodeConfig.convertToPdfOnSigning` | `packages/domain/src/entities/flow-node.ts` | existing, extended | optional boolean |
| Ports `IPdfConverter`, `IRemoteSigningProvider`, `ISignatureEngine`, `ITimestampAuthority` | `packages/domain/src/ports/` | new | adapters in `packages/adapters/src/signing/` |

## 6. User stories

1. As an admin, I choose the signature method and, for certificates, configure the
   CSC provider and TSA, and I can only save *Digital certificate* after the live
   Test passes.
2. As a flow author, I tick *Convert to PDF on signing* on an approval step so the
   signed document is distributed as a PDF.
3. As an approver on a drawn-signature install, I draw my signature the first time
   I approve, and never again unless I choose to redraw it from my profile.
4. As an approver on a certificate install, I click *Approve & sign*, authorise at
   my provider, and return to see my signature listed as valid.
5. As an approver, when signing fails I see the specific reason (expired, revoked,
   untrusted, wrong key usage, service unavailable) and the step stays pending.
6. As a recipient, I open the signed PDF in Acrobat and the signatures validate
   without access to Wayfinder.
7. As an approver recording an off-system approval on a certificate step, I upload
   the PDF the signer already signed, and Wayfinder accepts it only if it
   validates over the frozen document.
8. As an auditor, I export signature metadata for a session.

## 7. Pages / surfaces affected

- `/admin/settings` — new **PDF signatures** card (method picker, provider/TSA/
  sidecar fields, live Test).
- Flow canvas — approval node config gains **Convert to PDF on signing** (locked on
  under *Digital certificate*).
- Approval decision UI — drawing pad on first signing; *Approve & sign* redirect
  flow; blocked state with reason.
- User profile — *Redraw signature*.
- Session document view — **Signatures** panel with badges, PDF download, metadata
  export.
- Route `GET /api/signing/csc/callback` — returns the approver from the CSC
  provider's authorisation.
- tRPC: `settings.getSignatureSettings` / `setSignatureSettings` /
  `testSignatureSettings`; `profile.getDrawnSignature` / `saveDrawnSignature`;
  `approvals.startCertificateSigning`; `signatures.listForSession` /
  `revalidate` / `exportMetadata` — added. `approvals.decide` and
  `approvals.recordOffSystem` — changed.

## 8. Database changes

| Table | Change | Prefix valid? |
| ----- | ------ | ------------- |
| `core_users` | add `drawn_signature_storage_path text` (nullable), `drawn_signature_updated_at timestamptz` (nullable) | n/a (existing) |
| `app_session_approvals` | add `digital_signature jsonb` (nullable) | n/a (existing) |
| `app_session_messages` | none — `document` jsonb gains optional `pdf` fields | n/a |
| `admin_system_settings` | none — new `signature.*` keys | n/a |

Both migrations add nullable columns only; no `-- data-impact:` declaration is
required. No new tables: one approval decision is one signature, so the record
belongs on the approval row (ADR-006 — jsonb over join tables).

## 9. Architectural decisions

- **ADR-067** — Signature methods, the signing engine, and the sidecars: an
  install-wide method; Gotenberg (`pdf` profile) for conversion; EU DSS (`signing`
  profile) for PAdES assembly and validation; CSC called from Wayfinder; mocks.
- **ADR-068** — The frozen PDF is the signed record: freeze on the first
  certificate signature, slot anchors for in-place appearances, and the amendments
  to ADR-043 §3/§4, ADR-045 and ADR-055.

## 10. Acceptance criteria

**Configuration**
- [ ] The PDF signatures card lists the three methods; *Attestation only* is the
      default and existing installs behave exactly as before.
- [ ] *Digital certificate* cannot be saved until a live Test passes against the
      CSC provider, TSA, Gotenberg and DSS; *Drawn* with any PDF-converting step
      requires Gotenberg's Test to pass. Server-side rejection, not only UI.
- [ ] Trust anchors are read from deploy-time configuration only; nothing in the
      UI or tRPC can read or edit them.

**Drawn signature**
- [ ] An approver with no stored drawing cannot complete a decision on a slot-
      claiming step until they draw one; the drawing is stored and reused.
- [ ] The image renders in the claimed `.docx` slot above the unchanged ADR-043
      attestation block; `.xlsx` slots keep the attestation text only.
- [ ] Only the signing user's own drawing is ever placed; there is no API that
      saves a drawing for another user.

**Certificate signature**
- [ ] Signatures are PAdES B-LTA with an RFC 3161 timestamp and embedded
      OCSP/CRL, and pass the EU DSS validator and Adobe Acrobat (given a trusted
      CA).
- [ ] Remote signing uses the CSC API (ETSI TS 119 432); the approver authorises
      at the provider.
- [ ] Chain, validity, key usage and revocation are checked before acceptance;
      failures return `expired` / `revoked` / `untrusted` / `wrong_key_usage`.
- [ ] The approver's comment is embedded as the signature's reason.
- [ ] The approver's drawn signature, when present, is the visible appearance,
      positioned at the slot.
- [ ] If any sidecar, provider or TSA is unavailable, the step stays pending and
      the reason `unavailable` is shown — never skipped.
- [ ] After the first certificate signature the document is frozen: no re-render,
      no approver field edit; later signatures are incremental. Changes requested
      or rejection produces a new document and requires all signatures again.
- [ ] Off-system approval on a certificate step requires an uploaded PDF carrying
      a valid PAdES signature over the frozen document's bytes.

**Visibility and audit**
- [ ] Each document lists signer, time, certificate, timestamp and one of
      valid / valid-but-expired / invalid-modified / unverifiable.
- [ ] Signing, rejected-signature and validation events are written to
      `core_audit_log`; signature metadata exports as CSV and JSON.

**Testing**
- [ ] Mock CSC (`/csc`), TSA (`/tsa`), OCSP/CRL (`/ocsp`), Gotenberg
      (`/gotenberg`) and DSS (`/dss`) endpoints exist on the shared `mocks/`
      server with their own tests, and the admin Test passes against them.
- [ ] The mock CA is trusted only behind a dev-only flag; a production build with
      the flag set refuses to start.

## 11. Out of scope / future work

- Archive re-timestamping job (PAdES-LTA renewal before TSA certificate expiry).
- Per-flow signature method override.
- Drawn signatures inside `.xlsx`.
- Local smartcard signing via a native helper.
- Signing uploaded (non-generated) documents.

## 12. Risks / open questions

- **Release line.** This is a new feature on `release/alpha-3`, which normally
  takes fixes only. The maintainer chose this deliberately. Version numbers
  claimed here (0.42.0–0.44.0) must be skipped by `main`'s next MINOR on forward
  merge so versions never collide.
- **Conversion fidelity.** LibreOffice may lay out some `.docx` differently from
  Word; the PDF the approver previews and signs is the record.
- **New infrastructure.** First compose profiles in the repo (`pdf`, `signing`);
  the DSS image is ours to build and publish under ADR-046; the Lambda topology
  (ADR-056) must point at externally hosted sidecars.
- **Image insertion into `.docx`.** docxtemplater's image module is a paid add-on;
  ADR-067 decides between writing the OOXML drawing ourselves and licensing it.
- **Acrobat trust.** A green tick depends on the signer's CA being in Adobe's
  AATL or the EU trusted lists — outside Wayfinder's control.
- **Drawn signatures are simple electronic signatures.** Copy must never call
  them digital or qualified.

## Approved change summary

Approved 2026-11-08 in the issue #386 planning session.

The admin picks one install-wide signature method on a new **PDF signatures**
card: *Attestation only* (default), *Drawn signature* (approver draws once,
remembered, written into `.docx` and PDF slots), or *Digital certificate* (CSC
remote signing, PAdES B-LTA incrementally on a frozen PDF/A, validated by EU DSS,
with the approver's drawing as the on-page appearance). Approval nodes get one
toggle, **Convert to PDF on signing**, locked on under *Digital certificate*.
Signatures appear only where a template has an ADR-043 slot claimed by an
approval step.

- **Business rules**: signing happens where an approval claims a slot; drawn
  method requires a stored drawing before the decision completes; certificate
  method completes only on a validated signature and fails closed; first
  certificate signature freezes the PDF, later ones are incremental; changes
  requested / rejection restarts signatures; off-system approval on certificate
  steps needs a validly signed PDF; *Digital certificate* requires a passing Test;
  trust anchors are deploy-time only.
- **UI**: PDF signatures card with Test; node toggle; drawing pad on first sign
  and *Redraw* in profile; *Approve & sign* redirect; Signatures panel with
  badges, PDF download and metadata export.
- **Database**: nullable `digital_signature jsonb` on `app_session_approvals`;
  nullable drawn-signature columns on `core_users`; `SessionDocument.pdf` and
  `admin_system_settings` keys need no migration.
- **Sidecars**: Gotenberg under a `pdf` profile (any method converting to PDF);
  EU DSS under a `signing` profile (certificate only), self-built image.
- **Mocks**: `/csc`, `/tsa`, `/ocsp` with a throwaway test CA, `/gotenberg` and
  `/dss` canned responses on the shared `mocks/` server; in-memory port fakes for
  unit tests; mock CA trusted only behind a dev-only flag.
- **Docs**: 1 PRD, 2 ADRs, 3 phase docs. Target `release/alpha-3` (maintainer
  override of the new-features-on-`main` rule).
