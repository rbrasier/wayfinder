import { TRPCError } from "@trpc/server";
import type { DomainError, DomainErrorCode } from "@rbrasier/domain";

const codeMap: Record<DomainErrorCode, TRPCError["code"]> = {
  NOT_FOUND: "NOT_FOUND",
  ALREADY_EXISTS: "CONFLICT",
  VALIDATION_FAILED: "BAD_REQUEST",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  AI_PROVIDER_FAILED: "INTERNAL_SERVER_ERROR",
  AGENT_FAILED: "INTERNAL_SERVER_ERROR",
  QUOTA_EXCEEDED: "FORBIDDEN",
  INFRA_FAILURE: "INTERNAL_SERVER_ERROR",
};

export const toTrpcError = (error: DomainError): TRPCError =>
  new TRPCError({
    code: codeMap[error.code],
    message: error.message,
    cause: error.cause,
  });
