export interface ServiceStatus {
  readonly ok: boolean;
  readonly latencyMs?: number;
  readonly error?: string;
}

export interface JobsStatus extends ServiceStatus {
  readonly jobs: Array<{ name: string; status: string; lastRunAt: Date | null }>;
}

export interface AiStatus extends ServiceStatus {
  readonly provider: string;
  readonly keyConfigured: boolean;
}

export interface SystemHealth {
  readonly ok: boolean;
  readonly timestamp: string;
  readonly services: {
    readonly db: ServiceStatus;
    readonly redis: ServiceStatus;
    readonly ai: AiStatus;
    readonly jobs: JobsStatus;
  };
}
