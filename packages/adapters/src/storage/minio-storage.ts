import { Readable } from "node:stream";
import { Client } from "minio";
import { domainError, err, ok, type StorageConfig } from "@rbrasier/domain";
import type { IObjectStorage } from "@rbrasier/domain";
import type { Result } from "@rbrasier/domain";
import { RuntimeConfigStore } from "../config/runtime-config-store";

export class MinioStorageAdapter implements IObjectStorage {
  private cachedClient: { client: Client; bucket: string; version: number } | null = null;

  constructor(private readonly runtimeConfig: RuntimeConfigStore) {}

  private async resolveClient(): Promise<{ client: Client; bucket: string }> {
    const config = await this.runtimeConfig.getStorageConfig();
    const version = this.runtimeConfig.getStorageVersion();
    if (this.cachedClient && this.cachedClient.version === version) {
      return { client: this.cachedClient.client, bucket: this.cachedClient.bucket };
    }
    const client = buildClient(config);
    this.cachedClient = { client, bucket: config.bucket, version };
    return { client, bucket: config.bucket };
  }

  async initialise(): Promise<void> {
    const { client, bucket } = await this.resolveClient();
    const exists = await client.bucketExists(bucket);
    if (!exists) {
      await client.makeBucket(bucket);
    }
  }

  async put(key: string, data: Buffer, mimeType: string): Promise<Result<{ key: string }>> {
    try {
      const { client, bucket } = await this.resolveClient();
      await client.putObject(bucket, key, data, data.length, {
        "Content-Type": mimeType,
      });
      return ok({ key });
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", `Failed to store object at key ${key}.`, cause));
    }
  }

  async get(key: string): Promise<Result<Buffer>> {
    try {
      const { client, bucket } = await this.resolveClient();
      const stream = await client.getObject(bucket, key);
      const buffer = await streamToBuffer(stream);
      return ok(buffer);
    } catch (cause) {
      const error = cause as { code?: string };
      if (error.code === "NoSuchKey" || error.code === "NotFound") {
        return err(domainError("NOT_FOUND", `Object not found at key ${key}.`, cause));
      }
      return err(domainError("INFRA_FAILURE", `Failed to retrieve object at key ${key}.`, cause));
    }
  }

  async delete(key: string): Promise<Result<void>> {
    try {
      const { client, bucket } = await this.resolveClient();
      await client.removeObject(bucket, key);
      return ok(undefined);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", `Failed to delete object at key ${key}.`, cause));
    }
  }

  async exists(key: string): Promise<Result<boolean>> {
    try {
      const { client, bucket } = await this.resolveClient();
      await client.statObject(bucket, key);
      return ok(true);
    } catch (cause) {
      const error = cause as { code?: string };
      if (error.code === "NotFound" || error.code === "NoSuchKey") {
        return ok(false);
      }
      return err(domainError("INFRA_FAILURE", `Failed to check existence of object at key ${key}.`, cause));
    }
  }
}

const buildClient = (config: StorageConfig): Client =>
  new Client({
    endPoint: config.endpoint,
    port: config.port,
    useSSL: config.useSSL,
    accessKey: config.accessKey,
    secretKey: config.secretKey,
    pathStyle: true,
  });

function streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}
