import { describe, it, expect, vi, beforeEach } from "vitest";
import { ok, type ISystemSettingsRepository, type Result, type SystemSetting } from "@wayfinder/domain";
import { S3ObjectStorageAdapter } from "./s3-object-storage";
import { RuntimeConfigStore } from "../config/runtime-config-store";

const mockSend = vi.fn();

vi.mock("@aws-sdk/client-s3", () => {
  // Regular functions (not arrows) so vitest can invoke them with `new`.
  const command = (name: string) =>
    vi.fn(function (this: { name: string; input: unknown }, input: unknown) {
      this.name = name;
      this.input = input;
    });
  return {
    S3Client: vi.fn(function () {
      return { send: mockSend };
    }),
    HeadBucketCommand: command("HeadBucket"),
    CreateBucketCommand: command("CreateBucket"),
    PutObjectCommand: command("PutObject"),
    GetObjectCommand: command("GetObject"),
    DeleteObjectCommand: command("DeleteObject"),
    HeadObjectCommand: command("HeadObject"),
  };
});

const sentCommands = () => mockSend.mock.calls.map(([command]) => command as { name: string; input: unknown });

const s3Error = (name: string, httpStatusCode: number) =>
  Object.assign(new Error(name), { name, $metadata: { httpStatusCode } });

const stubSettingsRepository: ISystemSettingsRepository = {
  async get(): Promise<Result<SystemSetting | null>> {
    return ok(null);
  },
  async set(key: string, value: string): Promise<Result<SystemSetting>> {
    return ok({ key, value, createdAt: new Date(), updatedAt: new Date() });
  },
  async delete(): Promise<Result<void>> {
    return ok(undefined);
  },
};

const makeAdapter = (region = "") => {
  const store = new RuntimeConfigStore(stubSettingsRepository, {
    provider: "anthropic",
    apiKeys: { anthropic: null, openai: null, mistral: null },
    storage: {
      endpoint: "localhost",
      port: 9000,
      useSSL: false,
      accessKey: "minioadmin",
      secretKey: "minioadmin",
      bucket: "wayfinder-documents",
      region,
      pathStyle: true,
    },
  });
  return new S3ObjectStorageAdapter(store);
};

describe("S3ObjectStorageAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("initialise", () => {
    it("creates the bucket when it does not exist", async () => {
      mockSend.mockRejectedValueOnce(s3Error("NotFound", 404)).mockResolvedValueOnce({});

      await makeAdapter().initialise();

      expect(sentCommands()).toEqual([
        { name: "HeadBucket", input: { Bucket: "wayfinder-documents" } },
        { name: "CreateBucket", input: { Bucket: "wayfinder-documents" } },
      ]);
    });

    it("asks for the configured region outside us-east-1, which S3 requires on create", async () => {
      mockSend.mockRejectedValueOnce(s3Error("NotFound", 404)).mockResolvedValueOnce({});

      await makeAdapter("eu-west-2").initialise();

      expect(sentCommands()[1]).toEqual({
        name: "CreateBucket",
        input: { Bucket: "wayfinder-documents", CreateBucketConfiguration: { LocationConstraint: "eu-west-2" } },
      });
    });

    it("skips bucket creation when it already exists", async () => {
      mockSend.mockResolvedValueOnce({});

      await makeAdapter().initialise();

      expect(sentCommands().map((command) => command.name)).toEqual(["HeadBucket"]);
    });

    it("propagates the error when the storage server is unreachable", async () => {
      const connectionError = Object.assign(new AggregateError([new Error("connect ECONNREFUSED")]), {
        code: "ECONNREFUSED",
      });
      mockSend.mockRejectedValueOnce(connectionError);

      await expect(makeAdapter().initialise()).rejects.toMatchObject({ code: "ECONNREFUSED" });
    });
  });

  describe("put", () => {
    it("stores an object and returns the key", async () => {
      mockSend.mockResolvedValueOnce({ ETag: "abc123" });
      const data = Buffer.from("hello world");

      const result = await makeAdapter().put("templates/node1/file.docx", data, "application/octet-stream");

      expect(result.error).toBeUndefined();
      expect(result.data).toEqual({ key: "templates/node1/file.docx" });
      expect(sentCommands()).toEqual([
        {
          name: "PutObject",
          input: {
            Bucket: "wayfinder-documents",
            Key: "templates/node1/file.docx",
            Body: data,
            ContentLength: data.length,
            ContentType: "application/octet-stream",
          },
        },
      ]);
    });

    it("returns an error when put fails", async () => {
      mockSend.mockRejectedValueOnce(new Error("network error"));

      const result = await makeAdapter().put("templates/node1/file.docx", Buffer.from("data"), "application/octet-stream");

      expect(result.error?.code).toBe("INFRA_FAILURE");
    });
  });

  describe("get", () => {
    it("retrieves an object as a Buffer", async () => {
      mockSend.mockResolvedValueOnce({
        Body: { transformToByteArray: async () => new TextEncoder().encode("file content") },
      });

      const result = await makeAdapter().get("generated/session1/doc.docx");

      expect(result.error).toBeUndefined();
      expect(result.data).toBeInstanceOf(Buffer);
      expect(result.data?.toString()).toBe("file content");
      expect(sentCommands()[0]).toEqual({
        name: "GetObject",
        input: { Bucket: "wayfinder-documents", Key: "generated/session1/doc.docx" },
      });
    });

    it("returns NOT_FOUND when the object does not exist", async () => {
      mockSend.mockRejectedValueOnce(s3Error("NoSuchKey", 404));

      const result = await makeAdapter().get("generated/session1/missing.docx");

      expect(result.error?.code).toBe("NOT_FOUND");
    });

    it("returns INFRA_FAILURE for any other failure", async () => {
      mockSend.mockRejectedValueOnce(s3Error("AccessDenied", 403));

      const result = await makeAdapter().get("generated/session1/doc.docx");

      expect(result.error?.code).toBe("INFRA_FAILURE");
    });
  });

  describe("delete", () => {
    it("removes the object successfully", async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await makeAdapter().delete("context/flow1/doc.pdf");

      expect(result.error).toBeUndefined();
      expect(sentCommands()[0]).toEqual({
        name: "DeleteObject",
        input: { Bucket: "wayfinder-documents", Key: "context/flow1/doc.pdf" },
      });
    });

    it("returns an error when removal fails", async () => {
      mockSend.mockRejectedValueOnce(new Error("permission denied"));

      const result = await makeAdapter().delete("context/flow1/doc.pdf");

      expect(result.error?.code).toBe("INFRA_FAILURE");
    });
  });

  describe("exists", () => {
    it("returns true when the object exists", async () => {
      mockSend.mockResolvedValueOnce({ ContentLength: 1024 });

      const result = await makeAdapter().exists("templates/node1/template.docx");

      expect(result.data).toBe(true);
      expect(sentCommands()[0]).toEqual({
        name: "HeadObject",
        input: { Bucket: "wayfinder-documents", Key: "templates/node1/template.docx" },
      });
    });

    it("returns false when the object does not exist", async () => {
      mockSend.mockRejectedValueOnce(s3Error("NotFound", 404));

      const result = await makeAdapter().exists("templates/node1/missing.docx");

      expect(result.error).toBeUndefined();
      expect(result.data).toBe(false);
    });

    it("returns INFRA_FAILURE when the check itself fails", async () => {
      mockSend.mockRejectedValueOnce(s3Error("AccessDenied", 403));

      const result = await makeAdapter().exists("templates/node1/template.docx");

      expect(result.error?.code).toBe("INFRA_FAILURE");
    });
  });
});
