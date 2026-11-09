import { describe, expect, it } from "vitest";
import { EngineSupervisor, type EngineProcess, type SupervisorOptions } from "./engine-supervisor";

class FakeProcess implements EngineProcess {
  killed = false;
  private exitListeners: Array<(code: number | null) => void> = [];
  kill(): void {
    this.killed = true;
    this.exit(null);
  }
  onExit(listener: (code: number | null) => void): void {
    this.exitListeners.push(listener);
  }
  exit(code: number | null): void {
    for (const listener of this.exitListeners) listener(code);
  }
}

// A controllable world: the clock only moves when a test moves it, health
// answers what the test says, and timers fire only when told to.
const world = (overrides: Partial<SupervisorOptions> = {}) => {
  let clock = 0;
  let healthy = true;
  const spawned: Array<{ port: number; process: FakeProcess }> = [];
  const timers = new Map<number, () => void>();
  let nextTimer = 1;
  const options: SupervisorOptions = {
    isInstalled: () => true,
    spawn: (port) => {
      const process = new FakeProcess();
      spawned.push({ port, process });
      return process;
    },
    freePort: async () => 40_000 + spawned.length,
    isHealthy: async () => healthy,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    setTimer: (callback) => {
      const id = nextTimer++;
      timers.set(id, callback);
      return id;
    },
    clearTimer: (id) => {
      timers.delete(id as number);
    },
    startTimeoutMs: 1_000,
    pollIntervalMs: 100,
    idleStopMs: 30 * 60_000,
    maxFailures: 3,
    failureWindowMs: 5 * 60_000,
    ...overrides,
  };
  return {
    supervisor: new EngineSupervisor(options),
    spawned,
    setHealthy: (value: boolean) => {
      healthy = value;
    },
    advance: (ms: number) => {
      clock += ms;
    },
    fireTimers: () => {
      const pending = [...timers.values()];
      timers.clear();
      for (const callback of pending) callback();
    },
  };
};

describe("EngineSupervisor", () => {
  it("starts nothing until something asks for the engine", () => {
    const { supervisor, spawned } = world();

    expect(supervisor.status()).toBe("idle");
    expect(spawned).toEqual([]);
  });

  it("starts the engine on a loopback port on first use and returns its address", async () => {
    const { supervisor, spawned } = world();

    const result = await supervisor.ensureRunning();

    expect(result.data).toBe("http://127.0.0.1:40000");
    expect(spawned).toHaveLength(1);
    expect(supervisor.status()).toBe("running");
  });

  it("starts only one engine when several requests arrive at once", async () => {
    const { supervisor, spawned } = world();

    const results = await Promise.all([supervisor.ensureRunning(), supervisor.ensureRunning(), supervisor.ensureRunning()]);

    expect(spawned).toHaveLength(1);
    expect(new Set(results.map((result) => result.data))).toEqual(new Set(["http://127.0.0.1:40000"]));
  });

  it("reuses a running engine", async () => {
    const { supervisor, spawned } = world();
    await supervisor.ensureRunning();

    await supervisor.ensureRunning();

    expect(spawned).toHaveLength(1);
  });

  it("fails closed and kills the process when the engine never becomes healthy", async () => {
    const { supervisor, spawned, setHealthy } = world();
    setHealthy(false);

    const result = await supervisor.ensureRunning();

    expect(result.error?.code).toBe("INFRA_FAILURE");
    expect(spawned[0]!.process.killed).toBe(true);
    expect(supervisor.status()).toBe("idle");
  });

  it("restarts the engine on the next request after it crashes", async () => {
    const { supervisor, spawned } = world();
    await supervisor.ensureRunning();

    spawned[0]!.process.exit(1);
    const result = await supervisor.ensureRunning();

    expect(spawned).toHaveLength(2);
    expect(result.data).toBe("http://127.0.0.1:40001");
  });

  it("gives up after three failed starts inside the window, then tries again once it passes", async () => {
    const { supervisor, spawned, setHealthy, advance } = world();
    setHealthy(false);
    await supervisor.ensureRunning();
    await supervisor.ensureRunning();
    await supervisor.ensureRunning();

    const refused = await supervisor.ensureRunning();

    expect(refused.error?.code).toBe("INFRA_FAILURE");
    expect(spawned).toHaveLength(3);
    expect(supervisor.status()).toBe("unavailable");

    setHealthy(true);
    advance(5 * 60_000);
    const recovered = await supervisor.ensureRunning();

    expect(recovered.error).toBeUndefined();
    expect(supervisor.status()).toBe("running");
  });

  it("stops the engine once it has been idle for the idle period", async () => {
    const { supervisor, spawned, fireTimers } = world();
    await supervisor.ensureRunning();

    fireTimers();

    expect(spawned[0]!.process.killed).toBe(true);
    expect(supervisor.status()).toBe("idle");
  });

  it("reports unavailable without starting anything when this image has no engine", async () => {
    const { supervisor, spawned } = world({ isInstalled: () => false });

    const result = await supervisor.ensureRunning();

    expect(supervisor.status()).toBe("unavailable");
    expect(result.error?.message).toContain("doesn't include the built-in engine");
    expect(spawned).toEqual([]);
  });

  it("stops a running engine on shutdown", async () => {
    const { supervisor, spawned } = world();
    await supervisor.ensureRunning();

    supervisor.stop();

    expect(spawned[0]!.process.killed).toBe(true);
    expect(supervisor.status()).toBe("idle");
  });
});
