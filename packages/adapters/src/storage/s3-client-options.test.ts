import { describe, expect, it } from "vitest";
import type { StorageConfig } from "@wayfinder/domain";
import { s3ClientOptions } from "./s3-client-options";

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

describe("s3ClientOptions", () => {
  it("builds the endpoint URL from host, port and TLS setting", () => {
    expect(s3ClientOptions(config()).endpoint).toBe("http://localhost:9000");
    expect(s3ClientOptions(config({ useSSL: true, port: 443, endpoint: "s3.eu-west-2.amazonaws.com" })).endpoint).toBe(
      "https://s3.eu-west-2.amazonaws.com:443",
    );
  });

  it("carries the credentials through unchanged", () => {
    expect(s3ClientOptions(config()).credentials).toEqual({ accessKeyId: "key", secretAccessKey: "secret" });
  });

  it("falls back to us-east-1 and follows region redirects when no region is configured", () => {
    const options = s3ClientOptions(config({ region: "" }));

    expect(options.region).toBe("us-east-1");
    expect(options.followRegionRedirects).toBe(true);
  });

  it("passes a configured region through so Amazon S3 requests sign correctly", () => {
    expect(s3ClientOptions(config({ region: "eu-west-2" })).region).toBe("eu-west-2");
  });

  it("maps path-style addressing onto forcePathStyle", () => {
    expect(s3ClientOptions(config({ pathStyle: true })).forcePathStyle).toBe(true);
    expect(s3ClientOptions(config({ pathStyle: false })).forcePathStyle).toBe(false);
  });
});
