import {
  type BucketLocationConstraint,
  type CreateBucketCommandInput,
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { domainError, err, ok, type StorageConfig } from "@wayfinder/domain";
import type { IObjectStorage } from "@wayfinder/domain";
import type { Result } from "@wayfinder/domain";
import { RuntimeConfigStore } from "../config/runtime-config-store";
import { s3ClientOptions } from "./s3-client-options";

// Talks to any S3-compatible server — MinIO locally and in Docker, Amazon S3 on
// the Lambda target — so no storage vendor's SDK leaks into the dependency tree.
export class S3ObjectStorageAdapter implements IObjectStorage {
  private cachedClient: { client: S3Client; config: StorageConfig; version: number } | null = null;

  constructor(private readonly runtimeConfig: RuntimeConfigStore) {}

  private async resolveClient(): Promise<{ client: S3Client; config: StorageConfig }> {
    const config = await this.runtimeConfig.getStorageConfig();
    const version = this.runtimeConfig.getStorageVersion();
    if (this.cachedClient && this.cachedClient.version === version) {
      return { client: this.cachedClient.client, config: this.cachedClient.config };
    }
    const client = createS3Client(config);
    this.cachedClient = { client, config, version };
    return { client, config };
  }

  async initialise(): Promise<void> {
    const { client, config } = await this.resolveClient();
    if (await bucketExists(client, config.bucket)) return;
    await client.send(new CreateBucketCommand(createBucketInput(config)));
  }

  async put(key: string, data: Buffer, mimeType: string): Promise<Result<{ key: string }>> {
    try {
      const { client, config } = await this.resolveClient();
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          Body: data,
          ContentLength: data.length,
          ContentType: mimeType,
        }),
      );
      return ok({ key });
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", `Failed to store object at key ${key}.`, cause));
    }
  }

  async get(key: string): Promise<Result<Buffer>> {
    try {
      const { client, config } = await this.resolveClient();
      const response = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
      if (!response.Body) {
        return err(domainError("INFRA_FAILURE", `Object at key ${key} came back without a body.`));
      }
      return ok(Buffer.from(await response.Body.transformToByteArray()));
    } catch (cause) {
      if (isNotFound(cause)) {
        return err(domainError("NOT_FOUND", `Object not found at key ${key}.`, cause));
      }
      return err(domainError("INFRA_FAILURE", `Failed to retrieve object at key ${key}.`, cause));
    }
  }

  async delete(key: string): Promise<Result<void>> {
    try {
      const { client, config } = await this.resolveClient();
      await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
      return ok(undefined);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", `Failed to delete object at key ${key}.`, cause));
    }
  }

  async exists(key: string): Promise<Result<boolean>> {
    try {
      const { client, config } = await this.resolveClient();
      await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
      return ok(true);
    } catch (cause) {
      if (isNotFound(cause)) return ok(false);
      return err(domainError("INFRA_FAILURE", `Failed to check existence of object at key ${key}.`, cause));
    }
  }
}

export const createS3Client = (config: StorageConfig): S3Client => new S3Client(s3ClientOptions(config));

// HeadBucket answers 404 with no error body, so the SDK names it "NotFound";
// anything else (403, network) is a real failure and must surface.
export const bucketExists = async (client: S3Client, bucket: string): Promise<boolean> => {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    return true;
  } catch (cause) {
    if (isNotFound(cause)) return false;
    throw cause;
  }
};

// Amazon S3 rejects a create outside us-east-1 unless the region is named.
// The SDK types the constraint as a closed enum of today's regions; the region
// is operator-supplied, so newer regions must still pass through.
const createBucketInput = (config: StorageConfig): CreateBucketCommandInput =>
  config.region.length > 0 && config.region !== "us-east-1"
    ? {
        Bucket: config.bucket,
        CreateBucketConfiguration: { LocationConstraint: config.region as BucketLocationConstraint },
      }
    : { Bucket: config.bucket };

const NOT_FOUND_NAMES = new Set(["NoSuchKey", "NotFound", "NoSuchBucket"]);

const isNotFound = (cause: unknown): boolean => {
  const error = cause as { name?: string; $metadata?: { httpStatusCode?: number } };
  return NOT_FOUND_NAMES.has(error.name ?? "") || error.$metadata?.httpStatusCode === 404;
};
