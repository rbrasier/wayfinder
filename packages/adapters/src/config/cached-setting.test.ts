import { describe, expect, it } from "vitest";
import {
  domainError,
  err,
  ok,
  type ISystemSettingsRepository,
  type Result,
  type SystemSetting,
} from "@rbrasier/domain";
import { CachedSetting } from "./cached-setting";

class CountingSettings implements ISystemSettingsRepository {
  reads = 0;
  failReads = false;
  constructor(private value: string | null) {}

  store(value: string): void {
    this.value = value;
  }

  async get(key: string): Promise<Result<SystemSetting | null>> {
    this.reads += 1;
    if (this.failReads) return err(domainError("INFRA_FAILURE", "Settings table is away."));
    if (this.value === null) return ok(null);
    const stamp = new Date("2026-09-23T09:00:00Z");
    return ok({ key, value: this.value, createdAt: stamp, updatedAt: stamp });
  }

  async set(): Promise<Result<SystemSetting>> {
    return err(domainError("INFRA_FAILURE", "Not used."));
  }

  async delete(): Promise<Result<void>> {
    return ok(undefined);
  }
}

const parseGreeting = (raw: string, fallback: string): string => {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "string" ? parsed : fallback;
  } catch {
    return fallback;
  }
};

const cachedGreeting = (settings: ISystemSettingsRepository) =>
  new CachedSetting(settings, "greeting", parseGreeting, () => "hello");

describe("CachedSetting", () => {
  it("returns the fallback when no row exists", async () => {
    expect(await cachedGreeting(new CountingSettings(null)).get()).toBe("hello");
  });

  it("parses the stored row", async () => {
    expect(await cachedGreeting(new CountingSettings('"bonjour"')).get()).toBe("bonjour");
  });

  it("reads the row once and serves later calls from memory", async () => {
    const settings = new CountingSettings('"bonjour"');
    const greeting = cachedGreeting(settings);

    await greeting.get();
    await greeting.get();

    expect(settings.reads).toBe(1);
  });

  it("shares one read between concurrent callers", async () => {
    const settings = new CountingSettings('"bonjour"');
    const greeting = cachedGreeting(settings);

    await Promise.all([greeting.get(), greeting.get(), greeting.get()]);

    expect(settings.reads).toBe(1);
  });

  it("re-reads after invalidate", async () => {
    const settings = new CountingSettings('"bonjour"');
    const greeting = cachedGreeting(settings);
    await greeting.get();
    settings.store('"hola"');

    greeting.invalidate();

    expect(await greeting.get()).toBe("hola");
  });

  it("serves the fallback on a read failure but does not cache it", async () => {
    const settings = new CountingSettings('"bonjour"');
    settings.failReads = true;
    const greeting = cachedGreeting(settings);

    expect(await greeting.get()).toBe("hello");
    settings.failReads = false;

    expect(await greeting.get()).toBe("bonjour");
  });
});
