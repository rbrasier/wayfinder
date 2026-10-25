import type { StartFlowFromWebhookOutput } from "@wayfinder/application";

// The HTTP edges of a flow's webhook (ADR-064 §3), kept apart from the route so
// they can be tested without a running server.

export const bearerTokenOf = (authorization: string | null): string | null => {
  const match = /^bearer\s+(\S+)\s*$/i.exec(authorization ?? "");
  return match ? match[1]! : null;
};

export const parseWebhookBody = (raw: string): { ok: true; body: unknown } | { ok: false } => {
  if (raw.trim().length === 0) return { ok: true, body: {} };
  try {
    return { ok: true, body: JSON.parse(raw) as unknown };
  } catch {
    return { ok: false };
  }
};

export const webhookResponseFor = (output: StartFlowFromWebhookOutput): Response => {
  if (output.outcome === "started") return Response.json({ sessionId: output.sessionId }, { status: 202 });
  if (output.outcome === "invalid") return Response.json({ error: output.message }, { status: 400 });
  if (output.outcome === "unauthorized") return Response.json({ error: "Unauthorized." }, { status: 401 });
  return Response.json({ error: "Not found." }, { status: 404 });
};
