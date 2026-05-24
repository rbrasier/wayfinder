type ErrorLike = Error & {
  cause?: unknown;
  code?: unknown;
  detail?: unknown;
};

const MAX_DEPTH = 4;

const fromError = (error: ErrorLike, depth: number): Record<string, unknown> => {
  const out: Record<string, unknown> = {
    name: error.name,
    message: error.message,
  };
  if (error.stack) out.stack = error.stack;
  if (typeof error.code === "string" || typeof error.code === "number") {
    out.code = error.code;
  }
  if (typeof error.detail === "string") {
    out.detail = error.detail;
  }
  if (error.cause !== undefined && depth < MAX_DEPTH) {
    const nested = causeToMetadataAt(error.cause, depth + 1);
    if (nested) out.cause = nested;
  }
  return out;
};

const causeToMetadataAt = (
  cause: unknown,
  depth: number,
): Record<string, unknown> | null => {
  if (cause === undefined || cause === null) return null;
  if (cause instanceof Error) return fromError(cause as ErrorLike, depth);
  if (typeof cause === "string") return { value: cause };
  if (typeof cause === "number" || typeof cause === "boolean") {
    return { value: String(cause) };
  }
  try {
    return { value: JSON.stringify(cause) };
  } catch {
    return { value: String(cause) };
  }
};

export const causeToMetadata = (cause: unknown): Record<string, unknown> | null =>
  causeToMetadataAt(cause, 0);
