# Phase — Document Signatures 1: Signing Config, Drawn Signatures, PDF Conversion

- **Status**: Draft — run `/doc-review` before `/build`
- **Target version**: PATCH — 0.41.1 → 0.41.2 (schema change: nullable columns on
  `core_users`; PATCH rather than MINOR by maintainer decision — see PRD §12)
- **Base branch**: `release/alpha-3` (maintainer override — see PRD §12)
- **PRD**: `docs/development/prd/document-signatures.prd.md`
- **ADRs**: ADR-067 (§1–3, §6–7), ADR-068 (§4)
- **Depends on**: ADR-043 signature slots, ADR-041 live Test pattern
- **Followed by**: `document-signatures-2-certificate-signing.phase.md`

## 1. Goal

An admin can choose *Attestation only* or *Drawn signature* on a new **PDF
signatures** card; approvers draw once and their drawing lands in claimed `.docx`
slots; a flow author can convert the signed output to PDF/A. *Digital
certificate* is listed but disabled with "Available in a later release" until
phase 2.

## 2. What is built

| Layer | File | Change |
| ----- | ---- | ------ |
| domain | `entities/signature-settings.ts` (+ test) | `SignatureMethod`, `SignatureSettings`, validation (`certificate` rejected in this phase) |
| domain | `entities/drawn-signature.ts` (+ test) | `DrawnSignature`; PNG size/dimension limits |
| domain | `entities/flow-node.ts` | `ApprovalNodeConfig.convertToPdfOnSigning?: boolean` |
| domain | `entities/session-message.ts` | `SessionDocument.pdf?: { storagePath; sha256; generatedAt; status }` |
| domain | `ports/pdf-converter.ts` | `IPdfConverter.convertDocxToPdfA(bytes): Promise<Result<Buffer>>` |
| domain | `ports/signature-settings-repository.ts`, `ports/drawn-signature-repository.ts` | get/save, Result pattern |
| application | `use-cases/signing/get-signature-settings.ts`, `set-signature-settings.ts`, `test-signature-settings.ts` (+ tests) | Test-before-save rule (ADR-067 §6) — Gotenberg required when any active flow has `convertToPdfOnSigning` |
| application | `use-cases/signing/save-drawn-signature.ts` (+ test) | caller-only; refuses under impersonation |
| application | `use-cases/approvals/decide-approval.ts` | under `drawn`, a slot-claiming decision without a stored drawing returns `VALIDATION_FAILED` with code `drawing_required` |
| application | `use-cases/approvals/apply-approval-signature.ts` / `document/render-data.ts` | pass the approver's drawing to the renderer for the claimed slot; convert to PDF when the node toggle is on |
| adapters | `signing/gotenberg-pdf-converter.ts` (+ test) | HTTP client for Gotenberg LibreOffice route, PDF/A-2b |
| adapters | `documents/` `.docx` renderer | inline `w:drawing` for a slot image (ADR-067 §2), no paid module |
| adapters | `repositories/drizzle-signature-settings-repository.ts`, `drizzle-drawn-signature-repository.ts` | `admin_system_settings` keys; `core_users` columns |
| adapters | `health/connectivity-probes.ts` | Gotenberg probe |
| apps/web | `lib/container.ts` | wire the above |
| apps/web | tRPC `settings.*SignatureSettings`, `profile.*DrawnSignature` | added |
| apps/web | `/admin/settings` PDF signatures card | method picker, Gotenberg URL, Test |
| apps/web | approval decision UI, profile page | drawing pad on `drawing_required`; *Redraw signature* |
| apps/web | approval node config | *Convert to PDF on signing* toggle |
| apps/web | session document view | PDF download when `SessionDocument.pdf` exists |
| infra | `docker-compose.yml`, `docker-compose.prod.yml` | `gotenberg` service under `profiles: [pdf]`; `GOTENBERG_URL` in `.env.example` and guides |
| mocks | `mocks/signing/gotenberg.mjs` (+ test), `mocks/server.mjs` | `/gotenberg` canned PDF/A |

## 3. Database changes

Generated migration adding to `core_users`:

- `drawn_signature_storage_path text` — nullable
- `drawn_signature_updated_at timestamptz` — nullable

Additive nullable columns: no `-- data-impact:` declaration needed. Settings use
`admin_system_settings` keys `signature.method`, `signature.gotenberg_url`.

## 4. Implementation order (tests first)

1. Domain entities and their tests; port interfaces.
2. In-memory fakes of `IPdfConverter` and the two repositories.
3. Settings use cases + Test rule; drawn-signature use case.
4. `decide-approval` `drawing_required` gate; render path with image and PDF
   conversion.
5. Adapters (Gotenberg client, `.docx` drawing, repositories) and migration.
6. `/gotenberg` mock + test; compose profile; env coverage
   (`check-guide-env-coverage.mjs`).
7. tRPC and UI.
8. Bump `VERSION` and root `package.json` to 0.41.2; `./validate.sh`.

## 5. Tests

- Unit: settings validation, Test-before-save, `drawing_required`, impersonation
  refusal, renderer places image above the unchanged attestation block, `.xlsx`
  slot unchanged.
- Adapter: Gotenberg client against `/gotenberg` mock; `.docx` drawing opens in
  the existing docx test harness.
- E2E (approval group per `docs/guides/e2e-test-policy.md`): approver draws on
  first approval, second approval reuses the drawing.

## 6. Acceptance criteria

- [ ] Existing installs default to *Attestation only* with no behaviour change.
- [ ] *Drawn* approver without a drawing is prompted before the decision completes;
      later decisions reuse it; *Redraw* replaces it.
- [ ] No API saves a drawing for anyone but the caller; impersonated sessions
      cannot sign.
- [ ] Claimed `.docx` slot shows the drawing above the attestation block; `.xlsx`
      unchanged.
- [ ] *Convert to PDF on signing* produces a downloadable PDF/A after each decision.
- [ ] Saving settings that need Gotenberg fails server-side unless its Test passes.
- [ ] `/gotenberg` mock registered with a passing test.

## 7. Risks

- `w:drawing` hand-written OOXML must open in Word, Word Online, LibreOffice and
  Google Docs — cover with fixture files in tests.
- First compose profile in the repo; guides must explain enabling it.

## 8. Approved change summary

See the "Approved change summary" section of the PRD — approved 2026-11-08 for
issue #386 and carried here unchanged.

## 9. Approved build summary (all three phases, 2026-11-08)

Approved at the `/build` gate. Deviations from these phase docs, found in the
pre-flight read of the code:

- **Settings storage** — one parsed JSON config under
  `SIGNATURE_CONFIG_SETTING_KEY` through `RuntimeConfigStore`, matching AI / auth /
  email, instead of separate `signature.*` keys and a new repository port.
- **Image support** — `GenerateInput` gains an optional `images` map keyed by slot,
  because `data` carries only strings, booleans and arrays.
- **Probes** — new `ConnectivityTarget`s (`pdf-converter`, `signing-provider`,
  `timestamp-authority`, `signature-engine`) on the existing `IConnectivityTester`;
  `ITimestampAuthority` is folded into the probe rather than a separate port.
- **Audit sequencing** — `signature.signed` / `signature.rejected` ship in phase 2;
  phase 3 adds `signature.validated` and the export (fixes the doc-review WARN).
- **Branch / PR** — built on `claude/issue-386-triage-9qb2ii`, PR into
  `release/alpha-3`; PATCH bumps 0.41.2 → 0.41.4, both by maintainer decision.
- **Verification limits** — no Docker daemon or LibreOffice in the build
  environment: Gotenberg and DSS adapters are verified against `mocks/` endpoints;
  the real-sidecar job first runs in CI.
