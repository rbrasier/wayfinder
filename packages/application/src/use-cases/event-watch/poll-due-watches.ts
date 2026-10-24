import {
  domainError,
  err,
  evaluateWatchItems,
  ok,
  readJsonPath,
  watchItemsOf,
  type AutomationConfig,
  type EventWatch,
  type IEventWatchRepository,
  type IOutboundHttpClient,
  type Result,
  type WatchPausedReason,
} from "@rbrasier/domain";
import type { IUnattendedIncidentNotifier } from "../notifications/notify-unattended-incident";
import type { StartUnattendedRun } from "../automation/start-unattended-run";
import { buildWatchRequest } from "./watch-request";

export interface PollDueWatchesDependencies {
  watches: Pick<
    IEventWatchRepository,
    | "claimDue"
    | "claimNow"
    | "findById"
    | "getSecret"
    | "getItemStates"
    | "saveItemStates"
    | "markFired"
    | "recordSuccess"
    | "recordFailure"
    | "pause"
  >;
  http: IOutboundHttpClient;
  loadAutomationConfig: () => Promise<AutomationConfig>;
  startUnattendedRun: Pick<StartUnattendedRun, "execute">;
  // Starts the run driver without waiting on it.
  kick: (sessionId: string) => void;
  incidents: IUnattendedIncidentNotifier;
  newId: () => string;
  now: () => Date;
}

export interface PollDueWatchesOutput {
  polled: number;
  started: number;
  paused: number;
  failed: number;
}

// A poll can fail and pause the watch at once, so the two are counted apart.
type PollOutcome = { started: number; failed: boolean; paused: boolean; lastError: string | null };

const outcome = (
  started: number,
  flags: { failed?: boolean; paused?: boolean; lastError?: string } = {},
): PollOutcome => ({
  started,
  failed: flags.failed ?? false,
  paused: flags.paused ?? false,
  lastError: flags.lastError ?? null,
});

// What an admin's "Run now" did: checked the watch, or found a check of it
// already under way.
export type RunWatchNowOutput = ({ outcome: "checked" } & PollOutcome) | { outcome: "busy" };

const PAUSE_REASONS: Record<"run_as_unavailable" | "flow_unavailable", string> = {
  run_as_unavailable: "The person the runs belong to no longer has an account.",
  flow_unavailable: "The flow it starts is no longer published.",
};

// Polls every watch that is due (ADR-063 §5): fetch, judge, start runs, record.
// Each watch is independent — one failing never stops the others.
export class PollDueWatches {
  constructor(private readonly dependencies: PollDueWatchesDependencies) {}

  async execute(input: { limit: number }): Promise<Result<PollDueWatchesOutput>> {
    const now = this.dependencies.now();
    const due = await this.dependencies.watches.claimDue(now, input.limit);
    if (due.error) return due;
    const { watchAllowedHosts } = await this.dependencies.loadAutomationConfig();

    const summary: PollDueWatchesOutput = { polled: 0, started: 0, paused: 0, failed: 0 };
    for (const watch of due.data) {
      const result = await this.poll(watch, watchAllowedHosts);
      summary.polled += 1;
      summary.started += result.started;
      if (result.failed) summary.failed += 1;
      if (result.paused) summary.paused += 1;
    }
    return ok(summary);
  }

  // Checks one watch now rather than at its next scheduled time, by the same
  // rules as a scheduled check: the condition, one run per item and the run cap
  // all still apply.
  async runNow(watchId: string): Promise<Result<RunWatchNowOutput>> {
    const found = await this.dependencies.watches.findById(watchId);
    if (found.error) return found;
    if (!found.data) return err(domainError("NOT_FOUND", "Event watch not found."));
    if (found.data.status !== "active") {
      return err(domainError("VALIDATION_FAILED", "This watch is paused. Resume it to run it."));
    }
    const claimed = await this.dependencies.watches.claimNow(watchId, this.dependencies.now());
    if (claimed.error) return claimed;
    if (!claimed.data) return ok({ outcome: "busy" });
    const { watchAllowedHosts } = await this.dependencies.loadAutomationConfig();
    const result = await this.poll(claimed.data, watchAllowedHosts);
    return ok({ outcome: "checked", ...result });
  }

  private async poll(watch: EventWatch, allowedHosts: readonly string[]): Promise<PollOutcome> {
    const secret = watch.authType === "none" ? ok(null) : await this.dependencies.watches.getSecret(watch.id);
    if (secret.error) return this.recordFailure(watch, secret.error.message);
    const response = await this.dependencies.http.requestJson(buildWatchRequest(watch, secret.data, allowedHosts));
    if (response.error) return this.recordFailure(watch, response.error.message);
    const items = watchItemsOf(response.data.json, watch.itemsPath);
    if (items.error) return this.recordFailure(watch, items.error.message);

    const seen = evaluateWatchItems({
      condition: watch.condition,
      items: items.data,
      itemIdPath: watch.itemIdPath,
      previousStates: [],
      baseline: true,
      fireOncePerItem: watch.fireOncePerItem,
    });
    const previous = await this.dependencies.watches.getItemStates(
      watch.id,
      seen.nextStates.map((state) => state.itemId),
    );
    if (previous.error) return this.recordFailure(watch, previous.error.message);

    const evaluation = evaluateWatchItems({
      condition: watch.condition,
      items: items.data,
      itemIdPath: watch.itemIdPath,
      previousStates: previous.data,
      baseline: watch.baselinePending,
      fireOncePerItem: watch.fireOncePerItem,
    });

    // Advancing state past matches that were never run would lose them, so a
    // capped poll records nothing and leaves them for after the resume.
    if (evaluation.toFire.length > watch.maxRunsPerPoll) {
      const explanation = `${evaluation.toFire.length} items matched in one check, more than the limit of ${watch.maxRunsPerPoll}. Check the condition, then resume the watch.`;
      await this.pause(watch, "run_cap_exceeded", explanation);
      return outcome(0, { paused: true, lastError: explanation });
    }

    return this.startRuns(watch, evaluation.toFire, evaluation.nextStates);
  }

  private async startRuns(
    watch: EventWatch,
    toFire: Array<{ itemId: string; item: unknown }>,
    nextStates: Array<{ itemId: string; lastValues: Record<string, unknown> }>,
  ): Promise<PollOutcome> {
    const now = this.dependencies.now();
    const started: string[] = [];
    const notStarted = new Set<string>();
    const problems: string[] = [];

    for (const { itemId, item } of toFire) {
      const inputs = Object.fromEntries(
        Object.entries(watch.inputMapping).map(([key, path]) => [key, readJsonPath(item, path)]),
      );
      const result = await this.dependencies.startUnattendedRun.execute({
        flowId: watch.flowId,
        runAsUserId: watch.runAsUserId,
        origin: "watch",
        triggerSourceId: watch.id,
        sourceName: watch.name,
        inputs,
        raw: item,
        itemId,
      });
      if (result.error) {
        notStarted.add(itemId);
        problems.push(`Item ${itemId}: ${result.error.message}`);
        continue;
      }
      const run = result.data;
      if (run.started) {
        started.push(itemId);
        this.dependencies.kick(run.session.id);
        continue;
      }
      notStarted.add(itemId);
      if (run.reason === "invalid_inputs") {
        problems.push(`Item ${itemId}: ${run.message}`);
        continue;
      }
      await this.saveState(watch, nextStates, notStarted, started, now);
      await this.pause(watch, run.reason, PAUSE_REASONS[run.reason]);
      return outcome(started.length, { paused: true, lastError: PAUSE_REASONS[run.reason] });
    }

    await this.saveState(watch, nextStates, notStarted, started, now);
    if (problems.length > 0) {
      const failed = await this.recordFailure(watch, problems.join(" "));
      return { ...failed, started: started.length };
    }
    await this.dependencies.watches.recordSuccess(watch.id, now);
    return outcome(started.length);
  }

  // An item whose run did not start keeps its old state, so the same change is
  // seen — and fires — again on the next poll.
  private async saveState(
    watch: EventWatch,
    nextStates: Array<{ itemId: string; lastValues: Record<string, unknown> }>,
    notStarted: Set<string>,
    started: string[],
    now: Date,
  ): Promise<void> {
    await this.dependencies.watches.saveItemStates(
      watch.id,
      nextStates.filter((state) => !notStarted.has(state.itemId)),
      now,
    );
    await this.dependencies.watches.markFired(watch.id, started, now);
  }

  private async recordFailure(watch: EventWatch, message: string): Promise<PollOutcome> {
    const recorded = await this.dependencies.watches.recordFailure(watch.id, this.dependencies.now(), message);
    if (recorded.error) return outcome(0, { failed: true, lastError: message });
    if (recorded.data.consecutiveFailures < recorded.data.failureThreshold) {
      return outcome(0, { failed: true, lastError: message });
    }
    await this.pause(
      recorded.data,
      "failure_threshold",
      `The API failed ${recorded.data.consecutiveFailures} times in a row. Last error: ${message}`,
    );
    return outcome(0, { failed: true, paused: true, lastError: message });
  }

  private async pause(watch: EventWatch, reason: WatchPausedReason, explanation: string): Promise<void> {
    const incidentId = this.dependencies.newId();
    const paused = await this.dependencies.watches.pause(watch.id, reason, this.dependencies.now(), incidentId);
    if (paused.error) return;
    await this.dependencies.incidents.execute({
      kind: "watch_paused",
      watch: { id: watch.id, name: watch.name, runAsUserId: watch.runAsUserId, pauseIncidentId: incidentId },
      reason: explanation,
    });
  }
}
