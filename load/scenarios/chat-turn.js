// Chat-turn load — the hot path. Each iteration POSTs a message to the chat
// stream route and reads the streamed response to completion, so it measures
// what a user feels: time-to-first-byte and total turn duration under load.
//
//   SESSION_ID=<uuid> AUTH_COOKIE='<cookie header>' \
//     k6 run -e TARGET_VUS=500 load/scenarios/chat-turn.js
//
// Note: every turn spends real LLM budget. Run against a staging deployment with
// a test provider key, and start well below 500 VUs while you calibrate.
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import {
  WEB_BASE_URL,
  SESSION_ID,
  TURN_PROMPT,
  TARGET_VUS,
  TURN_SLO,
  ramp,
  authParams,
  requireAuthedSession,
} from '../config.js';

const timeToFirstByte = new Trend('turn_time_to_first_byte', true);
const turnDuration = new Trend('turn_duration', true);

export const options = {
  scenarios: {
    turns: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: ramp(TARGET_VUS),
    },
  },
  thresholds: TURN_SLO,
};

export function setup() {
  requireAuthedSession();
}

export default function () {
  const url = `${WEB_BASE_URL}/api/chat/${SESSION_ID}/stream`;
  const payload = JSON.stringify({
    messages: [{ role: 'user', content: TURN_PROMPT }],
  });
  const params = authParams({ 'Content-Type': 'application/json' });

  const response = http.post(url, payload, params);

  // waiting = time to first byte; duration = full streamed turn.
  timeToFirstByte.add(response.timings.waiting);
  turnDuration.add(response.timings.duration);

  check(response, {
    // A concurrent turn may legitimately lose the turn lease (409) — that is
    // correct behaviour, not an error, so both count as a healthy response.
    'turn accepted or lease held': (r) => r.status === 200 || r.status === 409,
  });

  sleep(Math.random() * 3 + 2);
}
