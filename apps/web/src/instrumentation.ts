export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Lazy import to avoid bundling issues at startup
    const { getContainer } = await import("@/lib/container");

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
        // Intentionally silent — logging must never re-throw inside an uncaughtException handler
      }
    };

    process.on("uncaughtException", (error) => persist(error, "uncaughtException"));
    process.on("unhandledRejection", (reason) => persist(reason, "unhandledRejection"));
  }
}
