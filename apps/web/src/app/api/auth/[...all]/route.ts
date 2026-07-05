import { toNextJsHandler } from "better-auth/next-js";
import { getContainer } from "@/lib/container";
import { clientIpFromHeaders, tooManyRequestsResponse } from "@/lib/rate-limit";

export async function GET(request: Request) {
  const auth = await getContainer().getAuth();
  return toNextJsHandler(auth).GET(request);
}

export async function POST(request: Request) {
  const container = getContainer();

  // Throttle auth POSTs (sign-in/up/out) per IP to blunt credential stuffing and
  // brute-force attempts. On a limiter failure, fail open — never lock auth out.
  const ip = clientIpFromHeaders(request.headers);
  const decision = await container.services.authRateLimiter.consume(`auth:${ip}`);
  if (!decision.error && !decision.data.allowed) {
    return tooManyRequestsResponse(decision.data.retryAfterMs);
  }

  const auth = await container.getAuth();
  return toNextJsHandler(auth).POST(request);
}
