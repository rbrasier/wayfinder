import type { DomainError, DomainErrorCode } from "@wayfinder/domain";

// The route-handler counterpart to `toTrpcError`. Binary endpoints answer with
// plain HTTP rather than a tRPC envelope, and a DomainError still has to arrive
// as the right status — a FORBIDDEN export must not read as a 500.
const statusMap: Record<DomainErrorCode, number> = {
  NOT_FOUND: 404,
  ALREADY_EXISTS: 409,
  VALIDATION_FAILED: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  CONFLICT: 409,
  AI_PROVIDER_FAILED: 502,
  AGENT_FAILED: 500,
  QUOTA_EXCEEDED: 429,
  INFRA_FAILURE: 500,
};

export const statusForDomainError = (error: DomainError): number => statusMap[error.code];
