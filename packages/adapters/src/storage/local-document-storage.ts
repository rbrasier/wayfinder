import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { dirname } from "node:path";
import { domainError, err, ok } from "@rbrasier/domain";
import type { IDocumentStorage } from "@rbrasier/domain";
import type { Result } from "@rbrasier/domain";

export class LocalDocumentStorage implements IDocumentStorage {
  async readBytes(storagePath: string): Promise<Result<Buffer>> {
    try {
      const bytes = await readFile(storagePath);
      return ok(bytes);
    } catch (cause) {
      return err(domainError("NOT_FOUND", `Document not found at ${storagePath}.`, cause));
    }
  }

  async writeBytes(storagePath: string, data: Buffer): Promise<Result<void>> {
    try {
      await mkdir(dirname(storagePath), { recursive: true });
      await writeFile(storagePath, data);
      return ok(undefined);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", `Failed to write document to ${storagePath}.`, cause));
    }
  }

  async exists(storagePath: string): Promise<Result<boolean>> {
    try {
      await access(storagePath);
      return ok(true);
    } catch {
      return ok(false);
    }
  }
}
