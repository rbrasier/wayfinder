import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// CI serves the app with `next dev`, which compiles each route on its first
// request; the /flows/[id]/config canvas has taken 61s. The e2e workflow warms
// the routes in e2e/warm-routes.txt before Playwright starts, so no spec pays
// that compile inside a short wait. A renamed route would still answer — with a
// 404 — and silently warm nothing, so the list is checked against src/app here
// rather than discovered in a red CI shard.

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const appDirectory = join(webRoot, "src", "app");
const repositoryRoot = join(webRoot, "..", "..");

// Stands in for any dynamic segment; warm-routes.sh substitutes a fixed UUID.
const DYNAMIC_PLACEHOLDER = ":id";

interface WarmRoute {
  method: string;
  path: string;
}

const readWarmRoutes = (): WarmRoute[] =>
  readFileSync(join(webRoot, "e2e", "warm-routes.txt"), "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => {
      const [method = "", path = ""] = line.split(/\s+/);
      return { method, path };
    });

const childDirectories = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

// Route groups such as (user) add a directory without adding a URL segment.
const expandRouteGroups = (directory: string): string[] => [
  directory,
  ...childDirectories(directory)
    .filter((name) => name.startsWith("("))
    .flatMap((name) => expandRouteGroups(join(directory, name))),
];

const matchesSegment = (directoryName: string, segment: string): boolean => {
  if (segment === DYNAMIC_PLACEHOLDER) return /^\[[^.\]]+\]$/.test(directoryName);
  return directoryName === segment;
};

const resolveRouteDirectories = (path: string): string[] =>
  path
    .split("/")
    .filter(Boolean)
    .reduce<string[]>(
      (candidates, segment) =>
        candidates
          .flatMap(expandRouteGroups)
          .flatMap((directory) =>
            childDirectories(directory)
              .filter((name) => matchesSegment(name, segment))
              .map((name) => join(directory, name)),
          ),
      [appDirectory],
    );

// Next accepts a handler exported either way, and both are in use here: a route
// that resolves its principal through withPrincipal (ADR-060 §3a) exports the
// wrapped arrow function as a const.
const handlesRequest = (directory: string, method: string): boolean => {
  if (method === "GET" && existsSync(join(directory, "page.tsx"))) return true;
  const routeFile = join(directory, "route.ts");
  if (!existsSync(routeFile)) return false;
  const exportsHandler = new RegExp(`export\\s+(?:async\\s+function|const)\\s+${method}\\b`);
  return exportsHandler.test(readFileSync(routeFile, "utf8"));
};

describe("e2e route warm-up", () => {
  const warmRoutes = readWarmRoutes();

  it("lists at least the flow canvas, whose compile outlasts every spec timeout", () => {
    expect(warmRoutes).toContainEqual({ method: "GET", path: "/flows/:id/config" });
  });

  it.each(warmRoutes.map((route) => [`${route.method} ${route.path}`, route] as const))(
    "%s resolves to a page or route handler under src/app",
    (_label, route) => {
      const handlers = resolveRouteDirectories(route.path).filter((directory) =>
        handlesRequest(directory, route.method),
      );
      expect(handlers, `${route.method} ${route.path} matches no page.tsx or route.ts export`).not.toEqual([]);
    },
  );

  it("runs before the Playwright tests in the e2e workflow", () => {
    const workflow = readFileSync(join(repositoryRoot, ".github", "workflows", "e2e.yml"), "utf8");
    const warmUp = workflow.indexOf("./warm-routes.sh");
    const firstTestRun = workflow.indexOf("npx playwright test --config=playwright.config.ts --project=chromium");
    expect(warmUp, "the e2e workflow never runs warm-routes.sh").toBeGreaterThan(-1);
    expect(warmUp).toBeLessThan(firstTestRun);
  });
});
