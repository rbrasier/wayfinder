// Smoke test — a single virtual user, a few seconds. Proves the target is up
// and the suite is wired correctly before spending minutes ramping to 500 VUs.
//
//   k6 run load/scenarios/smoke.js
//
import http from 'k6/http';
import { check, sleep } from 'k6';
import { API_BASE_URL, WEB_BASE_URL } from '../config.js';

export const options = {
  vus: 1,
  duration: '10s',
  thresholds: {
    http_req_failed: ['rate<0.01'],
  },
};

export default function () {
  const health = http.get(`${API_BASE_URL}/health`);
  check(health, {
    'api health is 200': (response) => response.status === 200,
  });

  const home = http.get(`${WEB_BASE_URL}/`);
  check(home, {
    'web responds': (response) => response.status === 200 || response.status === 302,
  });

  sleep(1);
}
