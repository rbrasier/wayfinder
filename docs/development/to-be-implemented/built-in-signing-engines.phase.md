# Phase — Built-in Signing Engines

- **Status**: Draft — run `/doc-review` before `/build`
- **Target version**: PATCH — 0.41.4 → 0.41.5 (no schema change; feature on a
  release branch by maintainer decision)
- **Base branch**: `release/alpha-3` (maintainer override — PRD §12), stacked on
  PR #390; built on `claude/issue-386-triage-9qb2ii`
- **PRD**: `docs/development/prd/built-in-signing-engines.prd.md`
- **ADRs**: ADR-069 (all), amending ADR-067 §3–§5
- **Depends on**: document signatures phases 1–3 (v0.41.2–v0.41.4)

## 1. Goal

The default Wayfinder image converts documents to PDF/A and builds and validates
PAdES signatures itself, so signing needs nothing deployed beside Wayfinder. The
timestamp authority stays external but defaults to DigiCert. A `-slim` image keeps
today's footprint.

## 2. Approved change summary

Wayfinder's default image runs the PDF converter (LibreOffice) and the signature
engine (EU DSS) itself, so a certificate-signing install needs nothing deployed
alongside it. Admins choose Built-in or External for each engine. Built-in engines
start only when the chosen signature method needs them. The timestamp authority
stays a third party, but it's pre-filled with DigiCert's free service. A `-slim`
image without the engines stays available, and Lambda keeps using external
services.

### Goal
- Remove the two extra services operators currently deploy (Gotenberg and the DSS
  sidecar) for drawn-signature PDFs and certificate signing.
- Stop asking admins for a timestamp authority URL they don't understand.

### Business rules changing
- **Per-engine choice:** each engine is **Built-in** (inside the container) or
  **External** (URL, as today).
- **Defaults:**
  - New installs on the default image default to Built-in.
  - Existing installs with a saved URL keep External.
  - Existing installs with no converter become Built-in, which makes the
    "Convert to PDF on signing" switch available.
- **Start and stop:** a built-in engine starts on first use or Test and is
  restarted if it crashes. It's never started when the method doesn't need it.
- **Slim image:** Built-in on `-slim` fails Test and Save with "This image doesn't
  include the built-in engine — use the default image or set an external URL." The
  certificate method still can't be saved until Test passes.
- **Timestamp authority:** the admin's URL if set, otherwise
  `http://timestamp.digicert.com`. Built-in signing trusts the same deploy-time
  certificate folder as the external sidecar, never anything set in the UI.

### UI / visible behaviour
- **PDF signatures card:** a Built-in / External choice for each engine; the URL
  field only shows for External.
- **Status line:** "Built-in · running", "Built-in · idle", or "Not included in this
  image".
- **Timestamp authority:** under **Advanced**, showing "DigiCert (default)" when
  blank.
- **Test results:** label "Built-in PDF converter" / "Built-in signature engine".

### Database & migration impact
- None; the choice lives in the existing encrypted signature-config JSON.

### Risks
- Image size about +500–700 MB on the default image.
- More packages for Trivy to flag; findings may need waivers.
- The JVM needs ~300–500 MB while running.
- Font fidelity versus Gotenberg needs a matching font set.
- Licences (MPL-2.0, LGPL-2.1, GPLv2+CE) are compatible with the GPL-3.0 image.

### Out of scope
- Rewriting signing or validation in Node; an internal TSA; engines in Lambda;
  the signing provider's own timestamp service.

### Deviations
- Targets `release/alpha-3` with a PATCH bump, by maintainer decision.
- The provider-TSA default is dropped for now: it needs the signer's CSC token,
  while DSS fetches timestamps itself.
- Amends ADR-067: the sidecar is no longer the only deployment, and trust anchors
  can be read from the app container.

### Build details
- **Architecture:** complies with ADR-001 — new adapters and a supervisor behind
  the existing ports.
- **Docs:** 1 PRD, 1 ADR (ADR-069), 1 phase doc.
- **Version:** PATCH 0.41.4 → 0.41.5; docs on `claude/issue-386-triage-9qb2ii`.

## 3. What is built

### Domain (`packages/domain`)
- `signature-config.ts`:
  - Replace `gotenbergUrl` / `dssUrl` with `pdfConverter` / `signatureEngine:
    EngineChoice`, where `EngineChoice = { source: "built-in" } | { source:
    "external"; url: string }`.
  - Add `DEFAULT_TSA_URL = "http://timestamp.digicert.com"` and
    `resolveTsaUrl(config)`.
  - `parseSignatureConfig` maps legacy `gotenbergUrl` / `dssUrl` forward (ADR-069 §2).
  - `validateSignatureConfig`: an External choice needs an http(s) URL; the
    certificate method no longer requires a TSA URL.
  - `requiredSignatureTargets`: probe `pdf-converter` whenever a converter is
    usable — Built-in, or External with a URL.
- Add `BuiltInEngineStatus = "running" | "idle" | "unavailable"`.

### Adapters (`packages/adapters/src/signing`)
- `local-pdf-converter.ts`:
  - Runs `soffice` with a per-job profile and the PDF/A-2b filter.
  - Queue (`PDF_CONVERTER_CONCURRENCY`, default 2) and a 60 s kill timeout.
  - Reports `unavailable` when `/usr/bin/soffice` is absent.
- `engine-supervisor.ts`:
  - Starts the JVM on demand (`java -Xmx$SIGNING_ENGINE_HEAP -jar …`) on a free
    loopback port and waits on `/health`.
  - Restarts after a crash, with a give-up window of 3 failed starts in 5 minutes.
  - Idle stop (`SIGNING_ENGINE_IDLE_MINUTES`, default 30).
  - Exposes `status()` and `baseUrl()`.
- `built-in-signature-engine.ts`: wraps the existing `DssSignatureEngine`, pointing
  it at `supervisor.baseUrl()`. Reports `unavailable` when the jar is absent.
- Connectivity probes: the built-in variants start the engine and probe `/health`
  (converter: a one-page conversion).
- The DSS client passes `resolveTsaUrl(config)` instead of `config.tsaUrl`.

### Web (`apps/web`)
- `container-signing.ts`: choose the Gotenberg/Local converter and the
  External/Built-in engine per call from the loaded config. One supervisor per web
  process, stopped on `SIGTERM`.
- `settings-signature` router:
  - New config shape.
  - `getSignature` returns `{ pdfConverter, signatureEngine }` statuses.
- `signature-card.tsx`:
  - A Built-in / External radio for each engine, with the URL only when External.
  - Status line.
  - Timestamp authority under a collapsed **Advanced** section, placeholder
    "DigiCert (default)".
  - Test-result labels.

### Image and deployment
- `Dockerfile`:
  - Add a `dss-build` Maven stage (from `deploy/dss`).
  - Add a `jre` stage: `jlink` with `java.base,java.xml,java.naming,java.net.http,java.logging,java.sql,java.management,jdk.crypto.ec`;
    verify the module list against `jdeps` on the jar.
  - Two final targets: `runtime-slim` (today's runtime stage) and `runtime`, which
    adds LibreOffice Writer, the fonts, the JRE at `/opt/wayfinder/jre` and the jar
    at `/opt/wayfinder/dss/`.
- `ci.yml`: build both targets; Trivy-scan and report the size of both; run the DSS
  smoke test against the built-in engine (`node deploy/dss/smoke-test.mjs` with
  `DSS_URL` from a small script that boots the supervisor).
- `publish.yml`: push `:<version>` / `:latest` from `runtime` and
  `:<version>-slim` / `:slim` from `runtime-slim`.
- `docker-compose*.yml`:
  - Mount `./trust` at `/app/trust` on the web service.
  - Keep the `pdf` and `signing` profiles, documented as optional external engines.
- Docs:
  - `docs/guides/document-signatures.md`: Built-in vs External, `-slim`,
    memory, TSA default.
  - Deployment guides: an image-tag note.
  - The Lambda guide: External only.

## 4. Database changes

None.

## 5. Implementation order (tests first)

1. Domain config shape, legacy mapping, `resolveTsaUrl`, validation and targets.
2. `LocalPdfConverter`: unit tests with a fake spawn, plus an adapter test that
   runs real `soffice` when present (skipped in the unit job, run in the image job).
3. `EngineSupervisor`: unit tests with a fake child process (start, health
   timeout, crash restart, give-up window, idle stop, concurrent first requests
   start one JVM).
4. Built-in engine adapter, probes and the TSA resolution in the DSS client.
5. Web wiring, router and settings card (component tests).
6. Dockerfile targets, CI and publish jobs, compose and docs.
7. Bump `VERSION` and `package.json` to 0.41.5.

## 6. Tests

- **Unit:** domain config (legacy rows, defaults, validation), supervisor state
  machine, converter queue and timeout.
- **Adapter:** real LibreOffice conversion of `minimal-docx` to PDF/A-2b (checks the
  `pdfaid` XMP part), run where `soffice` exists.
- **Integration (CI):** the DSS smoke test against the built-in engine in the
  `runtime` image; a `-slim` image check that Built-in reports "not included".
- **E2E:** none new — the behaviour is not in an e2e-policy group; the existing
  `document-signatures.spec.ts` continues to run (against mocks).

## 7. Acceptance criteria

- [ ] All PRD §10 criteria pass.
- [ ] `./validate.sh` passes; CI green on both images.
- [ ] Image sizes recorded in the implementation summary (default and `-slim`).
- [ ] After the build, new screenshots of the PDF signatures card (Built-in /
      External choice, status line, Advanced TSA) are posted on issue #386,
      @-mentioning @johntooth, with images hosted on the
      `assets/issue-386-screenshots` branch (not committed to the feature branch).

## 8. Risks

- **Concurrent first requests** must not start two JVMs; the supervisor
  serialises start-up behind one promise.
- **Zombie LibreOffice processes** after a timeout; kill the process group and
  delete the per-job profile in `finally`.
- **Trivy findings in LibreOffice/JRE packages** may block publish until upstream
  fixes land; use the existing waiver process, never a blanket ignore.
- **Image size** may exceed what some registries or hosts expect; `-slim` is the
  documented escape hatch.
