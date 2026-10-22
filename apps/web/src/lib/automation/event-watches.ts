import { PollDueWatches } from "@rbrasier/application";
import type { getContainer } from "@/lib/container";
import { kickUnattendedRun } from "./unattended-runs";

type Container = ReturnType<typeof getContainer>;

// The Event Watch poller (ADR-063 §5), run from the scheduler tick. It starts
// runs and hands each to the driver without waiting on it.
export const buildPollDueWatches = (container: Container): PollDueWatches =>
  new PollDueWatches({
    watches: container.repos.eventWatches,
    http: container.services.outboundHttp,
    loadAutomationConfig: () => container.runtimeConfig.getAutomationConfig(),
    startUnattendedRun: container.useCases.startUnattendedRun,
    kick: (sessionId) => kickUnattendedRun(container, { sessionId }),
    incidents: container.useCases.notifyUnattendedIncident,
    newId: () => globalThis.crypto.randomUUID(),
    now: () => new Date(),
  });
