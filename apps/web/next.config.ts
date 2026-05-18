import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  transpilePackages: [
    "@rbrasier/domain",
    "@rbrasier/application",
    "@rbrasier/adapters",
    "@rbrasier/shared",
  ],
  serverExternalPackages: [
    "pino",
    "pino-pretty",
    "@opentelemetry/sdk-node",
    "@opentelemetry/instrumentation",
    "@opentelemetry/instrumentation-http",
    "@opentelemetry/instrumentation-express",
    "@opentelemetry/instrumentation-pg",
    "require-in-the-middle",
  ],
};

export default config;
