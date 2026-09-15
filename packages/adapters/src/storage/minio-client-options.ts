import type { StorageConfig } from "@wayfinder/domain";

export interface MinioClientOptions {
  endPoint: string;
  port: number;
  useSSL: boolean;
  accessKey: string;
  secretKey: string;
  pathStyle: boolean;
  region?: string;
}

// Shared by the document-storage adapter and the connectivity probe so the two
// cannot drift — they previously both hardcoded `pathStyle: true`, which is
// right for MinIO and wrong for Amazon S3.
export const minioClientOptions = (config: StorageConfig): MinioClientOptions => ({
  endPoint: config.endpoint,
  port: config.port,
  useSSL: config.useSSL,
  accessKey: config.accessKey,
  secretKey: config.secretKey,
  pathStyle: config.pathStyle,
  // Omitted rather than sent empty: the client signs with whatever region it is
  // given, so an empty string would break requests that would otherwise work
  // through its own per-bucket discovery.
  ...(config.region.length > 0 ? { region: config.region } : {}),
});
