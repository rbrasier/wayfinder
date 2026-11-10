// Working keys on an approval's `recordSnapshot`, distinct from the
// step-prefixed reporting keys `buildApprovalRecord` writes (ADR-040 §5). These
// are read back by the system — the subject cache at the gate, the attestation
// when the document is re-rendered — rather than pivoted into a report, so they
// are unprefixed and named once here so a reader and a writer cannot disagree.

export const SUBJECT_DESCRIPTION_KEY = "subjectDescription";
export const SUBJECT_NODE_ID_KEY = "subjectNodeId";
export const SIGNATURE_FIELD_KEY = "signatureFieldKey";
// The rendered attestation block, frozen at decision time. Stored rather than
// recomputed so a later change around it can never alter what was signed.
export const ATTESTATION_TEXT_KEY = "attestationText";
// The approver's drawn signature object, frozen at decision time (ADR-067 §2).
// A path, not the user's current drawing, so a redraw never re-signs the past.
export const DRAWN_SIGNATURE_PATH_KEY = "drawnSignatureStoragePath";
export const STEP_KEY = "stepKey";
