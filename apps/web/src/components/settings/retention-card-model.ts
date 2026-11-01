import type { RetentionPolicy } from "@wayfinder/domain";

export const KEEP_FOREVER_LABEL = "Keep forever";

// `0` is not "delete immediately" — it disables the sweep. Reading it as a
// number in a box labelled "days" invites exactly the wrong conclusion, so the
// UI never shows a bare 0.
export const windowLabel = (retentionDays: number): string => {
  if (retentionDays <= 0) return KEEP_FOREVER_LABEL;
  if (retentionDays === 1) return "1 day";
  return `${retentionDays} days`;
};

export interface RetentionRow {
  key: string;
  label: string;
  retentionDays: number;
  windowLabel: string;
  isSweeping: boolean;
  // Observations are the one target holding text taken verbatim from a session,
  // and they outlive the sessions they came from, so the card says so rather
  // than leaving an admin to infer it.
  note: string | null;
}

const OBSERVATION_NOTE =
  "Holds evidence quoted from real sessions, and is not deleted when a chat is. This window is the only thing that removes it.";

export const retentionRows = (policies: RetentionPolicy[]): RetentionRow[] =>
  policies.map((policy) => ({
    key: policy.key,
    label: policy.label,
    retentionDays: policy.retentionDays,
    windowLabel: windowLabel(policy.retentionDays),
    isSweeping: policy.retentionDays > 0,
    note: policy.key === "ai_flow_observations" ? OBSERVATION_NOTE : null,
  }));

// An admin typing into a "days" box can leave it empty mid-edit; that is not a
// request to delete everything, so it reads as keep-forever rather than as an
// error the moment they clear the field.
export const parseWindowInput = (raw: string): number | null => {
  const trimmed = raw.trim();
  if (trimmed === "") return 0;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
};

export const LEGAL_HOLD_NOTE =
  "A legal hold always wins: a chat under hold is never swept, whatever these windows say.";
