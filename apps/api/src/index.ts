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

app.listen(env.API_PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[api] listening on http://localhost:${env.API_PORT}`);
});
