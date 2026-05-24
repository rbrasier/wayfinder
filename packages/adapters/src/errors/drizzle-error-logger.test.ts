import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { err, ok, type ErrorLogPayload, type IErrorLogRepository } from "@rbrasier/domain";
import { DrizzleErrorLogger } from "./drizzle-error-logger";

const createRepo = (
  createImpl: IErrorLogRepository["create"],
): IErrorLogRepository => ({
  create: createImpl,
  list: vi.fn(),
  listGrouped: vi.fn(),
  listByGroup: vi.fn(),
  updateStatus: vi.fn(),
  updateGroupStatus: vi.fn(),
  deleteAll: vi.fn(),
});

describe("DrizzleErrorLogger", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  const basePayload: ErrorLogPayload = {
    level: "error",
    message: "Failed to create flow.",
    stack: "Error: column \"expert_role\" does not exist\n    at ...",
    page: "trpc:mutation:flow.create",
    metadata: { code: "INTERNAL_SERVER_ERROR" },
  };

  it("mirrors every error-level log to console.error even when persistence succeeds", async () => {
    const repo = createRepo(vi.fn().mockResolvedValue(ok({ id: "log-1" })));
    const logger = new DrizzleErrorLogger(repo);

    await logger.log(basePayload);

    expect(consoleErrorSpy).toHaveBeenCalled();
    const firstCallArgs = consoleErrorSpy.mock.calls[0]?.join(" ") ?? "";
    expect(firstCallArgs).toContain("Failed to create flow.");
    expect(firstCallArgs).toContain("trpc:mutation:flow.create");
  });

  it("mirrors fatal-level logs to console.error with stack and metadata", async () => {
    const repo = createRepo(vi.fn().mockResolvedValue(ok({ id: "log-2" })));
    const logger = new DrizzleErrorLogger(repo);

    await logger.log({ ...basePayload, level: "fatal" });

    const combined = consoleErrorSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(combined).toContain("Failed to create flow.");
    expect(combined).toContain("column \"expert_role\" does not exist");
    expect(combined).toContain("INTERNAL_SERVER_ERROR");
  });

  it("mirrors warn-level logs to console.warn", async () => {
    const repo = createRepo(vi.fn().mockResolvedValue(ok({ id: "log-3" })));
    const logger = new DrizzleErrorLogger(repo);

    await logger.log({ ...basePayload, level: "warn", message: "slow query" });

    expect(consoleWarnSpy).toHaveBeenCalled();
    const combined = consoleWarnSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(combined).toContain("slow query");
  });

  it("mirrors to console even when DB persistence fails", async () => {
    const repo = createRepo(
      vi.fn().mockResolvedValue(err({ code: "INFRA_FAILURE", message: "db down" })),
    );
    const logger = new DrizzleErrorLogger(repo);

    await logger.log(basePayload);

    const combined = consoleErrorSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(combined).toContain("Failed to create flow.");
  });
});
