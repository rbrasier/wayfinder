# Implementation summary — Built-in Signing Engines (v0.41.5)

- **Phase doc**: `built-in-signing-engines.phase.md` (this folder)
- **PRD**: `docs/development/prd/built-in-signing-engines.prd.md`
- **ADR**: ADR-069 (amends ADR-067 §3–§5)
- **Version**: PATCH 0.41.4 → 0.41.5 on `release/alpha-3` (maintainer override)

## What was built

The default Wayfinder image converts documents to PDF/A with its own
LibreOffice and builds and validates PAdES signatures with its own copy of the
DSS engine, on a `jlink`-trimmed Java runtime. Both start only when the chosen
signature method needs them. Admins choose **Built-in** or **External** per
engine; existing installs that saved a URL keep External. A blank timestamp
authority now means DigiCert. A `-slim` image leaves the engines out.

## Files

**Domain**
- `entities/signature-config.ts`: `EngineChoice`, `BUILT_IN_ENGINE`,
  `BuiltInEngineStatus`, `DEFAULT_TSA_URL`, `resolveTsaUrl`, legacy-row mapping,
  new validation and probe targets.
- `ports/signature-engine.ts`: takes `engine: EngineChoice`.

**Application**
- `complete-certificate-signing.ts`, `off-system-signed-evidence.ts`,
  `session-signatures.ts`: pass the engine choice and resolved TSA.
- `get-signature-config.ts`, `save-signature-config.ts`: new config shape.

**Adapters** (`signing/`)
- New: `engine-supervisor.ts`, `local-pdf-converter.ts`, `built-in-engines.ts`
  (`RoutingPdfConverter`, `createBuiltInEngines`).
- Changed: `dss-signature-engine.ts` (resolves the choice),
  `signature-services-probe.ts` (built-in probes, TSA default).

**Web**
- `lib/container-signing.ts`, `lib/container.ts`: one set of built-in engines
  per web process, stopped on exit.
- `server/routers/settings-signature.ts`: engine-choice schema, engine status,
  converter availability for the PDF toggle.
- `components/settings/signature-card.tsx` and new `signature-card-model.ts`:
  Built-in/External per engine, status line, Advanced TSA, Test labels.
- `lib/e2e-fixtures-signing.ts`: new config shape.

**Image and deployment**
- `Dockerfile`: `dss-build` and `jre` stages; `runtime-slim` and `runtime`
  (default, last) targets.
- `.dockerignore`: `deploy/dss` sources enter the build context.
- `deploy/dss/src/.../Server.java`: `BIND_ADDRESS`.
- `deploy/dss/smoke-built-in.sh`: in-image converter and engine smoke test.
- `.github/workflows/ci.yml`: `-slim` build, scan, absence check, both sizes;
  built-in smoke in the DSS job.
- `.github/workflows/publish.yml`: scans and pushes `:<version>-slim` / `:slim`.
- `docker-compose*.yml`: `./trust` mounted into the web service; Gotenberg and
  DSS profiles described as optional external engines.

**Docs**
- `docs/guides/document-signatures.md`, `setup-admin.md`, `setup-aws.md`,
  `setup-azure.md`, `setup-aws-lambda.md`.
- ADR-067 header ("Amended by ADR-069"), ADR-069 "As built".

## Migrations

None. The engine choice lives in the existing encrypted `signature_config`
setting; old rows are mapped forward when parsed.

## Tests

- **Unit** (written before each implementation):
  - domain config (legacy rows, defaults, validation, targets, TSA);
  - application signing and config;
  - `EngineSupervisor` (10 cases including concurrent start, crash restart,
    give-up window and idle stop);
  - `LocalPdfConverter` (8 cases including per-job profiles, concurrency,
    timeout, cleanup);
  - DSS engine routing;
  - probes (built-in converter and engine, TSA default);
  - converter routing;
  - settings router schema;
  - settings card model.
- **Real engines, locally:**
  - two concurrent LibreOffice conversions produce PDF/A;
  - the supervisor starts the real jar on loopback;
  - `smoke-built-in.sh` passes with the `jlink` runtime from the Dockerfile's
    `jre` stage (both signatures B-LTA, tamper detected, four refusals);
  - the app was driven with real built-in engines for the screenshots on #386.
- **E2E:** none new. The feature is not in an e2e-policy group, and the
  existing `document-signatures.spec.ts` keeps running on an External mock
  converter.
- `./validate.sh` passes.

## Image sizes

The `jlink` runtime is about 60 MB. CI's "Report image sizes" step prints the
default and `-slim` sizes. The full image could not be built in the
development sandbox, whose network blocks the Debian mirror.

## Known limitations

- No built-in engines on the Lambda topology (External only).
- The signing provider's own CSC timestamp service is not used; the default is
  DigiCert.
- The JVM logs one harmless PDFBox `InaccessibleObjectException` per signing
  (an optional buffer-unmapping optimisation Java 21 blocks).

## Deviations from the approved summary

- `ISignatureEngine` takes the engine choice instead of a URL (approved at the
  build gate).
- The settings router reads engine status straight from the adapter wiring.
- Found while taking the screenshots: a Test refreshed the engine status, which
  re-filled the open dialog and discarded the admin's edits and Test results.
  The dialog now fills once per opening.
