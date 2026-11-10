import { domainError, err, ok, type BuiltInEngineStatus, type Result } from "@wayfinder/domain";

export const NOT_INCLUDED_MESSAGE =
  "This image doesn't include the built-in engine — use the default image or set an external URL.";

export interface EngineProcess {
  kill(): void;
  onExit(listener: (code: number | null) => void): void;
}

export interface SupervisorOptions {
  isInstalled: () => boolean;
  spawn: (port: number) => EngineProcess;
  freePort: () => Promise<number>;
  isHealthy: (baseUrl: string) => Promise<boolean>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  setTimer: (callback: () => void, ms: number) => unknown;
  clearTimer: (timer: unknown) => void;
  startTimeoutMs: number;
  pollIntervalMs: number;
  idleStopMs: number;
  maxFailures: number;
  failureWindowMs: number;
}

interface Running {
  process: EngineProcess;
  baseUrl: string;
}

// Runs the built-in signature engine as a child process of the web server
// (ADR-069 §1). Nothing starts until a request needs it, so an install that
// never signs pays nothing; it stops again after a quiet spell to give the
// memory back. A crash is restarted on the next request, but an engine that
// keeps failing is left down and every request fails closed, exactly as an
// unreachable external engine would (ADR-067 §6).
export class EngineSupervisor {
  private running: Running | null = null;
  private starting: Promise<Result<string>> | null = null;
  private failureTimes: number[] = [];
  private idleTimer: unknown = null;
  private requestsInFlight = 0;
  // Bumped by stop(), so a start still waiting on its health check knows it
  // was cancelled.
  private stopCount = 0;

  constructor(private readonly options: SupervisorOptions) {}

  status(): BuiltInEngineStatus {
    if (!this.options.isInstalled() || this.hasGivenUp()) return "unavailable";
    return this.running ? "running" : "idle";
  }

  async ensureRunning(): Promise<Result<string>> {
    if (!this.options.isInstalled()) return err(domainError("INFRA_FAILURE", NOT_INCLUDED_MESSAGE));
    if (this.running) {
      this.scheduleIdleStop();
      return ok(this.running.baseUrl);
    }
    if (this.hasGivenUp()) {
      return err(domainError("INFRA_FAILURE", "The built-in signature engine keeps failing to start."));
    }
    // Every caller during a start waits on the same attempt, so a burst of
    // first requests starts one JVM, not several.
    this.starting ??= this.start().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  // Runs one request against the engine. The idle stop is held off until the
  // last request finishes: a signing can outlast the idle period's final
  // seconds, and stopping the JVM under it would fail the approver's signing.
  async withEngine<T>(work: (baseUrl: string) => Promise<Result<T>>): Promise<Result<T>> {
    this.requestsInFlight += 1;
    try {
      const started = await this.ensureRunning();
      if (started.error) return started;
      return await work(started.data);
    } finally {
      this.requestsInFlight -= 1;
      if (this.running) this.scheduleIdleStop();
    }
  }

  stop(): void {
    this.stopCount += 1;
    this.clearIdleStop();
    const running = this.running;
    this.running = null;
    running?.process.kill();
  }

  private async start(): Promise<Result<string>> {
    const stopCountAtStart = this.stopCount;
    const port = await this.options.freePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    let exited = false;
    const process = this.options.spawn(port);
    process.onExit(() => {
      exited = true;
      if (this.running?.process !== process) return;
      // Still registered as running, so nothing here stopped it: it crashed.
      // Counted like a failed start, so a crash loop gives up too.
      this.running = null;
      this.clearIdleStop();
      this.failureTimes.push(this.options.now());
    });

    const deadline = this.options.now() + this.options.startTimeoutMs;
    while (!exited && this.options.now() < deadline) {
      const healthy = await this.options.isHealthy(baseUrl);
      if (this.stopCount !== stopCountAtStart) {
        process.kill();
        return err(domainError("INFRA_FAILURE", "The built-in signature engine was stopped while starting."));
      }
      if (healthy) {
        this.running = { process, baseUrl };
        this.scheduleIdleStop();
        return ok(baseUrl);
      }
      await this.options.sleep(this.options.pollIntervalMs);
    }

    process.kill();
    this.failureTimes.push(this.options.now());
    return err(domainError("INFRA_FAILURE", "The built-in signature engine did not start."));
  }

  private hasGivenUp(): boolean {
    const windowStart = this.options.now() - this.options.failureWindowMs;
    this.failureTimes = this.failureTimes.filter((time) => time > windowStart);
    return this.failureTimes.length >= this.options.maxFailures;
  }

  private scheduleIdleStop(): void {
    this.clearIdleStop();
    if (this.requestsInFlight > 0) return;
    this.idleTimer = this.options.setTimer(() => this.stop(), this.options.idleStopMs);
  }

  private clearIdleStop(): void {
    if (this.idleTimer === null) return;
    this.options.clearTimer(this.idleTimer);
    this.idleTimer = null;
  }
}
