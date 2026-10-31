import { getContainer } from "@/lib/container";
import { kickUnattendedRun } from "@/lib/automation/unattended-runs";
import { bearerTokenOf, parseWebhookBody, webhookResponseFor } from "@/lib/automation/webhook-request";
import { tooManyRequestsResponse } from "@/lib/rate-limit";
import { JSON_BODY_LIMIT_BYTES, readBodyWithinLimit } from "@/lib/request-body-limit";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A flow's inbound start address (ADR-064 §3). Public — the bearer token (and
// HMAC when enabled) is the authentication — and answers before the run does
// anything slow: the run is driven in the background.
export async function POST(req: Request, { params }: { params: Promise<{ flowId: string }> }) {
  const container = getContainer();
  const { flowId } = await params;
  if (!UUID_PATTERN.test(flowId)) return webhookResponseFor({ outcome: "not_found" });

  const rate = await container.services.webhookRateLimiter.consume(`webhook:${flowId}`);
  if (!rate.error && !rate.data.allowed) return tooManyRequestsResponse(rate.data.retryAfterMs);

  const bounded = await readBodyWithinLimit(req, JSON_BODY_LIMIT_BYTES);
  if ("error" in bounded) return Response.json({ error: "Body too large." }, { status: 413 });
  const rawBody = bounded.data;
  const parsed = parseWebhookBody(rawBody);
  if (!parsed.ok) return Response.json({ error: "The body must be JSON." }, { status: 400 });

  const result = await container.useCases.startFlowFromWebhook.execute({
    flowId,
    token: bearerTokenOf(req.headers.get("authorization")),
    signature: req.headers.get("x-wayfinder-signature"),
    rawBody,
    body: parsed.body,
  });
  if (result.error) {
    await container.services.errorLogger.log({
      level: "error",
      message: `Webhook start failed: ${result.error.message}`,
      stack: result.error.cause instanceof Error ? (result.error.cause.stack ?? null) : null,
      page: "api/triggers",
      metadata: { flowId, errorCode: result.error.code },
    });
    return Response.json({ error: "The run could not be started." }, { status: 500 });
  }

  if (result.data.outcome === "started") kickUnattendedRun(container, { sessionId: result.data.sessionId });
  return webhookResponseFor(result.data);
}
