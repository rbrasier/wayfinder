// One container per execution environment, reused across warm invocations —
// the same lazy-singleton shape `apps/web/src/lib/container.ts` already uses,
// applied to the api container (ADR-056 §5).
//
// Every handler goes through here rather than calling buildContainer itself, so
// a cold start pays for the wiring once and a warm one pays nothing.

import { buildContainer, type Container } from "../../../apps/api/src/container.js";
import { loadEnv } from "../../../apps/api/src/env.js";

let container: Container | null = null;

export const getContainer = (): Container => {
  if (container) return container;
  container = buildContainer(loadEnv());
  return container;
};
