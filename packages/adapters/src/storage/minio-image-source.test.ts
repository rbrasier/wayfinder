import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Docker Hub removed the `minio` namespace in September 2026 when the community
// edition was archived, so `minio/minio` resolves to nothing and every stack
// that names it fails at the pull — CI, local dev, and a deployer's first
// `docker compose up` alike. The images are served from quay.io instead. This
// guards the address rather than the pull: a reverted prefix, or a new service
// copied from an old block, fails here instead of in a deployer's terminal.
const DEAD_IMAGE_REFERENCE = /(^|[^.\w/])minio\/minio\b/;
const LIVE_IMAGE_REFERENCE = "quay.io/minio/minio";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

const FILES_THAT_START_MINIO = [
  "docker-compose.yml",
  "docker-compose.prod.yml",
  ".github/workflows/e2e.yml",
] as const;

const linesOf = (relativePath: string): { number: number; text: string }[] =>
  readFileSync(join(repositoryRoot, relativePath), "utf8")
    .split("\n")
    .map((text, index) => ({ number: index + 1, text }))
    .filter(({ text }) => text.includes("minio/minio"));

describe("container image sources", () => {
  it.each(FILES_THAT_START_MINIO)("%s names a MinIO image that can still be pulled", (file) => {
    const offending = linesOf(file).filter(({ text }) => DEAD_IMAGE_REFERENCE.test(text));

    expect(
      offending.map(({ number, text }) => `${file}:${number}: ${text.trim()}`),
      `Docker Hub no longer serves minio/minio — use ${LIVE_IMAGE_REFERENCE}`,
    ).toEqual([]);
  });

  it.each(FILES_THAT_START_MINIO)("%s still starts MinIO from somewhere", (file) => {
    const references = linesOf(file);

    expect(references.length).toBeGreaterThan(0);
    for (const { text } of references) {
      expect(text).toContain(LIVE_IMAGE_REFERENCE);
    }
  });
});
