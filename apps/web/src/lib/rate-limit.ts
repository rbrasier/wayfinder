// Best-effort client IP for per-IP rate limiting. Behind a proxy/LB the real
// client is the first entry of X-Forwarded-For; falls back to X-Real-IP, then a
// constant so an un-proxied request still shares one bucket rather than escaping
// the limit entirely.
export const clientIpFromHeaders = (headers: Headers): string => {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip") ?? "unknown";
};

export const tooManyRequestsResponse = (retryAfterMs: number): Response => {
  const retryAfterSeconds = Number.isFinite(retryAfterMs) ? Math.ceil(retryAfterMs / 1000) : 60;
  return new Response("Too many requests", {
    status: 429,
    headers: { "Retry-After": String(Math.max(1, retryAfterSeconds)) },
  });
};
