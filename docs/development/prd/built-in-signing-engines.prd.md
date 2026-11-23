# PRD — Built-in Signing Engines

- **Status**: Implemented (v0.41.5)
- **Date**: 2026-11-09
- **Author**: Claude, follow-on to issue #386 / PR #390
- **Target version**: 0.41.5 (bump: PATCH — maintainer decision, see §12)

## 1. Problem

Document signatures (PRD `document-signatures.prd.md`, ADR-067) need two extra
services beside Wayfinder: Gotenberg to turn `.docx` into PDF/A, and the EU DSS
sidecar to build and validate PAdES signatures. Operators must deploy, network and
upgrade both before drawn-signature PDFs or certificate signing work, and admins
must also find and type a timestamp authority URL that few of them understand.
The setup cost lands on exactly the regulated customers the feature is for.

## 2. Users / Personas

- **Operator** (deploys Wayfinder with Docker or Compose) — wants one image to run,
  not three services to wire together.
- **Install admin** (configures Wayfinder) — wants to pick a signature method and
  press Test, without knowing what Gotenberg, DSS or RFC 3161 are.
- **Approver** — unaffected: signing looks and behaves exactly as in 0.41.4.

## 3. Goals

- On the default image, an admin can switch on the drawn or certificate method and
  pass Test with no PDF converter or signature engine deployed beside Wayfinder.
- The built-in engines produce the same output as the external ones: PDF/A-2b from
  the same LibreOffice, PAdES B-LTA from the same DSS 6.5.1 code.
- An admin who leaves the timestamp authority blank still gets B-T/B-LTA
  signatures, using DigiCert's public timestamp service.
- An install that uses only attestation starts no extra process and uses no extra
  memory.
- Operators who do not need the engines can run a `-slim` image without them.
- Installs that already point at external Gotenberg or DSS keep working unchanged
  after upgrade.

## 4. Non-goals

- Rewriting PAdES signing or validation in Node (ADR-069 §Alternatives).
- Running a timestamp authority inside Wayfinder: its value is independence
  (ADR-069 §4).
- Running the engines inside the AWS Lambda topology.
- Using the signing provider's own CSC timestamp service (future work, §11).

## 5. Key entities

| Entity | Lives in | New / existing | Notes |
| ------ | -------- | -------------- | ----- |
| `SignatureConfig` | `packages/domain/src/entities/signature-config.ts` | existing, reshaped | Each engine becomes `{ source: "built-in" } \| { source: "external", url }`; `tsaUrl` stays optional with a documented default |
| `EngineSource` | same file | new type | `"built-in" \| "external"` |
| `BuiltInEngineStatus` | `packages/domain/src/entities/signature-config.ts` | new type | `"running" \| "idle" \| "unavailable"` — shown on the settings card |
| `IPdfConverter`, `ISignatureEngine` | `packages/domain/src/ports/` | existing, unchanged | The built-in engines are new adapters behind the same ports |

## 6. User stories

1. As an operator, I run the default Wayfinder image alone and certificate signing
   works once the admin has configured a signing provider.
2. As an admin, I choose **Built-in** for the PDF converter and press Test; it
   passes without any URL.
3. As an admin, I leave the timestamp authority blank and see "DigiCert (default)",
   and signatures still reach B-LTA.
4. As an admin on an existing install with an external Gotenberg, I upgrade and my
   settings still say **External** with my URL.
5. As an operator on the `-slim` image, choosing **Built-in** tells me plainly that
   this image doesn't include it and what to do instead.
6. As an operator, an attestation-only install shows no extra memory use.

## 7. Pages / surfaces affected

- **Admin → Configuration → Signatures → PDF signatures** card and dialog:
  Built-in / External choice per engine, status line, Timestamp authority under
  **Advanced**.
- tRPC `settings.getSignature`, `settings.setSignature`, `settings.testSignature`:
  new config shape; `getSignature` also returns each built-in engine's status.
- Connectivity probes for `pdf-converter` and `signature-engine`: built-in variants.
- Container image: default tag gains LibreOffice, a trimmed Java runtime and the DSS
  jar; new `-slim` tag without them.
- `docker-compose*.yml`: `pdf` and `signing` profiles become optional (external
  engines only).

## 8. Database changes

None. The engine choice lives in the existing encrypted `signature_config`
setting (JSON); the parser maps old rows forward (ADR-069 §2).

## 9. Architectural decisions

- Assumes ADR-001 (hexagonal), ADR-046 (container image distribution), ADR-067
  (signature methods and engines), ADR-068 (frozen PDF).
- New: **ADR-069 — Built-in signing engines and image variants** (amends ADR-067
  §3–§5).

## 10. Acceptance criteria

- [ ] Default image: drawn method with a Built-in converter passes Test and Save
      with no Gotenberg running; an approved step produces a PDF/A-2b.
- [ ] Default image: certificate method with Built-in converter and engine passes
      Test; the DSS smoke test (`deploy/dss/smoke-test.mjs`) passes against the
      built-in engine (both signatures B-LTA, tamper detected, four refusals).
- [ ] Blank timestamp authority resolves to `http://timestamp.digicert.com`; an
      admin-entered URL overrides it.
- [ ] Attestation-only install: no LibreOffice or Java process is running after
      startup and after an approval.
- [ ] A built-in engine killed mid-life is restarted on the next request; a request
      during a failed start fails closed with "unavailable".
- [ ] `-slim` image with Built-in chosen: Test and Save fail with the "not included
      in this image" message.
- [ ] Upgrade: a row with `gotenbergUrl`/`dssUrl` set parses as External with that
      URL; a row without parses as Built-in.
- [ ] Two concurrent conversions both succeed (per-job LibreOffice profile).
- [ ] CI builds and Trivy-scans both images and reports both sizes.
- [ ] Screenshots of the updated settings card are posted on issue #386,
      @-mentioning @johntooth, once built.

## 11. Out of scope / future work

- Default to the CSC provider's `signatures/timestamp` method when it offers one.
- Loading the EU List of Trusted Lists into the built-in engine.
- Built-in engines for the Lambda topology.

## 12. Risks / open questions

- **Base branch and version**: a feature on `release/alpha-3` as a PATCH bump,
  stacked on PR #390 — maintainer decision, breaking the release-branch rule the
  same way #390 does.
- **Image size**: about +500–700 MB on the default image; mitigated by the `-slim`
  tag (ADR-069 §3).
- **CVE surface**: LibreOffice and the JRE add packages Trivy will scan; fixable
  HIGH/CRITICAL findings block the build as today.
- **Memory**: the JVM needs ~300–500 MB while running; it starts only when needed
  and its heap is set by `SIGNING_ENGINE_HEAP` (default 384m).
- **Font fidelity**: the built-in converter must ship metric-compatible fonts
  (Carlito/Caladea for Calibri/Cambria, Liberation for Arial/Times) or layouts
  drift from Gotenberg's.
- **Licences**: LibreOffice (MPL-2.0), DSS (LGPL-2.1), OpenJDK (GPLv2 + Classpath
  exception) are all distributable in the GPL-3.0 image; ADR-069 records it.
