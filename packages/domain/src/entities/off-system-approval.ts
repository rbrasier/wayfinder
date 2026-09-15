// An approval that happened outside Wayfinder, recorded against the assigned
// approver by someone else (ADR-055). The approver still signs; what changes is
// that the system is being told about a decision rather than witnessing one.

// The file filed as proof the approval happened — a signed memo, an email
// export, a scanned minute. Stored in object storage under
// `approval-evidence/<approvalId>/…`, never in `app_session_uploads`: rows there
// are extracted into the session's AI system prompt, and a governance artefact
// must not become model context (ADR-055 §7).
export interface OffSystemApprovalEvidence {
  readonly filename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly storagePath: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Midnight UTC on the calendar day an instant falls in, so two moments are
// compared as the days they name rather than as points in time. Comparing the
// instants would reject an approval dated today whenever "now" is later in the
// day than the boundary being tested against.
const startOfUtcDay = (value: Date): number =>
  Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());

// The parsed day, or null if the string does not name a real one. The
// round-trip check is what rejects 2026-02-30: `Date` rolls that forward to
// 2026-03-02 rather than failing, so parsing alone would accept it.
const parsedDay = (approvedOn: string): number | null => {
  if (!ISO_DATE.test(approvedOn)) return null;
  const parsed = new Date(`${approvedOn}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10) === approvedOn ? parsed.getTime() : null;
};

// Whether a nominated approval date is usable, and why not if it is not.
//
// `notBefore` is when the work being approved came into existence — the session
// start, supplied by the caller rather than assumed here. Deliberately not the
// moment the approval request was raised: an operator often secures sign-off
// while the flow is still running and only reaches the approval step afterwards,
// and rejecting that would block the commonest legitimate case (ADR-055 §1).
export const offSystemDateError = (
  approvedOn: string,
  notBefore: Date,
  now: Date,
): string | null => {
  const day = parsedDay(approvedOn);
  if (day === null) return "Enter the approval date as YYYY-MM-DD.";
  if (day > startOfUtcDay(now)) return "The approval date cannot be in the future.";
  if (day < startOfUtcDay(notBefore)) {
    return "The approval date cannot be before this work started.";
  }
  return null;
};
