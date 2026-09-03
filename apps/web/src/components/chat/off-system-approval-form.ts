// The pure rules behind the "Approved off system" dialog, kept out of the
// component so they can be asserted without rendering.
//
// The server owns the real rule (ADR-055 §1) — it is the only side that knows
// when the session started. What is here exists to stop the obvious mistakes
// before a 10 MB payload is sent, never to be the gate.

// 10 MB, matching the router's ceiling on the base64 that carries it. A scan or
// a photographed page fits comfortably; anything larger is a mistake rather
// than proof of an approval.
export const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;

export interface OffSystemFormState {
  filename: string | null;
  sizeBytes: number;
  approvedOn: string;
}

// Why the form cannot be submitted yet, or null when it can. Both fields are
// required and neither has a default that stands in for the other: evidence with
// no date is undated, and a date with no evidence is an assertion.
export const offSystemFormError = (
  state: OffSystemFormState,
  today: string,
): string | null => {
  if (!state.filename) return "Attach the evidence that this approval happened.";
  if (state.sizeBytes === 0) return "That file is empty.";
  if (state.sizeBytes > MAX_EVIDENCE_BYTES) return "That file is larger than 10 MB.";
  if (!state.approvedOn) return "Confirm the date the approval happened.";
  // String comparison is safe and exact on ISO dates, and avoids parsing a
  // local-time Date only to compare its UTC day back again.
  if (state.approvedOn > today) return "The approval date cannot be in the future.";
  return null;
};

// Today as the date input reports it — the viewer's own day, not the server's.
// A UTC "today" would refuse this morning's approval for anyone far enough east.
export const localToday = (now: Date): string => {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

// Bytes as the mutation carries them. Chunked because spreading a large array
// into `String.fromCharCode` blows the argument limit somewhere above a few
// hundred kilobytes — well inside the size this dialog accepts.
export const toBase64 = (bytes: Uint8Array): string => {
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
};
