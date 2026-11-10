# Implementation summary — Document signatures (v0.41.2 → v0.41.4)

- **Issue**: #386 (eSignature)
- **PRD**: `docs/development/prd/document-signatures.prd.md`
- **ADRs**: ADR-067 (signature methods, engine, sidecars), ADR-068 (the frozen PDF is the signed record) — both carry an "As built" section
- **Phases**: `../v0.41.2/document-signatures-1-config-drawn-pdf.phase.md`,
  `../v0.41.3/document-signatures-2-certificate-signing.phase.md`,
  `document-signatures-3-validation-and-audit.phase.md`
- **Release line**: `release/alpha-3`, PATCH bumps — both by maintainer decision
  (CLAUDE.md would put a new feature on `main` and a schema change at MINOR).
  `main` must bump above 0.41.4 on the next forward-merge.

## What was built

**Phase 1 — v0.41.2: signature methods, drawn signatures, PDF conversion**
- Install-wide signature method (attestation / drawn / certificate) on a new
  **PDF signatures** card, saved only after its live Test passes.
- Drawn signatures: drawn once on a signature pad, remembered per user
  (`core_users.drawn_signature_*`), frozen into each approval record, placed
  above the attestation block in `.docx` slots as inline OOXML.
- **Convert to PDF on signing** per approval step, through Gotenberg (PDF/A-2b),
  with a PDF download on the document card.
- Signing refuses impersonated sessions; frozen documents refuse edits.

**Phase 2 — v0.41.3: certificate signing**
- **Approve & sign**: CSC v2 remote signing over two OAuth legs. The service leg
  reads the signer's certificate, freezes the document to PDF/A, locates each
  slot, and has the engine check the certificate (expired, revoked, untrusted,
  wrong key usage refuse here). The credential leg signs the authorised hash,
  incorporates it at PAdES B-LTA, validates it, and only then records the
  decision.
- New **DSS sidecar** (`deploy/dss`, EU DSS 6.5.1) published as
  `ghcr.io/rbrasier/wayfinder-dss` alongside the app image.
- Frozen documents refuse regeneration; a change request or rejection
  supersedes the frozen PDF.

**Phase 3 — v0.41.4: validation, off-system, export**
- **Signatures** panel on frozen documents: signer, certificate, signed time,
  timestamp, level and a badge (valid / valid-but-expired / invalid-modified /
  unverifiable), **Re-check**, CSV and JSON export.
- Off-system approvals on certificate steps must upload a PDF validly signed by
  the nominated approver over the frozen document; it becomes the signed record.
- Audit events: `signature.drawn.saved`, `signature.signed`,
  `signature.rejected`, `signature.validated`, `signature.metadata_exported`,
  `settings.signature.updated`.

## Migrations

| File | Change | `-- data-impact:` |
| --- | --- | --- |
| `0062_drawn_signature.sql` | `core_users` + `drawn_signature_storage_path text`, `drawn_signature_updated_at timestamptz`, both nullable | none needed (additive, nullable) |
| `0063_digital_signature.sql` | `app_session_approvals` + `digital_signature jsonb`, nullable | none needed (additive, nullable) |

The journal's last entry was an alpha-2 back-port (`idx 49`), so drizzle-kit
numbered 0062 as 0050; it was renumbered by hand. 0063 generated correctly.

## Files

- **domain**: `signature-config`, `drawn-signature`, `digital-signature`
  entities; ports `pdf-converter`, `drawn-signature-repository`,
  `signature-services-probe`, `remote-signing-provider`, `signature-engine`,
  `pdf-anchor-locator`; `SessionDocument.pdf`, `ApprovalNodeConfig.convertToPdfOnSigning`,
  `Approval.digitalSignature`, four connectivity targets.
- **application**: `use-cases/signing/*` (config, drawn signature, signing
  requirement, certificate signing start/complete, freeze, off-system evidence,
  session signatures); `approvals/decision-signing-gate.ts`,
  `approvals/subject-document.ts`; changes to `DecideApproval`,
  `ApplyApprovalSignature`, `RecordOffSystemApproval`, `UpdateDocumentFields`,
  `GenerateDocument`.
- **adapters**: `signing/*` (Gotenberg, CSC, DSS engine, pdf.js anchor locator,
  service probes, RFC 3161), `documents/docx-signature-image.ts`,
  `documents/minimal-docx.ts`, drawn-signature repository, runtime config,
  connectivity tester, schema.
- **web**: settings card, signature pad, profile card, decision modal, node
  toggle, document card, signatures panel, signing result banner; routers
  `settings-signature`, `signatures`, approval/user procedures; CSC callback
  route; `container-signing.ts`; e2e fixture `e2e-fixtures-signing.ts`.
- **mocks**: `signing/` — test CA, CSC provider, TSA, CRL, Gotenberg, DSS.
- **infra**: `deploy/dss` (pom, Java sources, Dockerfile, smoke test);
  compose `pdf` and `signing` profiles; `publish.yml` DSS image;
  `ci.yml` `dss-integration` job.
- **docs**: `docs/guides/document-signatures.md`, setup-admin pointer.

## Tests

- Unit and adapter tests written before each implementation: domain (signature
  config, drawn signature, digital-signature mapping), application (config,
  drawn signature, signing gate, requirement, certificate signing, off-system
  evidence, session signatures, re-render paths), adapters (Gotenberg, CSC,
  DSS, anchor locator, RFC 3161, probes, docx images, repository mapping),
  mocks (each signing mock).
- **Real crypto**: `deploy/dss/smoke-test.mjs` signs a PDF twice through the
  mock CSC/TSA/CRL and the real DSS sidecar; both signatures validate at
  PAdES B-LTA, the second is incremental, a changed byte fails both, and all
  four refusal scenarios are refused before signing. Run locally and in CI.
- **E2E**: `apps/web/e2e/document-signatures.spec.ts` (policy group 3, file
  download): approving a converting step offers the PDF; a non-converting
  document offers none.

## Known limitations

- Signing assumes RSA keys at the CSC provider (`RSA_SHA256`); ECDSA providers
  are not yet supported.
- The DSS sidecar loads trust anchors from `/trust` only; the EU List of
  Trusted Lists is not loaded automatically.
- No periodic archive re-timestamping; B-LTA's archive timestamp holds for the
  TSA certificate's lifetime.
- Drawn signatures are not placed in `.xlsx` outputs.
- The Lambda topology must point at externally hosted Gotenberg and DSS.
