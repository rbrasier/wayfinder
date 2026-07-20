export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Lazy import to avoid bundling the container into the edge runtime.
  const { getContainer } = await import("@/lib/container");

  if (process.env.NODE_ENV === "production") {
    const persist = (err: unknown, source: string) => {
      try {
        const error = err instanceof Error ? err : new Error(String(err));
        const container = getContainer();
        void container.services.errorLogger.log({
          level: "fatal",
          message: error.message,
          stack: error.stack ?? null,
          page: `process:${source}`,
          metadata: { source },
        });
      } catch {
        // Logging must never re-throw inside an uncaughtException handler
      }
    };

    process.on("uncaughtException", (error) => persist(error, "uncaughtException"));
    process.on("unhandledRejection", (reason) => persist(reason, "unhandledRejection"));
  }

  // First-run setup link (ADR-041 §5). Emitted at app startup so it appears under
  // every launch method (pnpm dev, pnpm start, node, containers). Ensures a
  // setup token while no admin exists and logs a clickable link; once an admin
  // exists the use-case returns null and nothing is logged.
  try {
    const container = getContainer();
    const result = await container.useCases.ensureSetupToken.execute();
    if (!result.error && result.data) {
      const link = `${container.env.BETTER_AUTH_URL}/setup?token=${result.data}`;
      console.log(
        `\n────────────────────────────────────────────────────────────\n` +
          `  Wayfinder first-run setup — create your admin account here:\n` +
          `  ${link}\n` +
          `────────────────────────────────────────────────────────────\n`,
      );
    }
  } catch {
    // The DB may not be migrated yet on the very first boot; the link is emitted
    // on the next start. Never block startup on it.
  }
}
