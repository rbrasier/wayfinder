import type { Result } from "../result";

export interface IDocumentStorage {
  readBytes(storagePath: string): Promise<Result<Buffer>>;
  writeBytes(storagePath: string, data: Buffer): Promise<Result<void>>;
  exists(storagePath: string): Promise<Result<boolean>>;
}
