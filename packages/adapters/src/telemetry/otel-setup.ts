import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { ExpressInstrumentation } from "@opentelemetry/instrumentation-express";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  BatchSpanProcessor,
  ConsoleSpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

let sdk: NodeSDK | null = null;

export interface TelemetryConfig {
  readonly serviceName?: string;
  readonly otlpEndpoint?: string;
  readonly isDev?: boolean;
}

export const setupTelemetry = (config: TelemetryConfig = {}): void => {
  if (sdk) return;

  const { serviceName = "template-api", otlpEndpoint, isDev = false } = config;

  const spanProcessors = [];

  if (otlpEndpoint) {
    const exporter = new OTLPTraceExporter({ url: `${otlpEndpoint}/v1/traces` });
    spanProcessors.push(new BatchSpanProcessor(exporter));
  } else if (isDev) {
    spanProcessors.push(new SimpleSpanProcessor(new ConsoleSpanExporter()));
  }

  if (spanProcessors.length === 0) return;

  sdk = new NodeSDK({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: serviceName }),
    spanProcessors,
    instrumentations: [
      new HttpInstrumentation(),
      new ExpressInstrumentation(),
      new PgInstrumentation(),
    ],
  });

  sdk.start();
};

export const shutdownTelemetry = async (): Promise<void> => {
  if (sdk) {
    await sdk.shutdown();
    sdk = null;
  }
};
