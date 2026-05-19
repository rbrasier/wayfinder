import { Readable } from "node:stream";
import { Client } from "minio";
import { domainError, err, ok } from "@rbrasier/domain";
import type { IObjectStorage } from "@rbrasier/domain";
import type { Result } from "@rbrasier/domain";

export interface MinioStorageConfig {
  endPoint: string;
  port: number;
  useSSL: boolean;
  accessKey: string;
  secretKey: string;
  bucket: string;
  pathStyle?: boolean;
}

export class MinioStorageAdapter implements IObjectStorage {
  private readonly client: Client;
  private readonly bucket: string;

  constructor(config: MinioStorageConfig) {
    this.client = new Client({
      endPoint: config.endPoint,
      port: config.port,
      useSSL: config.useSSL,
      accessKey: config.accessKey,
      secretKey: config.secretKey,
      pathStyle: config.pathStyle ?? true,
    });
    this.bucket = config.bucket;
  }

  async initialise(): Promise<void> {
    const exists = await this.client.bucketExists(this.bucket);
    if (!exists) {
      await this.client.makeBucket(this.bucket);
    }
  }

  async put(key: string, data: Buffer, mimeType: string): Promise<Result<{ key: string }>> {
    try {
      await this.client.putObject(this.bucket, key, data, data.length, {
        "Content-Type": mimeType,
      });
      return ok({ key });
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", `Failed to store object at key ${key}.`, cause));
    }
  }

  async get(key: string): Promise<Result<Buffer>> {
    try {
      const stream = await this.client.getObject(this.bucket, key);
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
      await this.client.removeObject(this.bucket, key);
      return ok(undefined);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", `Failed to delete object at key ${key}.`, cause));
    }
  }

  async exists(key: string): Promise<Result<boolean>> {
    try {
      await this.client.statObject(this.bucket, key);
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

function streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}
