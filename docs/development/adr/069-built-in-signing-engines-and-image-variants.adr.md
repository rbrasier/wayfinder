# ADR-069 — Built-in Signing Engines and Image Variants

- **Status**: Accepted (scoped by `built-in-signing-engines.prd.md`; as built v0.41.5, hardened v0.41.6)
- **Date**: 2026-11-09
- **Builds on**: ADR-001 (hexagonal architecture), ADR-046 (container image
  distribution), ADR-067 (signature methods and signing engine), ADR-068 (frozen
  PDF as the signed record)
- **Amends**: ADR-067 §3 and §4 — Gotenberg and the DSS sidecar become the
  *external* option; the default is the same engines inside the Wayfinder
  container. ADR-067 §5 — trust anchors are still deployment configuration, now
  read from the app container's trust folder for the built-in engine.
- **Numbering**: 069 is free on `release/alpha-3`; `main` stops at 066 until the
  forward-merge of PR #390.

## Context

ADR-067 put PDF conversion (Gotenberg, i.e. LibreOffice) and PAdES signing and
validation (EU DSS, Java) in sidecars behind `IPdfConverter` and
`ISignatureEngine`. That kept Java and LibreOffice out of the Node app, but it
means an operator must deploy two more services before drawn-signature PDFs or
certificate signing work. The maintainer wants them internal, and asked whether
the timestamp authority (TSA) could be internal too.

Constraints:

1. **Fidelity and correctness must not change.** The PDF is the signed record
   (ADR-068), and DSS validation drives the refusal gate and the Signatures panel.
   Both must keep coming from the same LibreOffice and the same DSS 6.5.1 code.
2. **Only `apps/web` uses the engines** (`apps/web/src/lib/container-signing.ts`).
   `apps/api` never converts or signs.
3. **Most installs sign nothing** (attestation is the default), so the engines
   must cost nothing until used.
4. **Lambda** cannot run long-lived child processes or carry a ~1 GB image.

## Decision

### 1. The engines run inside the container, as supervised child processes

- **PDF converter**: `LocalPdfConverter` (new adapter, `IPdfConverter`) runs
  `soffice --headless --convert-to 'pdf:writer_pdf_Export:{"SelectPdfVersion":{"type":"long","value":"2"}}'`
  (PDF/A-2b, matching what the Gotenberg adapter requests). Each job gets a
  temporary `-env:UserInstallation` profile, because LibreOffice refuses two
  conversions on one profile. Jobs go through a small queue (default concurrency 2,
  `PDF_CONVERTER_CONCURRENCY`) and a 60 s timeout, after which the process is
  killed and the call fails closed.
- **Signature engine**: the existing DSS sidecar jar, unchanged, started by an
  `EngineSupervisor` on `127.0.0.1` with a random free port. The existing
  `DssSignatureEngine` adapter talks to it over that loopback URL, so there is one
  wire protocol, one smoke test and one code path for built-in and external.
- **EngineSupervisor** (`packages/adapters/src/signing/engine-supervisor.ts`):
  - Starts the JVM on the first request or Test, never at boot.
  - Waits on `/health` (30 s budget), restarts after a crash on the next request,
    and gives up after 3 failed starts in 5 minutes.
  - While it has given up, every request returns `unavailable`, so signing fails
    closed exactly as when an external sidecar is down (ADR-067 §6).
  - Stops the JVM after 30 minutes idle (`SIGNING_ENGINE_IDLE_MINUTES`) to give
    the memory back.
  - The heap is set by `SIGNING_ENGINE_HEAP`, default `384m`.
  - The supervisor is an adapter concern; no port or use case changes.

### 2. Each engine is Built-in or External, chosen in the existing config

`SignatureConfig` replaces `gotenbergUrl` / `dssUrl` with
`pdfConverter` / `signatureEngine`, each
`{ source: "built-in" } | { source: "external"; url: string }`. It stays in the
encrypted `signature_config` JSON row, so there is no migration. The parser maps
old rows forward:

- A row with `gotenbergUrl` or `dssUrl` set becomes `external` with that URL, so
  an upgrade never silently moves an install off a service it chose.
- A row without one becomes `built-in`.

`container-signing.ts` picks the adapter per call from the loaded config. Both the
built-in converter and the built-in engine need binaries that only the default
image carries. Each built-in adapter checks for its binary
(`/usr/bin/soffice`, `/opt/wayfinder/dss/wayfinder-dss.jar`) and reports
`unavailable` with "This image doesn't include the built-in engine — use the
default image or set an external URL" when it is missing. The existing Test-before-save
rule (ADR-067 §6) therefore blocks saving Built-in on a `-slim` image.

### 3. Two image tags from one Dockerfile: default includes, `-slim` does not

- `ghcr.io/…/wayfinder:<version>` (and `latest`) — includes:
  - LibreOffice Writer (`libreoffice-writer-nogui`).
  - A metric-compatible font set: `fonts-liberation2`, `fonts-crosextra-carlito`,
    `fonts-crosextra-caladea`, `fonts-dejavu-core`, `fonts-noto-core`.
  - A `jlink`-trimmed Java 21 runtime.
  - The DSS jar, built in a Maven stage from `deploy/dss`.
- `ghcr.io/…/wayfinder:<version>-slim` — the current runtime stage, unchanged.

The Dockerfile gains an `engines` stage and two final targets (`runtime-slim`,
`runtime`). `publish.yml` builds, Trivy-scans and pushes both; CI builds both and
reports both sizes. The standalone `wayfinder-dss` image stays published for
external deployments.

### 4. The timestamp authority stays external, with a default

A TSA's whole value is that a third party, not the signer and not whoever runs
Wayfinder, attests the time. A Wayfinder-run TSA would be untrusted by Acrobat and
DSS and would let the operator backdate. So it is not internalised. The setting
becomes zero-config:

- An admin-entered URL wins.
- Otherwise the default is `http://timestamp.digicert.com`: free, and chained to a
  root Acrobat trusts.
- Air-gapped installs set their organisation's internal TSA.

The certificate method no longer requires a TSA URL to save; Test still probes the
resolved TSA.

### 5. Trust anchors, unchanged in principle

The built-in engine reads trust anchors from `TRUST_ANCHORS_DIR` (default
`/app/trust`), mounted into the Wayfinder container exactly as it was into the
sidecar. `SIGNING_TRUST_MOCK_CA` keeps its development-only guard. Nothing in the
UI can add a trust anchor.

### 6. The engines parse documents inside the web container

A sidecar isolated LibreOffice and the JVM from the web server for free;
built in, they share its container, network position and user. Two rules
make up for that (added in v0.41.6):

- **Minimal environment.** LibreOffice and the JVM each get an allowlisted
  environment. Neither sees the database URL, the encryption key or model keys.
- **No outside content.** LibreOffice fetches whatever a document links to. The
  built-in converter therefore refuses a `.docx` that declares an external
  relationship other than a hyperlink (linked images, linked objects, remote
  templates), and refuses bytes that are not a `.docx`. The signed PDF is the
  record (ADR-068), so a document is refused, not silently converted without
  the linked part.

The external converter is not checked this way: where Gotenberg runs and what it
can reach is the operator's choice. LibreOffice still runs as the web server's
user with its filesystem; an operator who wants stronger isolation keeps the
engines external.

## Consequences

- One container covers every signature method; Compose's `pdf` and `signing`
  profiles become optional, for operators who prefer external engines.
- The default image grows by about 500–700 MB and carries more packages for Trivy
  to scan; `-slim` keeps today's size.
- The web container needs headroom for the JVM (~300–500 MB) while certificate
  signing is in use; the deployment guides say so.
- The Lambda topology keeps External engines and is documented as such.

## Alternatives considered

- **Rewrite signing and validation in Node** (pkijs + a hand-written PDF
  incremental-update writer). Signing alone is 2–3 weeks. Validation equal to DSS's
  ETSI EN 319 102-1 implementation would take months, and a simpler
  chain-plus-revocation check would misreport revocation timing and the
  expired-but-valid case. Rejected: it trades image size for correctness in the
  part auditors rely on.
- **docx → HTML → PDF via a headless browser.** Loses headers, footers, page
  breaks and table layout, and still needs a heavy browser binary. Rejected.
- **One image only, always with engines.** Simpler to publish, but every install
  pays the size and scan surface. The maintainer chose a default-includes image
  plus `-slim`.
- **Start the engines from the container entrypoint.** Simpler process model, but
  attestation-only installs would pay for a JVM they never use. Rejected in favour
  of on-demand start.
- **An internal TSA.** Rejected (§4).

## As built (v0.41.5)

- **Port shape.** `ISignatureEngine` takes the engine *choice*
  (`EngineChoice`) rather than a URL, because a built-in engine's address only
  exists once the supervisor has started it. `DssSignatureEngine` resolves the
  choice (external URL, or `EngineSupervisor.ensureRunning()`); the use cases
  pass `config.signatureEngine` and `resolveTsaUrl(config)`.
- **Supervisor.** `packages/adapters/src/signing/engine-supervisor.ts`, with its
  process, port, health check, clock and timers injected; all ADR §1 behaviour
  (one JVM for concurrent first requests, crash restart, three failed starts in
  five minutes, idle stop) is unit-tested against fakes. The real wiring is
  `createBuiltInEngines()` in `built-in-engines.ts`, which hands the JVM an
  allowlisted environment only (no database URL or model keys).
- **Loopback.** The DSS server gained `BIND_ADDRESS` (default `0.0.0.0`, so the
  sidecar is unchanged); the built-in engine sets `127.0.0.1`.
- **Converter routing.** `RoutingPdfConverter` reads the choice per call, so
  switching between Built-in and External needs no restart.
- **Probes.** A built-in converter is tested by converting a one-line document;
  a built-in engine by starting it and calling `/health`. A built-in converter
  is only probed under the certificate method, so saving attestation or drawn
  never starts LibreOffice and never fails on `-slim`.
- **Image.** `jlink` modules are `jdeps --print-module-deps` on the jar plus
  `jdk.crypto.ec`; the trimmed runtime is about 60 MB. `.dockerignore` now lets
  `deploy/dss` (minus `target/`) into the build context; the Lambda target stays
  out.
- **Supervisor, v0.41.6.** Requests go through `withEngine`, which holds the
  idle stop off until the last one finishes; a crash after a healthy start
  counts toward giving up; `stop()` cancels a start in progress.
- **CI.** The image job builds, scans and sizes both targets and checks `-slim`
  carries neither engine; the DSS job runs `deploy/dss/smoke-built-in.sh` inside
  the default image against the mocks.
