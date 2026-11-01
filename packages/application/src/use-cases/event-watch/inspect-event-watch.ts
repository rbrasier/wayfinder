import {
  ok,
  previewWatchItems,
  watchItemsOf,
  type AutomationConfig,
  type IAuditLogger,
  type IEventWatchRepository,
  type IOutboundHttpClient,
  type Result,
  type SecretChange,
  type WatchCondition,
} from "@wayfinder/domain";
import { EVENT_WATCH_RESOURCE_TYPE } from "./save-event-watch";
import { buildWatchRequest, truncateSample, type WatchConnection } from "./watch-request";

export interface TestEventWatchDependencies {
  watches: Pick<IEventWatchRepository, "getSecret">;
  http: IOutboundHttpClient;
  loadAutomationConfig: () => Promise<AutomationConfig>;
  auditLogger: IAuditLogger;
}

export interface TestEventWatchInput {
  // Set when editing a saved watch, so its stored secret can be used.
  watchId?: string;
  connection: WatchConnection;
  // As typed in the editor; undefined uses the saved watch's secret.
  secret: SecretChange;
  actorId: string;
}

export interface EventWatchSample {
  status: number;
  sample: unknown;
  truncated: boolean;
}

const hostOf = (url: string): string | null => {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
};

// The editor's Test button (ADR-063 §2): one real request, made exactly as a
// poll would make it, returning a sample to pick paths from.
export class TestEventWatch {
  constructor(private readonly dependencies: TestEventWatchDependencies) {}

  async execute(input: TestEventWatchInput): Promise<Result<EventWatchSample>> {
    const secret = await this.secretFor(input);
    if (secret.error) return secret;
    const { watchAllowedHosts } = await this.dependencies.loadAutomationConfig();
    const response = await this.dependencies.http.requestJson(
      buildWatchRequest(input.connection, secret.data, watchAllowedHosts),
    );

    await this.dependencies.auditLogger.log({
      actorId: input.actorId,
      action: "event_watch.tested",
      resourceType: EVENT_WATCH_RESOURCE_TYPE,
      resourceId: input.watchId ?? null,
      metadata: { host: hostOf(input.connection.url), succeeded: !response.error },
    });
    if (response.error) return response;
    return ok({ status: response.data.status, ...truncateSample(response.data.json) });
  }

  private async secretFor(input: TestEventWatchInput): Promise<Result<string | null>> {
    if (input.connection.authType === "none") return ok(null);
    if (typeof input.secret === "string" && input.secret.trim() !== "") return ok(input.secret);
    if (input.secret === undefined && input.watchId) return this.dependencies.watches.getSecret(input.watchId);
    return ok(null);
  }
}

export interface PreviewEventWatchInput {
  sample: unknown;
  itemsPath: string;
  itemIdPath: string;
  condition: WatchCondition;
}

// The editor's "would fire now" preview over the last sample.
export class PreviewEventWatch {
  execute(input: PreviewEventWatchInput): Result<{ itemCount: number; wouldFire: string[]; skippedWithoutId: number }> {
    const items = watchItemsOf(input.sample, input.itemsPath);
    if (items.error) return items;
    const preview = previewWatchItems({ condition: input.condition, items: items.data, itemIdPath: input.itemIdPath });
    return ok({
      itemCount: items.data.length,
      wouldFire: preview.wouldFire.map((fired) => fired.itemId),
      skippedWithoutId: preview.skippedWithoutId,
    });
  }
}
