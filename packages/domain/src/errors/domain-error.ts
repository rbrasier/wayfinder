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

export interface DomainError {
  readonly code: DomainErrorCode;
  readonly message: string;
  readonly cause?: unknown;
}

export const domainError = (
  code: DomainErrorCode,
  message: string,
  cause?: unknown,
): DomainError => ({ code, message, cause });
