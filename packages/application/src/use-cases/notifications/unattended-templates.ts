import type { EmailContent } from "./templates";

// Subject/body builders for the three unattended-run alerts (ADR-065 §6). Kept
// beside templates.ts in the same no-framework style; bodies stay to names, the
// reason and a link, so no step output reaches an inbox.

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const build = (subject: string, lines: string[], url: string, linkText: string): EmailContent => ({
  subject,
  text: [...lines, "", `${linkText}: ${url}`].join("\n"),
  html: [
    ...lines.map((line) => `<p>${escapeHtml(line)}</p>`),
    `<p><a href="${escapeHtml(url)}">${escapeHtml(linkText)}</a></p>`,
  ].join("\n"),
});

export const buildRunFailedEmail = (input: {
  runName: string;
  stepName: string;
  reason: string;
  sessionUrl: string;
}): EmailContent =>
  build(
    `Unattended run stopped at '${input.stepName}'`,
    [
      `The unattended run '${input.runName}' stopped at the step '${input.stepName}'.`,
      `Reason: ${input.reason}`,
      "Open the run to see what happened, then retry the step once the cause is fixed.",
    ],
    input.sessionUrl,
    "Open the run",
  );

export const buildAwaitingPersonEmail = (input: {
  runName: string;
  stepName: string;
  sessionUrl: string;
}): EmailContent =>
  build(
    `'${input.stepName}' needs you`,
    [`The unattended run '${input.runName}' has reached '${input.stepName}', which needs a person to continue.`],
    input.sessionUrl,
    "Open the run",
  );

export const buildWatchPausedEmail = (input: {
  watchName: string;
  reason: string;
  watchUrl: string;
}): EmailContent =>
  build(
    `Event Watch '${input.watchName}' has paused`,
    [
      `The Event Watch '${input.watchName}' has paused and will not start any runs until it is resumed.`,
      `Reason: ${input.reason}`,
    ],
    input.watchUrl,
    "Open the watch",
  );
