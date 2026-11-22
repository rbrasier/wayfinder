# Bug fix — Built-in signing engines hardening (v0.41.6)

- **Source**: review of PR #390 (issue #386)
- **Base**: `release/alpha-3`, on `claude/issue-386-triage-9qb2ii`
- **Version**: PATCH 0.41.5 → 0.41.6
- **ADR**: ADR-069 §6 (new)

## Approved change summary

The built-in PDF converter ran LibreOffice inside the web container with the web
server's secrets in its environment, and fetched anything a document linked to.
This fix gives it a minimal environment and makes it refuse documents that link
to outside content. It also closes four holes in how the built-in engines are
supervised.

### Business rules
- **Linked content:** a document that links to outside content other than
  hyperlinks is refused by the built-in converter, with a message saying to
  embed the content. Before, it was fetched.
- **Idle stop:** the built-in signature engine stops 30 minutes after its last
  request finishes. Before, it counted from when the last request started.
- **Giving up:** a crash after a healthy start counts toward "three failures in
  five minutes". Before, only failed starts counted.
- **Shutdown:** stopping the engine during a start cancels the start. Before,
  the JVM was left running.

## Root causes (verified)

1. **Linked content fetched.** `LocalPdfConverter` passed any bytes to
   `soffice`. Reproduced with a `.docx` whose `word/_rels/document.xml.rels`
   holds an image relationship with `TargetMode="External"`: LibreOffice issued
   an HTTP GET to a local listener, and converted a `file://` target without
   error.
2. **Secrets in LibreOffice's environment.** `runProcess` spawned `soffice`
   with no `env`, so it inherited the web server's; only the JVM had an
   allowlist.
3. **Idle stop mid-request.** `EngineSupervisor` reset its idle timer only in
   `ensureRunning()`, at the start of a request, and knew nothing of requests
   in flight.
4. **Crash loop never gives up.** The exit listener cleared `running` but only
   `start()` recorded a failure.
5. **Timeout kill can throw.** `process.kill(-pid)` in a timer had no guard;
   `ESRCH` there is an uncaught exception in the web server.
6. **Stop during start.** `stop()` only killed `running`, which is not set
   until the health check passes, so the pending start went on to register its
   JVM.

## Fix

- `docx-outside-content.ts` (new): lists the kinds of external relationship in
  every `_rels/*.rels` part, ignoring hyperlinks; rejects non-`.docx` bytes.
  `LocalPdfConverter` refuses with `VALIDATION_FAILED` before queuing.
- `built-in-engines.ts`: `childEnvironment` allowlist used for both LibreOffice
  (`PATH, HOME, TZ, LANG, LC_ALL, TMPDIR`) and the JVM; `killProcessGroup`
  swallows a kill of a process that has gone.
- `engine-supervisor.ts`: `withEngine` counts requests in flight and schedules
  the idle stop only when none remain; an exit while registered as running is
  recorded as a failure; `stop()` bumps a counter that a pending start checks
  after each health poll.
- `dss-signature-engine.ts`: built-in requests run inside `withEngine`.

## Tests

- **Regression (unit):** 4 refusal cases, hyperlink allowed, non-docx refused
  (`local-pdf-converter.test.ts`); environment allowlist and kill guard
  (`built-in-engines.test.ts`); idle stop held during a request, failed start
  inside `withEngine`, crash-loop give-up, own stop not counted as a crash,
  cancelled start (`engine-supervisor.test.ts`). Existing converter tests now
  convert a real minimal `.docx`.
- **Real LibreOffice, locally:** converts to PDF/A with the minimal environment;
  refuses the linked-image document that reproduced the bug.
- **E2E:** none. Not in an e2e-policy group; the regression tests are the guard.

## Known limitations

- LibreOffice still runs as the web server's user with its filesystem.
- The external (Gotenberg) converter is not checked for linked content.
- A template that relies on a linked image must embed it to convert built-in.

## Deviations

- Fixed on PR #390's branch, not a new `bugfix/…` branch: the code exists only
  there.
- Non-`.docx` bytes are refused too (not in the summary): LibreOffice opens a
  file as whatever its content is, which would bypass the relationship check.
