import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The published image ran as root, so anything that compromised the web or api
// process owned the whole container. It now drops to the `node` user the base
// image ships, and /app is handed to that user because the app writes into it at
// runtime (the embeddings cache when the model is not vendored).

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const dockerfileLines = readFileSync(join(repositoryRoot, "Dockerfile"), "utf8").split("\n");

const runtimeStage = dockerfileLines.slice(
  dockerfileLines.findIndex((line) => /^FROM \S+ AS runtime\b/.test(line)),
);

describe("container user", () => {
  it("runs the runtime stage as a non-root user", () => {
    const userLines = runtimeStage.filter((line) => /^USER\s/.test(line));

    expect(userLines.at(-1)).toBe("USER node");
  });

  it("gives that user ownership of /app", () => {
    expect(runtimeStage).toContain("COPY --from=build --chown=node:node /app /app");
  });
});
