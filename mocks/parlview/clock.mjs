// The one clock the ParlView feed, its webhook calls and the mock ParlView MCP
// read, so skipping ahead with POST /parlview/api/advance moves all three.

import { DEFAULT_PERIOD_MS } from "./recordings.mjs";

const periodFromEnv = () => {
  const seconds = Number(process.env.PARLVIEW_MOCK_PERIOD_SECONDS);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_PERIOD_MS;
};

export const createClock = (now = () => Date.now()) => {
  let skewMs = 0;
  return {
    now: () => now() + skewMs,
    skip: (ms) => {
      skewMs += ms;
    },
  };
};

export const PARLVIEW_PERIOD_MS = periodFromEnv();

export const parlviewClock = createClock();
