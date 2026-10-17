import type { IJobRepository, ILogger, Result } from "@wayfinder/domain";

// Structural abstraction over the application's ExecuteQueuedMcpCalls use-case,
// so the adapter layer depends only on @wayfinder/domain.
export interface McpCallTickRunner {
  execute(input: { limit: number }): Promise<Result<{ started: number; completion: Promise<void> }>>;
}

export const MCP_CALL_JOB_NAME = "mcp_call_worker";

// A person is watching the step wait, so the tick is short.
const DEFAULT_TICK_INTERVAL_MS = 2_000;
const DEFAULT_MAX_IN_FLIGHT = 10;

export interface McpCallWorkerOptions {
  tickIntervalMs?: number;
  maxInFlight?: number;
}

// Durable poller for queued MCP node calls (ADR-062 §3), shaped like the
// extraction worker. Calls run past the tick that started them, so the worker
// counts them against `maxInFlight` and each tick claims only the spare room —
// a slow source never blocks the next call, and the process never runs an
// unbounded number at once. Ticks themselves never overlap.
export class McpCallWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private inFlight = 0;
  private readonly completions = new Set<Promise<void>>();

  constructor(
    private readonly tickRunner: McpCallTickRunner,
    private readonly jobs: IJobRepository,
    private readonly logger: ILogger,
    private readonly options: McpCallWorkerOptions = {},
  ) {}

  private get intervalMs(): number {
    return this.options.tickIntervalMs ?? DEFAULT_TICK_INTERVAL_MS;
  }

  async start(): Promise<void> {
    await this.jobs.register(MCP_CALL_JOB_NAME);
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    await this.tick();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  // One tick, then every call it (or an earlier tick) started. For a host that
  // freezes the process between invocations — a Lambda tick — where a call left
  // running past the return would be suspended mid-request.
  async drain(): Promise<void> {
    await this.tick();
    await Promise.all([...this.completions]);
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const limit = (this.options.maxInFlight ?? DEFAULT_MAX_IN_FLIGHT) - this.inFlight;
      const result = await this.tickRunner.execute({ limit });
      if (result.error) {
        this.logger.error("MCP call tick failed.", { reason: result.error.message });
        await this.jobs.fail(MCP_CALL_JOB_NAME, result.error.message);
        return;
      }
      const { started, completion } = result.data;
      this.inFlight += started;
      const settled = completion
        .catch((cause: unknown) => {
          this.logger.error("A queued MCP call threw.", {
            reason: cause instanceof Error ? cause.message : String(cause),
          });
        })
        .finally(() => {
          this.inFlight -= started;
          this.completions.delete(settled);
        });
      this.completions.add(settled);
      await this.jobs.ping(MCP_CALL_JOB_NAME, new Date(Date.now() + this.intervalMs));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Unknown MCP call error.";
      this.logger.error("MCP call tick threw.", { reason: message });
      await this.jobs.fail(MCP_CALL_JOB_NAME, message);
    } finally {
      this.running = false;
    }
  }
}
