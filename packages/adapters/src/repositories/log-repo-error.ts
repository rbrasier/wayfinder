export const logRepoError = (where: string, cause: unknown): void => {
  const error = cause instanceof Error ? cause : new Error(String(cause));
  const code = (error as Error & { code?: unknown }).code;
  const detail = (error as Error & { detail?: unknown }).detail;
  console.error(
    `[repo:${where}] ${error.message}${code ? ` (code=${String(code)})` : ""}${detail ? ` detail=${String(detail)}` : ""}`,
  );
  if (error.stack) console.error(error.stack);
};
