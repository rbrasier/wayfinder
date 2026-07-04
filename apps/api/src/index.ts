import "dotenv/config";
import { setupTelemetry } from "@rbrasier/adapters";
import { buildApp } from "./app.js";
import { buildContainer } from "./container.js";
import { loadEnv } from "./env.js";

const env = loadEnv();

setupTelemetry({
  serviceName: env.OTEL_SERVICE_NAME,
  otlpEndpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
  isDev: env.NODE_ENV === "development",
});

const container = buildContainer(env);
const app = buildApp(container);

const server = app.listen(env.API_PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[api] listening on http://localhost:${env.API_PORT}`);
});

if (env.SCHEDULER_ENABLED && container.schedulerWorkers.length > 0) {
  for (const worker of container.schedulerWorkers) {
    void worker.start().catch((error: unknown) => {
      container.logger.error("Scheduler heartbeat failed to start.", {
        reason: error instanceof Error ? error.message : String(error),
      });
    });
  }
  // eslint-disable-next-line no-console
  console.log(`[api] scheduler heartbeat started (${container.schedulerWorkers.length} worker(s))`);
} else if (env.SCHEDULER_ENABLED) {
  container.logger.warn(
    "Scheduler enabled but not started: set SCHEDULER_TICK_URL and SCHEDULER_TICK_SECRET.",
  );
}

if (env.RETENTION_ENABLED && container.retentionWorkers.length > 0) {
  for (const worker of container.retentionWorkers) {
    void worker.start().catch((error: unknown) => {
      container.logger.error("Retention worker failed to start.", {
        reason: error instanceof Error ? error.message : String(error),
      });
    });
  }
  // eslint-disable-next-line no-console
  console.log(`[api] retention worker started (${container.retentionWorkers.length} worker(s))`);
}

const shutdown = (signal: string) => {
  // eslint-disable-next-line no-console
  console.log(`[api] received ${signal}, shutting down`);
  for (const worker of container.schedulerWorkers) worker.stop();
  for (const worker of container.retentionWorkers) worker.stop();
  server.close(() => process.exit(0));
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
