// Shared configuration for the Wayfinder k6 load suite.
//
// Everything is driven by environment variables so the same scripts run against
// local, staging, and pre-prod without edits. k6 exposes them on __ENV.
//
//   WEB_BASE_URL   the Next.js app        (default http://localhost:3000)
//   API_BASE_URL   the Express API/scheduler (default http://localhost:3001)
//   SESSION_ID     an existing session UUID to exercise (chat + SSE scenarios)
//   AUTH_COOKIE    a full Cookie header value for an authenticated user
//   TARGET_VUS     peak concurrent virtual users (default 500 — the phase target)
//   TURN_PROMPT    the message body a synthetic turn sends

export const WEB_BASE_URL = __ENV.WEB_BASE_URL || 'http://localhost:3000';
export const API_BASE_URL = __ENV.API_BASE_URL || 'http://localhost:3001';
export const SESSION_ID = __ENV.SESSION_ID || '';
export const AUTH_COOKIE = __ENV.AUTH_COOKIE || '';
export const TARGET_VUS = Number(__ENV.TARGET_VUS || 500);
export const TURN_PROMPT = __ENV.TURN_PROMPT || 'Give me a one sentence status update.';

// SLOs for ~500 concurrent active users (scaling-current-stack phase doc, Group
// D acceptance). These are the ship gates: run the suite before and after each
// group and compare. Calibrate the absolute numbers against a measured baseline
// for the target deployment — the shapes (p95 latency, error rate) are fixed.
export const SLO = {
  // Fewer than 1% of requests may fail at peak concurrency.
  http_req_failed: ['rate<0.01'],
  // p95 request latency under 2s for the light read/subscribe paths.
  http_req_duration: ['p(95)<2000'],
};

// A full conversational turn issues several LLM calls, so its end-to-end SLO is
// far looser than a plain HTTP read. Time-to-first-byte is the latency users
// actually feel; hold that tight and let total duration breathe.
export const TURN_SLO = {
  http_req_failed: ['rate<0.02'],
  turn_time_to_first_byte: ['p(95)<2500'],
  turn_duration: ['p(95)<15000'],
};

// A standard ramp: warm up, climb to the target, hold at peak, then wind down.
// The hold is where the SLOs are proven — steady state, not the ramp edges.
export function ramp(target) {
  const peak = target || TARGET_VUS;
  return [
    { duration: '1m', target: Math.ceil(peak * 0.25) },
    { duration: '2m', target: peak },
    { duration: '3m', target: peak },
    { duration: '1m', target: 0 },
  ];
}

// Attaches the authenticated user's cookie to a request. Scenarios that need a
// signed-in session fail fast (below) when AUTH_COOKIE is unset rather than
// silently load-testing the login redirect.
export function authParams(extraHeaders) {
  const headers = Object.assign({}, extraHeaders || {});
  if (AUTH_COOKIE) headers['Cookie'] = AUTH_COOKIE;
  return { headers };
}

export function requireAuthedSession() {
  if (!SESSION_ID || !AUTH_COOKIE) {
    throw new Error(
      'This scenario needs an authenticated session: set SESSION_ID and AUTH_COOKIE. ' +
        'See load/README.md.',
    );
  }
}
