import type {
  EventWatch,
  WatchApiKeyPlacement,
  WatchAuthType,
  WatchCondition,
  WatchHttpMethod,
  WatchInputMapping,
  WatchItemState,
  WatchPausedReason,
} from "../entities/event-watch";
import type { Result } from "../result";

export interface NewEventWatch {
  name: string;
  url: string;
  method: WatchHttpMethod;
  requestBody: unknown;
  authType: WatchAuthType;
  apiKeyPlacement: WatchApiKeyPlacement | null;
  intervalMinutes: number;
  itemsPath: string;
  itemIdPath: string;
  condition: WatchCondition;
  fireOncePerItem: boolean;
  maxRunsPerPoll: number;
  failureThreshold: number;
  flowId: string;
  inputMapping: WatchInputMapping;
  runAsUserId: string;
  createdBy: string;
}

export type EventWatchUpdate = Partial<Omit<NewEventWatch, "createdBy">> & { baselinePending?: boolean };

// `undefined` keeps the stored secret, `null` clears it, a string replaces it.
// The repository encrypts it; only `getSecret` ever returns it, for the poller.
export type SecretChange = string | null | undefined;

export interface IEventWatchRepository {
  list(): Promise<Result<EventWatch[]>>;
  findById(id: string): Promise<Result<EventWatch | null>>;
  create(input: NewEventWatch, secret: SecretChange): Promise<Result<EventWatch>>;
  update(id: string, patch: EventWatchUpdate, secret: SecretChange): Promise<Result<EventWatch>>;
  delete(id: string): Promise<Result<void>>;
  getSecret(id: string): Promise<Result<string | null>>;
  // Atomically takes the active watches due at `now` and moves each one's next
  // poll forward by its interval, so a second poller never takes the same one.
  claimDue(now: Date, limit: number): Promise<Result<EventWatch[]>>;
  recordSuccess(id: string, at: Date): Promise<Result<void>>;
  // Returns the watch with its failure count already incremented.
  recordFailure(id: string, at: Date, message: string): Promise<Result<EventWatch>>;
  pause(id: string, reason: WatchPausedReason, at: Date, incidentId: string): Promise<Result<EventWatch>>;
  resume(id: string, at: Date): Promise<Result<EventWatch>>;
  getItemStates(watchId: string, itemIds: string[]): Promise<Result<WatchItemState[]>>;
  saveItemStates(
    watchId: string,
    states: Array<{ itemId: string; lastValues: Record<string, unknown> }>,
    seenAt: Date,
  ): Promise<Result<void>>;
  markFired(watchId: string, itemIds: string[], at: Date): Promise<Result<void>>;
}
