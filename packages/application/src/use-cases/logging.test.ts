import { describe, it, expect } from "vitest";
import {
  type ErrorLog,
  type ErrorLogFilter,
  type ErrorLogGroup,
  type ErrorLogStatus,
  type IAuditLogger,
  type IErrorLogRepository,
  type IErrorLogger,
  type NewAuditLog,
  type NewErrorLog,
  type Result,
  domainError,
  err,
  ok,
} from "@rbrasier/domain";
import type { ErrorLogPayload } from "@rbrasier/domain";
import { LogError } from "./log-error";
import { LogAuditEvent } from "./log-audit-event";
import { ListErrors } from "./list-errors";
import { UpdateErrorStatus } from "./update-error-status";

function makeErrorLog(overrides: Partial<ErrorLog> = {}): ErrorLog {
  const now = new Date();
  return {
    id: crypto.randomUUID(),
    level: "error",
    message: "something broke",
    stack: null,
    userId: null,
    page: null,
    metadata: null,
    status: "active",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

class InMemoryErrorLogger implements IErrorLogger {
  logged: ErrorLogPayload[] = [];

  async log(payload: ErrorLogPayload): Promise<Result<true>> {
    this.logged.push(payload);
    return ok(true as const);
  }
}

class InMemoryAuditLogger implements IAuditLogger {
  logged: NewAuditLog[] = [];

  async log(payload: NewAuditLog): Promise<Result<true>> {
    this.logged.push(payload);
    return ok(true as const);
  }
}

class InMemoryErrorLogRepo implements IErrorLogRepository {
  private logs = new Map<string, ErrorLog>();

  seed(overrides: Partial<ErrorLog> = {}): ErrorLog {
    const log = makeErrorLog(overrides);
    this.logs.set(log.id, log);
    return log;
  }

  async create(input: NewErrorLog): Promise<Result<ErrorLog>> {
    const log = makeErrorLog({ ...input });
    this.logs.set(log.id, log);
    return ok(log);
  }

  async list(_filter?: ErrorLogFilter): Promise<Result<ErrorLog[]>> {
    return ok([...this.logs.values()]);
  }

  async listGrouped(_filter?: ErrorLogFilter): Promise<Result<ErrorLogGroup[]>> {
    const groups = new Map<string, ErrorLogGroup>();
    for (const log of this.logs.values()) {
      const existing = groups.get(log.message);
      if (existing) {
        groups.set(log.message, { ...existing, count: existing.count + 1 });
      } else {
        groups.set(log.message, {
          message: log.message,
          page: log.page,
          count: 1,
          lastSeen: log.createdAt,
          status: log.status,
        });
      }
    }
    return ok([...groups.values()]);
  }

  async listByGroup(message: string, _page: string | null): Promise<Result<ErrorLog[]>> {
    return ok([...this.logs.values()].filter((l) => l.message === message));
  }

  async updateStatus(id: string, status: ErrorLogStatus): Promise<Result<ErrorLog>> {
    const log = this.logs.get(id);
    if (!log) return err(domainError("NOT_FOUND", `Error log ${id} not found.`));
    const updated = { ...log, status, updatedAt: new Date() };
    this.logs.set(id, updated);
    return ok(updated);
  }

  async updateGroupStatus(
    message: string,
    _page: string | null,
    status: ErrorLogStatus,
  ): Promise<Result<number>> {
    let count = 0;
    for (const [id, log] of this.logs.entries()) {
      if (log.message === message) {
        this.logs.set(id, { ...log, status, updatedAt: new Date() });
        count++;
      }
    }
    return ok(count);
  }
}

describe("LogError", () => {
  it("delegates logging to the error logger port", async () => {
    const logger = new InMemoryErrorLogger();
    const sut = new LogError(logger);

    const result = await sut.execute({ level: "error", message: "boom" });

    expect(result.error).toBeUndefined();
    expect(result.data).toBe(true);
    expect(logger.logged[0]?.message).toBe("boom");
  });
});

describe("LogAuditEvent", () => {
  it("delegates to the audit logger port", async () => {
    const logger = new InMemoryAuditLogger();
    const sut = new LogAuditEvent(logger);

    const result = await sut.execute({
      action: "user.create",
      resourceType: "user",
      resourceId: "u1",
    });

    expect(result.error).toBeUndefined();
    expect(result.data).toBe(true);
    expect(logger.logged[0]?.action).toBe("user.create");
  });
});

describe("ListErrors", () => {
  it("returns grouped errors", async () => {
    const repo = new InMemoryErrorLogRepo();
    repo.seed({ message: "db timeout" });
    repo.seed({ message: "db timeout" });
    const sut = new ListErrors(repo);

    const result = await sut.listGrouped();

    expect(result.error).toBeUndefined();
    expect(result.data).toHaveLength(1);
    expect(result.data?.[0]?.count).toBe(2);
  });

  it("returns errors within a group", async () => {
    const repo = new InMemoryErrorLogRepo();
    repo.seed({ message: "db timeout" });
    const sut = new ListErrors(repo);

    const result = await sut.listInGroup("db timeout", null);

    expect(result.error).toBeUndefined();
    expect(result.data).toHaveLength(1);
  });
});

describe("UpdateErrorStatus", () => {
  it("updates the status of an individual error log", async () => {
    const repo = new InMemoryErrorLogRepo();
    const log = repo.seed({ status: "active" });
    const sut = new UpdateErrorStatus(repo);

    const result = await sut.byId(log.id, "resolved");

    expect(result.error).toBeUndefined();
    expect(result.data?.status).toBe("resolved");
  });

  it("updates status of all logs in a group", async () => {
    const repo = new InMemoryErrorLogRepo();
    repo.seed({ message: "network error", status: "active" });
    repo.seed({ message: "network error", status: "active" });
    const sut = new UpdateErrorStatus(repo);

    const result = await sut.byGroup("network error", null, "dismissed");

    expect(result.error).toBeUndefined();
    expect(result.data).toBe(2);
  });

  it("returns VALIDATION_FAILED when message is empty for group update", async () => {
    const sut = new UpdateErrorStatus(new InMemoryErrorLogRepo());

    const result = await sut.byGroup("", null, "dismissed");

    expect(result.data).toBeUndefined();
    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });
});
