import type { Result } from "../result";

export interface IObjectStorage {
  put(key: string, data: Buffer, mimeType: string): Promise<Result<{ key: string }>>;
  get(key: string): Promise<Result<Buffer>>;
  delete(key: string): Promise<Result<void>>;
  exists(key: string): Promise<Result<boolean>>;
  initialise(): Promise<void>;
}
