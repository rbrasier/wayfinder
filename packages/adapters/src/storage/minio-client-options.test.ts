import { describe, expect, it } from "vitest";
import type { StorageConfig } from "@wayfinder/domain";
import { minioClientOptions } from "./minio-client-options";

const config = (overrides: Partial<StorageConfig> = {}): StorageConfig => ({
  endpoint: "localhost",
  port: 9000,
  useSSL: false,
  accessKey: "key",
  secretKey: "secret",
  bucket: "wayfinder-documents",
  region: "",
  pathStyle: true,
  ...overrides,
});

describe("minioClientOptions", () => {
  it("carries the connection settings through unchanged", () => {
    expect(minioClientOptions(config())).toMatchObject({
      endPoint: "localhost",
      port: 9000,
      useSSL: false,
      accessKey: "key",
      secretKey: "secret",
      pathStyle: true,
    });
  });

  it("omits region entirely when unset rather than sending an empty string", () => {
    // An empty region would be signed literally; leaving the key off lets the
    // client fall back to its own discovery, which is what MinIO needs.
    expect(minioClientOptions(config({ region: "" }))).not.toHaveProperty("region");
  });

  it("passes a configured region through so Amazon S3 requests sign correctly", () => {
    expect(minioClientOptions(config({ region: "eu-west-2" }))).toMatchObject({
      region: "eu-west-2",
    });
  });

  it("honours virtual-hosted addressing when path-style is off", () => {
    expect(minioClientOptions(config({ pathStyle: false })).pathStyle).toBe(false);
  });
});
