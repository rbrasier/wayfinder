import { describe, expect, it } from "vitest";
import {
  domainError,
  err,
  ok,
  type EventWatch,
  type OutboundJsonRequest,
  type Result,
  type Session,
  type WatchItemState,
  type WatchPausedReason,
} from "@rbrasier/domain";
import type { UnattendedIncident } from "../notifications/notify-unattended-incident";
import { PollDueWatches } from "./poll-due-watches";
import type { StartUnattendedRunInput, StartUnattendedRunOutput } from "../automation/start-unattended-run";

const watch = (overrides: Partial<EventWatch> = {}): EventWatch => ({
  id: "watch-1",
  name: "Estimates hearings",
  url: "https://api.example.gov.au/hearings",
  method: "GET",
  requestBody: null,
  authType: "bearer",
  apiKeyPlacement: null,
  hasSecret: true,
  intervalMinutes: 2,
  itemsPath: "hearings",
  itemIdPath: "id",
  condition: { kind: "transition", fieldPath: "status", from: "live", to: "finished" },
  fireOncePerItem: true,
  maxRunsPerPoll: 20,
  flowId: "flow-1",
  inputMapping: { hearing_id: "id", committee: "committee.name" },
  runAsUserId: "owner-1",
  status: "active",
  baselinePending: false,
  consecutiveFailures: 0,
  failureThreshold: 5,
  lastError: null,
  pausedReason: null,
  pausedAt: null,
  pauseIncidentId: null,
  lastPolledAt: null,
  lastSuccessAt: null,
  nextPollAt: null,
  createdBy: "owner-1",
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...overrides,
});

class InMemoryWatches {
  states = new Map<string, WatchItemState>();
  paused: Array<{ reason: WatchPausedReason; incidentId: string }> = [];
  successes = 0;
  failures: string[] = [];
  fired: string[] = [];
  // Set when a check of this watch started moments ago, so it cannot be claimed.
  checkedMomentsAgo = false;
  missing = false;
  constructor(public current: EventWatch) {}
  async claimDue() {
    return ok([this.current]);
  }
  async findById() {
    return ok(this.missing ? null : this.current);
  }
  async claimNow() {
    return ok(this.checkedMomentsAgo || this.current.status !== "active" ? null : this.current);
  }
  async getSecret() {
    return ok("api-token");
  }
  async getItemStates(_watchId: string, itemIds: string[]) {
    return ok(itemIds.flatMap((id) => (this.states.has(id) ? [this.states.get(id)!] : [])));
  }
  async saveItemStates(_watchId: string, states: Array<{ itemId: string; lastValues: Record<string, unknown> }>) {
    for (const state of states) {
      const previous = this.states.get(state.itemId);
      this.states.set(state.itemId, {
        watchId: "watch-1",
        itemId: state.itemId,
        lastValues: state.lastValues,
        firedAt: previous?.firedAt ?? null,
        lastSeenAt: new Date(0),
      });
    }
    return ok(undefined);
  }
  async markFired(_watchId: string, itemIds: string[]) {
    this.fired.push(...itemIds);
    for (const id of itemIds) this.states.set(id, { ...this.states.get(id)!, firedAt: new Date(0) });
    return ok(undefined);
  }
  async recordSuccess() {
    this.successes += 1;
    return ok(undefined);
  }
  async recordFailure(_id: string, _at: Date, message: string) {
    this.failures.push(message);
    this.current = { ...this.current, consecutiveFailures: this.current.consecutiveFailures + 1, lastError: message };
    return ok(this.current);
  }
  async pause(_id: string, reason: WatchPausedReason, _at: Date, incidentId: string) {
    this.paused.push({ reason, incidentId });
    this.current = { ...this.current, status: "paused", pausedReason: reason, pauseIncidentId: incidentId };
    return ok(this.current);
  }
}

const build = (options: {
  watch?: EventWatch;
  response?: Result<{ status: number; json: unknown }>;
  start?: (input: StartUnattendedRunInput) => StartUnattendedRunOutput;
  previous?: WatchItemState[];
}) => {
  const watches = new InMemoryWatches(options.watch ?? watch());
  for (const state of options.previous ?? []) watches.states.set(state.itemId, state);
  const requests: OutboundJsonRequest[] = [];
  const starts: StartUnattendedRunInput[] = [];
  const kicked: string[] = [];
  const incidents: UnattendedIncident[] = [];
  let sequence = 0;
  const useCase = new PollDueWatches({
    watches,
    http: {
      requestJson: async (request) => {
        requests.push(request);
        return options.response ?? ok({ status: 200, json: { hearings: [] } });
      },
    },
    loadAutomationConfig: async () => ({ watchAllowedHosts: ["hearings.internal"], emailAllowedDomains: [] }),
    startUnattendedRun: {
      execute: async (input) => {
        starts.push(input);
        return ok(
          options.start?.(input) ?? { started: true, session: { id: `session-${input.itemId}` } as Session },
        );
      },
    },
    kick: (sessionId) => kicked.push(sessionId),
    incidents: {
      execute: async (incident) => {
        incidents.push(incident);
        return ok(null);
      },
    },
    newId: () => `incident-${(sequence += 1)}`,
    now: () => new Date("2026-10-22T00:00:00.000Z"),
  });
  return { useCase, watches, requests, starts, kicked, incidents };
};

const previous = (itemId: string, status: string): WatchItemState => ({
  watchId: "watch-1",
  itemId,
  lastValues: { status },
  firedAt: null,
  lastSeenAt: new Date(0),
});

const hearings = (...items: Array<{ id: string; status: string }>) =>
  ok({ status: 200, json: { hearings: items.map((item) => ({ ...item, committee: { name: "Finance" } })) } });

describe("PollDueWatches", () => {
  it("calls the API with the watch's token and the admin's allowed hosts", async () => {
    const { useCase, requests } = build({});

    await useCase.execute({ limit: 10 });

    expect(requests[0]).toMatchObject({
      url: "https://api.example.gov.au/hearings",
      method: "GET",
      headers: { Authorization: "Bearer api-token" },
      allowedHosts: ["hearings.internal"],
    });
  });

  it("sends an API key in the named header, or as a query parameter", async () => {
    const header = build({ watch: watch({ authType: "api_key", apiKeyPlacement: { in: "header", name: "X-API-Key" } }) });
    const query = build({ watch: watch({ authType: "api_key", apiKeyPlacement: { in: "query", name: "key" } }) });

    await header.useCase.execute({ limit: 10 });
    await query.useCase.execute({ limit: 10 });

    expect(header.requests[0]!.headers).toEqual({ "X-API-Key": "api-token" });
    expect(query.requests[0]!.url).toBe("https://api.example.gov.au/hearings?key=api-token");
  });

  it("starts one run per item that meets the condition, with mapped inputs, and remembers it fired", async () => {
    const { useCase, starts, kicked, watches } = build({
      response: hearings({ id: "H-1", status: "finished" }, { id: "H-2", status: "live" }),
      previous: [previous("H-1", "live"), previous("H-2", "live")],
    });

    const result = await useCase.execute({ limit: 10 });

    expect(result.data).toEqual({ polled: 1, started: 1, paused: 0, failed: 0 });
    expect(starts).toEqual([
      {
        flowId: "flow-1",
        runAsUserId: "owner-1",
        origin: "watch",
        triggerSourceId: "watch-1",
        sourceName: "Estimates hearings",
        inputs: { hearing_id: "H-1", committee: "Finance" },
        raw: { id: "H-1", status: "finished", committee: { name: "Finance" } },
        itemId: "H-1",
      },
    ]);
    expect(kicked).toEqual(["session-H-1"]);
    expect(watches.fired).toEqual(["H-1"]);
    expect(watches.states.get("H-1")!.lastValues).toEqual({ status: "finished" });
    expect(watches.successes).toBe(1);
  });

  it("records a baseline and starts nothing on the first poll", async () => {
    const { useCase, starts, watches } = build({
      watch: watch({ baselinePending: true, condition: { kind: "new_item" } }),
      response: hearings({ id: "H-1", status: "live" }),
    });

    await useCase.execute({ limit: 10 });

    expect(starts).toEqual([]);
    expect(watches.states.has("H-1")).toBe(true);
    expect(watches.successes).toBe(1);
  });

  it("leaves an item to fire again next poll when its run could not start", async () => {
    const { useCase, watches } = build({
      response: hearings({ id: "H-1", status: "finished" }),
      previous: [previous("H-1", "live")],
      start: () => ({ started: false, reason: "invalid_inputs", message: "hearing_id is required." }),
    });

    await useCase.execute({ limit: 10 });

    expect(watches.states.get("H-1")!.lastValues).toEqual({ status: "live" });
    expect(watches.failures).toEqual(["Item H-1: hearing_id is required."]);
  });

  it("records a failed poll and pauses the watch, alerting its owner once, at the threshold", async () => {
    const { useCase, watches, incidents } = build({
      watch: watch({ consecutiveFailures: 4 }),
      response: err(domainError("INFRA_FAILURE", "The API answered HTTP 401.")),
    });

    const result = await useCase.execute({ limit: 10 });

    expect(watches.failures).toEqual(["The API answered HTTP 401."]);
    expect(watches.paused).toEqual([{ reason: "failure_threshold", incidentId: "incident-1" }]);
    expect(incidents).toEqual([
      {
        kind: "watch_paused",
        watch: { id: "watch-1", name: "Estimates hearings", runAsUserId: "owner-1", pauseIncidentId: "incident-1" },
        reason: "The API failed 5 times in a row. Last error: The API answered HTTP 401.",
      },
    ]);
    expect(result.data).toMatchObject({ failed: 1, paused: 1 });
  });

  it("treats a response with no list at the items path as a failed poll", async () => {
    const { useCase, watches } = build({ response: ok({ status: 200, json: { other: [] } }) });

    await useCase.execute({ limit: 10 });

    expect(watches.failures).toEqual(["The response has no list at hearings."]);
  });

  it("starts nothing and pauses when more items match than one poll may start", async () => {
    const { useCase, starts, watches } = build({
      watch: watch({ maxRunsPerPoll: 1, condition: { kind: "new_item" } }),
      response: hearings({ id: "H-1", status: "x" }, { id: "H-2", status: "x" }),
    });

    await useCase.execute({ limit: 10 });

    expect(starts).toEqual([]);
    expect(watches.paused[0]!.reason).toBe("run_cap_exceeded");
    expect(watches.states.size).toBe(0);
  });

  it("pauses when the run-as user or the flow is no longer available", async () => {
    const { useCase, watches } = build({
      watch: watch({ condition: { kind: "new_item" } }),
      response: hearings({ id: "H-1", status: "x" }),
      start: () => ({ started: false, reason: "run_as_unavailable", message: "The run-as user no longer exists." }),
    });

    await useCase.execute({ limit: 10 });

    expect(watches.paused[0]!.reason).toBe("run_as_unavailable");
  });
});

describe("PollDueWatches.runNow", () => {
  it("checks the watch at once, starting a run for each item that meets its condition", async () => {
    const { useCase, starts } = build({
      response: hearings({ id: "H-1", status: "finished" }),
      previous: [previous("H-1", "live")],
    });

    const result = await useCase.runNow("watch-1");

    expect(result.data).toEqual({ outcome: "checked", started: 1, failed: false, paused: false, lastError: null });
    expect(starts.map((start) => start.itemId)).toEqual(["H-1"]);
  });

  it("starts nothing when no item meets the condition, and says so", async () => {
    const { useCase, starts } = build({ response: hearings({ id: "H-1", status: "live" }) });

    const result = await useCase.runNow("watch-1");

    expect(result.data).toMatchObject({ outcome: "checked", started: 0 });
    expect(starts).toEqual([]);
  });

  it("reports a failed check with its reason", async () => {
    const { useCase } = build({ response: err(domainError("INFRA_FAILURE", "The API answered 503.")) });

    const result = await useCase.runNow("watch-1");

    expect(result.data).toMatchObject({ outcome: "checked", failed: true, lastError: "The API answered 503." });
  });

  it("does not check a watch whose check started moments ago, so no item fires twice", async () => {
    const { useCase, watches, requests } = build({});
    watches.checkedMomentsAgo = true;

    const result = await useCase.runNow("watch-1");

    expect(result.data).toEqual({ outcome: "busy" });
    expect(requests).toEqual([]);
  });

  it("refuses a paused watch, which must be resumed first", async () => {
    const { useCase } = build({ watch: watch({ status: "paused", pausedReason: "manual" }) });

    const result = await useCase.runNow("watch-1");

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("returns NOT_FOUND for an unknown watch", async () => {
    const { useCase, watches } = build({});
    watches.missing = true;

    expect((await useCase.runNow("missing")).error?.code).toBe("NOT_FOUND");
  });
});
