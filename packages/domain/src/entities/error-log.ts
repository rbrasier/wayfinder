export type ErrorLogLevel = "debug" | "info" | "warn" | "error" | "fatal";
export type ErrorLogStatus = "active" | "dismissed" | "resolved";

export interface ErrorLog {
  readonly id: string;
  readonly level: ErrorLogLevel;
  readonly message: string;
  readonly stack: string | null;
  readonly userId: string | null;
  readonly page: string | null;
  readonly metadata: Record<string, unknown> | null;
  readonly status: ErrorLogStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface NewErrorLog {
  readonly level: ErrorLogLevel;
  readonly message: string;
  readonly stack?: string | null;
  readonly userId?: string | null;
  readonly page?: string | null;
  readonly metadata?: Record<string, unknown> | null;
}

export interface ErrorLogGroup {
  readonly message: string;
  readonly page: string | null;
  readonly count: number;
  readonly lastSeen: Date;
  readonly status: ErrorLogStatus;
}

export interface ErrorLogFilter {
  readonly status?: ErrorLogStatus;
  readonly page?: string;
  readonly level?: ErrorLogLevel;
  readonly limit?: number;
  readonly offset?: number;
}
