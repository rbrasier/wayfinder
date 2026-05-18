import { describe, it, expect } from "vitest";
import { loadEnv } from "./env.js";

const REQUIRED = {
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/testdb",
};

function withEnv(overrides: Record<string, string | undefined>, fn: () => void) {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(overrides)) {
    saved[k] = process.env[k];
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  }
}

describe("loadEnv", () => {
  it("parses required fields and applies defaults", () => {
    withEnv({ ...REQUIRED, OTEL_EXPORTER_OTLP_ENDPOINT: undefined, LANGFUSE_HOST: undefined }, () => {
      const env = loadEnv();
      expect(env.DATABASE_URL).toBe(REQUIRED.DATABASE_URL);
      expect(["development", "test"]).toContain(env.NODE_ENV);
    });
  });

  it("does not throw when OTEL_EXPORTER_OTLP_ENDPOINT is an empty string", () => {
    withEnv({ ...REQUIRED, OTEL_EXPORTER_OTLP_ENDPOINT: "" }, () => {
      expect(() => loadEnv()).not.toThrow();
      expect(loadEnv().OTEL_EXPORTER_OTLP_ENDPOINT).toBeUndefined();
    });
  });

  it("does not throw when LANGFUSE_HOST is an empty string", () => {
    withEnv({ ...REQUIRED, LANGFUSE_HOST: "" }, () => {
      expect(() => loadEnv()).not.toThrow();
      expect(loadEnv().LANGFUSE_HOST).toBeUndefined();
    });
  });

  it("accepts a valid URL for OTEL_EXPORTER_OTLP_ENDPOINT", () => {
    withEnv({ ...REQUIRED, OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318" }, () => {
      expect(loadEnv().OTEL_EXPORTER_OTLP_ENDPOINT).toBe("http://localhost:4318");
    });
  });

  it("throws when OTEL_EXPORTER_OTLP_ENDPOINT is a non-URL string", () => {
    withEnv({ ...REQUIRED, OTEL_EXPORTER_OTLP_ENDPOINT: "not-a-url" }, () => {
      expect(() => loadEnv()).toThrow();
    });
  });
});
