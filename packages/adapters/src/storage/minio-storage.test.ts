import { describe, it, expect, vi, beforeEach } from "vitest";
import { ok, type ISystemSettingsRepository, type Result, type SystemSetting } from "@rbrasier/domain";
import { MinioStorageAdapter } from "./minio-storage";
import { RuntimeConfigStore } from "../config/runtime-config-store";

const mockMakeBucket = vi.fn();
const mockBucketExists = vi.fn();
const mockPutObject = vi.fn();
const mockGetObject = vi.fn();
const mockRemoveObject = vi.fn();
const mockStatObject = vi.fn();

vi.mock("minio", () => ({
  // Regular function (not an arrow) so vitest can invoke it with `new`.
  Client: vi.fn(function () {
    return {
      makeBucket: mockMakeBucket,
      bucketExists: mockBucketExists,
      putObject: mockPutObject,
      getObject: mockGetObject,
      removeObject: mockRemoveObject,
      statObject: mockStatObject,
    };
  }),
}));

const stubSettingsRepo: ISystemSettingsRepository = {
  async get(): Promise<Result<SystemSetting | null>> {
    return ok(null);
  },
  async set(key: string, value: string): Promise<Result<SystemSetting>> {
    return ok({ key, value, createdAt: new Date(), updatedAt: new Date() });
  },
};

const makeAdapter = () => {
  const store = new RuntimeConfigStore(stubSettingsRepo, {
    provider: "anthropic",
    apiKeys: { anthropic: null, openai: null, mistral: null },
    storage: {
      endpoint: "localhost",
      port: 9000,
      useSSL: false,
      accessKey: "minioadmin",
      secretKey: "minioadmin",
      bucket: "wayfinder-documents",
    },
  });
  return new MinioStorageAdapter(store);
};

describe("MinioStorageAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("initialise", () => {
    it("creates the bucket when it does not exist", async () => {
      mockBucketExists.mockResolvedValue(false);
      mockMakeBucket.mockResolvedValue(undefined);

      const adapter = makeAdapter();
      await adapter.initialise();

      expect(mockBucketExists).toHaveBeenCalledWith("wayfinder-documents");
      expect(mockMakeBucket).toHaveBeenCalledWith("wayfinder-documents");
    });

    it("skips bucket creation when it already exists", async () => {
      mockBucketExists.mockResolvedValue(true);

      const adapter = makeAdapter();
      await adapter.initialise();

      expect(mockMakeBucket).not.toHaveBeenCalled();
    });

    it("propagates the error when the MinIO server is unreachable", async () => {
      const connectionError = Object.assign(new AggregateError([new Error("connect ECONNREFUSED")]), {
        code: "ECONNREFUSED",
      });
      mockBucketExists.mockRejectedValue(connectionError);

      const adapter = makeAdapter();
      await expect(adapter.initialise()).rejects.toMatchObject({ code: "ECONNREFUSED" });
    });
  });

  describe("put", () => {
    it("stores an object and returns the key", async () => {
      mockPutObject.mockResolvedValue({ etag: "abc123" });

      const adapter = makeAdapter();
      const data = Buffer.from("hello world");
      const result = await adapter.put("templates/node1/file.docx", data, "application/octet-stream");

      expect(result.error).toBeUndefined();
      expect(result.data).toEqual({ key: "templates/node1/file.docx" });
      expect(mockPutObject).toHaveBeenCalledWith(
        "wayfinder-documents",
        "templates/node1/file.docx",
        data,
        data.length,
        { "Content-Type": "application/octet-stream" },
      );
    });

    it("returns an error when put fails", async () => {
      mockPutObject.mockRejectedValue(new Error("network error"));

      const adapter = makeAdapter();
      const result = await adapter.put("templates/node1/file.docx", Buffer.from("data"), "application/octet-stream");

      expect(result.error).toBeDefined();
      expect(result.error?.code).toBe("INFRA_FAILURE");
    });
  });

  describe("get", () => {
    it("retrieves an object as a Buffer", async () => {
      const { Readable } = await import("node:stream");
      const readable = Readable.from([Buffer.from("file content")]);
      mockGetObject.mockResolvedValue(readable);

      const adapter = makeAdapter();
      const result = await adapter.get("generated/session1/doc.docx");

      expect(result.error).toBeUndefined();
      expect(result.data).toBeInstanceOf(Buffer);
      expect(result.data?.toString()).toBe("file content");
    });

    it("returns NOT_FOUND when the object does not exist", async () => {
      const notFoundError = Object.assign(new Error("object not found"), { code: "NoSuchKey" });
      mockGetObject.mockRejectedValue(notFoundError);

      const adapter = makeAdapter();
      const result = await adapter.get("generated/session1/missing.docx");

      expect(result.error).toBeDefined();
      expect(result.error?.code).toBe("NOT_FOUND");
    });
  });

  describe("delete", () => {
    it("removes the object successfully", async () => {
      mockRemoveObject.mockResolvedValue(undefined);

      const adapter = makeAdapter();
      const result = await adapter.delete("context/flow1/doc.pdf");

      expect(result.error).toBeUndefined();
      expect(mockRemoveObject).toHaveBeenCalledWith("wayfinder-documents", "context/flow1/doc.pdf");
    });

    it("returns an error when removal fails", async () => {
      mockRemoveObject.mockRejectedValue(new Error("permission denied"));

      const adapter = makeAdapter();
      const result = await adapter.delete("context/flow1/doc.pdf");

      expect(result.error).toBeDefined();
      expect(result.error?.code).toBe("INFRA_FAILURE");
    });
  });

  describe("exists", () => {
    it("returns true when the object exists", async () => {
      mockStatObject.mockResolvedValue({ size: 1024 });

      const adapter = makeAdapter();
      const result = await adapter.exists("templates/node1/template.docx");

      expect(result.error).toBeUndefined();
      expect(result.data).toBe(true);
    });

    it("returns false when the object does not exist", async () => {
      const notFoundError = Object.assign(new Error("not found"), { code: "NotFound" });
      mockStatObject.mockRejectedValue(notFoundError);

      const adapter = makeAdapter();
      const result = await adapter.exists("templates/node1/missing.docx");

      expect(result.error).toBeUndefined();
      expect(result.data).toBe(false);
    });
  });
});
