# Phase — Document Signatures 2: Certificate Signing (CSC + PAdES)

- **Status**: Draft — run `/doc-review` before `/build`
- **Target version**: PATCH — 0.41.2 → 0.41.3 (schema change: nullable
  `digital_signature` on `app_session_approvals`; PATCH rather than MINOR by
  maintainer decision — see PRD §12)
- **Base branch**: `release/alpha-3` (maintainer override — see PRD §12)
- **PRD**: `docs/development/prd/document-signatures.prd.md`
- **ADRs**: ADR-067 (§1, §4–7), ADR-068 (§1–3, §6)
- **Depends on**: `document-signatures-1-config-drawn-pdf.phase.md`
- **Followed by**: `document-signatures-3-validation-and-audit.phase.md`

## 1. Goal

*Digital certificate* becomes selectable. An approver on a slot-claiming step
authorises a CSC remote signature; Wayfinder freezes the document as PDF/A, and
DSS produces a PAdES B-LTA signature with RFC 3161 timestamp and embedded
revocation data, appearing at the slot with the approver's drawing. Every failure
blocks the step with a specific reason.

## 2. What is built

| Layer | File | Change |
| ----- | ---- | ------ |
| domain | `entities/digital-signature.ts` (+ test) | `DigitalSignatureRecord`, `SignatureValidation`, badge/reason mapping from engine indications (ADR-067 §4 table) |
| domain | `entities/signature-settings.ts` | allow `certificate`; CSC base URL, client id, encrypted client secret, credential selection, TSA URL, DSS URL |
| domain | `entities/session-message.ts` | `SessionDocument.pdf` gains `frozenAt`, `status: "frozen" \| "superseded"`, `slotAnchors` |
| domain | `ports/remote-signing-provider.ts` | `IRemoteSigningProvider`: `buildAuthoriseUrl`, `exchangeCode`, `listCredentials`, `signHash` |
| domain | `ports/signature-engine.ts` | `ISignatureEngine`: `prepare`, `incorporate`, `validate` |
| domain | `ports/timestamp-authority.ts` | `ITimestampAuthority.probe` (DSS fetches tokens itself; port exists for the Test) |
| application | `use-cases/signing/freeze-document-for-signing.ts` (+ test) | ADR-068 §1: anchors, convert, locate, store |
| application | `use-cases/signing/start-certificate-signing.ts` (+ test) | freeze if needed, `prepare`, return provider authorise URL; state bound to approval + user |
| application | `use-cases/signing/complete-certificate-signing.ts` (+ test) | exchange code, `signHash`, `incorporate`, `validate`; only `valid` records the decision; else `pending` + reason |
| application | `use-cases/approvals/decide-approval.ts` | under `certificate`, slot-claiming approvals decide only via complete-certificate-signing; comment becomes signing reason |
| application | `apply-approval-signature.ts`, generate/edit use cases | refuse when `SessionDocument.pdf.status = "frozen"` (ADR-068 §1) |
| application | changes-requested / rejected handling | mark PDF `superseded` (ADR-068 §3) |
| application | `test-signature-settings.ts` | CSC `info` + credentials, TSA token, DSS reference validation, Gotenberg |
| adapters | `signing/csc-remote-signing-adapter.ts` (+ test) | CSC v2 OAuth + `signatures/signHash` |
| adapters | `signing/dss-signature-engine.ts` (+ test) | DSS REST client; visible-signature parameters at anchor rect |
| adapters | `signing/pdf-anchor-locator.ts` (+ test) | locate anchor tokens' page/rect in a PDF |
| adapters | `repositories/drizzle-approval-repository.ts` | read/write `digital_signature` |
| adapters | `health/connectivity-probes.ts` | CSC, TSA, DSS probes |
| apps/web | `app/api/signing/csc/callback/route.ts` | OAuth return → complete-certificate-signing → redirect to the approval |
| apps/web | tRPC `approvals.startCertificateSigning` | added |
| apps/web | approval UI | *Approve & sign*; frozen-PDF preview; blocked state with reason |
| apps/web | approval node config | toggle locked on under `certificate`, with explanation |
| apps/web | PDF signatures card | certificate fields, Test |
| infra | `deploy/dss/` | Spring Boot DSS REST image, trust-anchor mount path documented |
| infra | compose files | `dss` service under `profiles: [signing]`; `DSS_URL`, `SIGNING_TRUST_ANCHORS_PATH`, `SIGNING_TRUST_MOCK_CA` in `.env.example` and guides |
| ci | publish workflow | build/publish the DSS image alongside the app image (ADR-046) |
| apps/web | `lib/env.ts` | refuse to start with `SIGNING_TRUST_MOCK_CA=true` in production |
| mocks | `mocks/signing/csc.mjs`, `tsa.mjs`, `ocsp.mjs`, `dss.mjs`, `test-ca.mjs` (+ tests) | ADR-067 §7; certificate picker scenarios: valid, expired, revoked, wrong key usage, untrusted chain |

## 3. Database changes

Generated migration adding to `app_session_approvals`:

- `digital_signature jsonb` — nullable

Additive nullable column: no `-- data-impact:` declaration needed.

## 4. Implementation order (tests first)

1. Domain entities, badge mapping table tests, ports.
2. In-memory port fakes scripted per reason (`expired`, `revoked`, `untrusted`,
   `wrong_key_usage`, `modified`, `unavailable`).
3. Freeze, start, complete use cases; frozen-document refusals; superseding.
4. Mocks: test CA, `/csc`, `/tsa`, `/ocsp`, `/dss` + tests.
5. Adapters against the mocks; anchor locator.
6. Migration; DSS image and compose profile; env guard.
7. Callback route, tRPC, UI.
8. Adapter integration job: real Gotenberg + DSS containers against `/csc`,
   `/tsa`, `/ocsp`, asserting B-LTA output validates.
9. Bump to 0.41.3; `./validate.sh`.

## 5. Tests

- Unit: every badge/reason mapping row; fail-closed on each port error; frozen
  refusals for re-render, manual edit, approver edit; superseded on changes
  requested; comment embedded as reason; state parameter bound to approval and
  user (no cross-approval completion).
- Adapter: CSC and DSS clients against mocks; real-sidecar integration job.
- E2E (approval group): approver signs via `/csc` picker → valid badge; picks the
  revoked certificate → blocked with "revoked".

## 6. Acceptance criteria

- [ ] PAdES B-LTA output with timestamp and embedded OCSP/CRL; real-sidecar job
      validates it with DSS.
- [ ] CSC authorisation round-trip; Wayfinder never handles a private key.
- [ ] Each failure reason blocks the step and is shown; outages show
      `unavailable`; no fallback.
- [ ] Appearance at the slot with drawing, name, date, verification code;
      appended page when an anchor is missing.
- [ ] First signature freezes; later signatures incremental; earlier ones still
      validate after the last.
- [ ] Changes requested / rejection supersedes the PDF and restarts signing.
- [ ] *Digital certificate* cannot be saved without a passing Test.
- [ ] App refuses to start with the mock-CA flag in production.

## 7. Risks

- CSC providers vary in OAuth scope (`service` vs `credential`) and SCAL level —
  adapter supports `credential` scope with SAD per signature; others documented as
  unsupported.
- Anchor extraction across LibreOffice versions — pinned Gotenberg version,
  fallback page.
- DSS image maintenance and CVE patching become ours.
