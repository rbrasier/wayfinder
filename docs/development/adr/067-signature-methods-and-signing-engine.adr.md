# ADR-067 — Signature Methods, the Signing Engine, and the Signing Sidecars

- **Status**: Accepted (scoped by `document-signatures.prd.md`; as built v0.41.2–v0.41.4)
- **Date**: 2026-11-08
- **Builds on**: ADR-001 (hexagonal architecture), ADR-030 (sidecar behind a
  domain port), ADR-041 (DB-first config, live Test), ADR-042 §1 (the switch in
  the database, the trust anchor in the environment), ADR-043 (signature slot,
  attestation block), ADR-046 (container image distribution)
- **Amends**: ADR-043 §3 — a slot may carry a drawn image above the attestation
  block, and under the certificate method the block is accompanied by a PAdES
  signature (see ADR-068 for the record itself).
- **Numbering**: 067 is free on both `release/alpha-3` and `main`.

## Context

ADR-043 deliberately stopped short of cryptography: the attestation block is an
advanced electronic signature whose evidence is `core_audit_log`'s hash chain, and
`attestation-block.ts` forbids describing it as a PKI signature. Issue #386 asks
for the next step — a signature anyone can verify outside Wayfinder — and, in the
planning discussion, for a lighter option: a remembered handwritten-style drawing.

Three facts constrain the design:

1. **Wayfinder produces no PDF.** Outputs are `.docx` and `.xlsx`
   (`ExtractionOutputFormat`), and the only PDF dependency is `pdf-parse`, which
   reads. PAdES — the format Acrobat and the EU validators check — requires a PDF.
2. **No mature Node library produces PAdES B-LT/LTA or performs full
   chain/revocation validation with ETSI-standard indications.** `@signpdf` and
   `pdf-lib` produce basic CMS signatures; LTV, document timestamps and
   ETSI EN 319 102-1 validation would be ours to write and keep correct.
3. **The signer's key lives at their provider.** Remote signing over the CSC API
   (ETSI TS 119 432) signs a *hash*; the provider never sees the PDF and Wayfinder
   never holds a private key.

## Decision

### 1. One install-wide signature method

`SignatureSettings.method` is one of:

| Method | What a claimed slot receives | Needs |
| --- | --- | --- |
| `attestation` (default) | the ADR-043 attestation block, unchanged | nothing new |
| `drawn` | the approver's remembered drawing above the attestation block | Gotenberg only if a step converts to PDF |
| `certificate` | a PAdES B-LTA signature on a frozen PDF, the drawing as its visible appearance, the attestation block beneath | Gotenberg, DSS, CSC provider, TSA |

The method is install-wide, not per step, because it is a statement about the
organisation's legal posture and its infrastructure, and a flow author is not the
person who owns either. *Which* approvals sign is still decided by the template:
an approval signs when it claims an ADR-043 slot (`signatureFieldKey` or the
lone-slot fallback). The flow author's only per-step choice is the output format —
`ApprovalNodeConfig.convertToPdfOnSigning` — and under `certificate` that toggle
is forced on, because PAdES has nothing to sign without a PDF. Forcing it, rather
than silently falling back to attestation, keeps "the step requires a digital
signature" true for every step that claims a slot.

The signing reason is the approver's decision `comment`. There is no separate
reason field: the comment is already the approver's stated rationale, written once
on the approval row (ADR-043 §3 amendment v0.28.21), and a second field would
invite the two to disagree inside one signed document.

Settings persist as `signature.*` keys in `admin_system_settings`, the CSC client
secret encrypted the way other integration secrets are.

### 2. Drawn signatures are remembered per user and placed by the system

The drawing is captured in the approval UI as a PNG on first need, written to
document storage, and its path stored on `core_users.drawn_signature_storage_path`.
Only `saveDrawnSignature` for the authenticated caller writes it; there is no
admin or impersonation path that saves one for someone else, and an impersonated
session (ADR-059) cannot sign.

A drawn signature is a *simple* electronic signature — it binds nothing by itself.
The attestation block stays beneath it so the verification code and the audit-hash
binding remain the evidence. UI copy calls it a "drawn signature", never a digital
or qualified one.

Placement into `.docx` writes an inline `w:drawing` into the slot's run. The
official docxtemplater image module is a paid add-on; the build writes the OOXML
drawing directly in the existing `.docx` adapter (a fixed-size inline picture is a
small, stable part of the spec) rather than take a licensed dependency. `.xlsx`
slots keep the attestation text only.

### 3. Gotenberg converts `.docx` to PDF/A, behind `IPdfConverter`

LibreOffice is the only practical headless `.docx` renderer. Embedding it in the
application image would add roughly 500 MB to every install, including those that
never produce a PDF. It therefore runs as the Gotenberg sidecar under a new `pdf`
compose profile, reached through `IPdfConverter` and producing PDF/A-2b so the
document is self-contained for long-term validation.

### 4. EU DSS assembles and validates PAdES, behind `ISignatureEngine`

The European Commission's DSS library is the reference implementation of the ETSI
standards and is what powers the EU DSS demo the issue names as the acceptance
validator. It runs as a thin REST service under a new `signing` compose profile and
is used for exactly three operations:

1. **Prepare** — given the frozen PDF, the signer's certificate chain, the
   visible-appearance image and slot coordinates (ADR-068 §2), return the digest
   to be signed.
2. **Incorporate** — given the signature value, add it as an incremental
   revision, fetch the RFC 3161 timestamp and OCSP/CRL data, and extend to B-LTA.
3. **Validate** — return the ETSI indication and sub-indication per signature.

DSS does not speak CSC, and does not need to: Wayfinder's `CscRemoteSigningAdapter`
(`IRemoteSigningProvider`) sits between *prepare* and *incorporate*, sending the
approver through the provider's OAuth authorisation and calling `signatures/signHash`
with the digest. The provider sees a hash, DSS sees no credentials, and Wayfinder
holds no private key.

DSS indications map to the four user-facing badges:

| DSS result | Badge | Reason |
| --- | --- | --- |
| `TOTAL_PASSED` | valid | — |
| `TOTAL_PASSED`, signing certificate now expired, POE from timestamp | valid-but-expired | `expired` (informational) |
| `TOTAL_FAILED` / `HASH_FAILURE`, `SIG_CRYPTO_FAILURE` | invalid-modified | `modified` |
| `INDETERMINATE` / `REVOKED_NO_POE` | unverifiable | `revoked` |
| `INDETERMINATE` / `OUT_OF_BOUNDS_NO_POE` | unverifiable | `expired` |
| `INDETERMINATE` / `NO_CERTIFICATE_CHAIN_FOUND` | unverifiable | `untrusted` |
| `INDETERMINATE` / `CHAIN_CONSTRAINTS_FAILURE` (key usage) | unverifiable | `wrong_key_usage` |
| sidecar or network failure | unverifiable | `unavailable` |

At signing time only `valid` is accepted; every other row rejects the signature
with its reason and leaves the approval pending.

The EU does not publish a production DSS container, so the build adds a small
Spring Boot image wrapping DSS's REST modules, built and published by the same
ADR-046 pipeline as the application image and version-pinned to it.

### 5. Trust anchors are deployment configuration

DSS loads its trusted certificates and EU LOTL settings from files mounted at
deploy time. Nothing in the application reads or edits them — the same split as
ADR-042 §1, for the same reason: whoever controls the trust list controls what
counts as a valid signature.

### 6. Fail closed, and Test before enable

Every port returns the Result pattern; any error at prepare, authorise,
incorporate, timestamp or validate leaves the approval `pending`, writes a
`signature.rejected` audit event with the reason, and shows it to the approver.
There is no fallback to attestation.

`testSignatureSettings` probes, through `IConnectivityTester`, exactly what the
chosen method and the flows' toggles need: Gotenberg converts a one-line `.docx`;
DSS validates a bundled reference PDF; the CSC provider answers `info` and the
configured credential list; the TSA returns a token over a test digest.
`setSignatureSettings` rejects `certificate` server-side unless that Test passed on
the values being saved (ADR-041 §2).

### 7. Mocks follow the shared `mocks/` server

New endpoints under `mocks/signing/`, each a `{ path, label, handle }` module
registered in `mocks/server.mjs` with its own `.test.mjs`:

| Path | Stands in for | Behaviour |
| --- | --- | --- |
| `/csc` | CSC remote-signing provider | `info`, OAuth authorise with a certificate picker (valid / expired / revoked / wrong key usage / untrusted chain), `credentials/list`, `signatures/signHash` — real RSA signatures from a throwaway CA generated at startup |
| `/tsa` | RFC 3161 TSA | real timestamp tokens from the same throwaway CA |
| `/ocsp` | OCSP responder + CRL | reports the revoked scenario certificate as revoked |
| `/gotenberg` | Gotenberg | returns a fixed small PDF/A for any `.docx` |
| `/dss` | DSS REST | canned prepare/incorporate/validate responses keyed by scenario |

The canned `/gotenberg` and `/dss` mocks let the existing e2e job run without
LibreOffice or a JVM. A separate adapter test runs the real Gotenberg and DSS
containers against `/csc`, `/tsa` and `/ocsp` so the real crypto path is covered.
Unit tests use in-memory fakes of the four ports, scriptable per failure reason.

The throwaway CA is trusted only when `SIGNING_TRUST_MOCK_CA=true`; the app refuses
to start with that flag set when `NODE_ENV=production`.

## Consequences

- Installs that keep `attestation` change nothing and run no new service.
- `drawn` without PDF conversion runs no new service either.
- `certificate` installs run two sidecars; signing gains one approver round-trip
  to their provider and a few seconds for timestamp and revocation fetches.
- The repository gains its first compose profiles and a second published image.
- The Lambda topology (ADR-056) cannot host the sidecars; it can offer
  certificate signing only by pointing `GOTENBERG_URL` / `DSS_URL` at externally
  hosted services.

## Alternatives considered

- **In-process Node PAdES and validation** — no extra service, but Wayfinder would
  own LTV assembly and ETSI validation logic, where a wrong "valid" badge is the
  worst failure a signing feature can have.
- **Delegate assembly and validation to the provider's API** — nothing to run, but
  validation status would depend on one vendor's availability and semantics, and
  installs would be locked to that vendor.
- **XAdES / ASiC-E around the `.docx`** — no conversion, but Acrobat does not
  validate it, failing the issue's core acceptance test.
- **Per-step signature method** — maximal flexibility, but puts a legal-posture
  decision in the hands of flow authors and multiplies the configuration the Test
  must cover.
- **A separate signing reason field** — rejected in favour of the approver's
  comment (§1).

## As built (v0.41.2–v0.41.4)

Where the build departs from the text above, and why:

- **Settings are one JSON row.** `signature_config` in `admin_system_settings`,
  read through `RuntimeConfigStore` and encrypted at rest as a sensitive key
  (it carries the CSC client secret) — the pattern every other integration
  uses, rather than separate `signature.*` keys.
- **The Test probes candidate values.** `ISignatureServicesProbe` checks the
  four services against the config about to be saved; the four new
  `ConnectivityTarget`s reuse it against the saved config for **Test all**.
  The timestamp authority is probed with a real RFC 3161 request.
- **The mock-CA guard lives in the sidecar, not the app.** The DSS sidecar is
  what trusts certificates, so it is what refuses `SIGNING_TRUST_MOCK_CA`
  unless `DSS_ENVIRONMENT=development`; its image defaults to `production`.
- **Revocation is CRL-based in the mocks.** `/ocsp/root.crl` serves a CRL
  issued fresh per request; DSS accepts CRLs for B-LT. No OCSP responder is
  mocked. A CRL fixed at startup left every signature after the first at B-T.
- **Later signatures get one more LTA extension.** A second signature whose
  certificate's revocation data is already in the document stops at B-T; the
  sidecar extends once more so every signature reaches B-LTA.
- **Drawings sign approvals only, and only the approver's own.** A rejection or
  change request carries the attestation text alone; an admin deciding on an
  approver's behalf, or an off-system nomination, places no drawing.
- **Nobody signs while impersonated.** Signing refuses when `impersonatorId` is
  set. This amends ADR-060 §6, which keeps that field for attribution only:
  signing on someone else's behalf is the one thing an impersonated session
  must not be able to do, so here it is read for authorisation.
- **No paid image module.** The drawing is written as inline OOXML
  (`docx-signature-image.ts`), verified to render in LibreOffice and
  python-docx.
