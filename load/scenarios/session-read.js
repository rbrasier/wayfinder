// Steady-state read load — models many idle-but-open session windows. Before
// Group C this was the dominant cost (a 3s session poll + 2s typing poll per
// window); after Group C an open window subscribes once to the SSE stream and
// then sits quiet. This scenario opens the SSE endpoint and holds it, which is
// what a real open tab does, so the before/after DB-query delta is measurable.
//
//   SESSION_ID=<uuid> AUTH_COOKIE='<cookie header>' \
//     k6 run -e TARGET_VUS=500 load/scenarios/session-read.js
//
import http from 'k6/http';
import { check, sleep } from 'k6';
import {
  WEB_BASE_URL,
  SESSION_ID,
  TARGET_VUS,
  SLO,
  ramp,
  authParams,
  requireAuthedSession,
} from '../config.js';

export const options = {
  scenarios: {
    watchers: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: ramp(TARGET_VUS),
    },
  },
  thresholds: SLO,
};

export function setup() {
  requireAuthedSession();
}

export default function () {
  const url = `${WEB_BASE_URL}/api/sessions/${SESSION_ID}/events`;
  // k6's http client does not stream SSE, so cap the hold with a timeout and
  // treat the resulting client timeout as "held open", not a failure. The point
  // is the connection cost at the server, not the payload.
  const response = http.get(url, authParams({ Accept: 'text/event-stream', timeout: '20s' }));

  check(response, {
    'subscription authorised': (r) => r.status === 200 || r.status === 0,
  });

  sleep(5);
}
