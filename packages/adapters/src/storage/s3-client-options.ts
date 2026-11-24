import type { S3ClientConfig } from "@aws-sdk/client-s3";
import type { StorageConfig } from "@wayfinder/domain";

// The SDK refuses to sign without a region. MinIO and most S3-compatible servers
// accept us-east-1, and redirect-following lets Amazon S3 correct it per bucket.
const FALLBACK_REGION = "us-east-1";

// Shared by the object-storage adapter and the connectivity probe so the two
// cannot drift on addressing style or region handling.
export const s3ClientOptions = (config: StorageConfig): S3ClientConfig => ({
  endpoint: `${config.useSSL ? "https" : "http"}://${config.endpoint}:${config.port}`,
  region: config.region.length > 0 ? config.region : FALLBACK_REGION,
  followRegionRedirects: config.region.length === 0,
  forcePathStyle: config.pathStyle,
  credentials: { accessKeyId: config.accessKey, secretAccessKey: config.secretKey },
});
