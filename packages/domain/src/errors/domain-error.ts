export type DomainErrorCode =
  | "NOT_FOUND"
  | "ALREADY_EXISTS"
  | "VALIDATION_FAILED"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  // A conditional write found no matching row: the optimistic-version guard lost
  // to a concurrent writer, or a turn lease is already held (scaling wall #3).
  | "CONFLICT"
  | "AI_PROVIDER_FAILED"
  | "AGENT_FAILED"
  | "QUOTA_EXCEEDED"
  | "INFRA_FAILURE";

// One item of a failure that has several independent causes — a template whose
// tags are each malformed in their own way, say. `subject` is the offending
// input quoted as the author wrote it, so they can find it in the source
// document; `message` says what is wrong with that one item.
export interface DomainErrorDetail {
  readonly subject: string;
  readonly message: string;
}

export interface DomainError {
  readonly code: DomainErrorCode;
  readonly message: string;
  readonly cause?: unknown;
  // Present only where naming every cause helps the user act. `message` always
  // stands on its own, so a caller may ignore this.
  readonly details?: readonly DomainErrorDetail[];
}

export const domainError = (
  code: DomainErrorCode,
  message: string,
  cause?: unknown,
  details?: readonly DomainErrorDetail[],
): DomainError => ({ code, message, cause, ...(details?.length ? { details } : {}) });
