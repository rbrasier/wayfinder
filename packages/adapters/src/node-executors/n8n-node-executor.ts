import { createHmac } from "crypto";
import {
  domainError,
  err,
  ok,
  type INodeExecutor,
  type NodeExecutionInput,
  type NodeExecutionOutput,
  type Result,
} from "@wayfinder/domain";

// Signs the outbound request body with the shared secret. The inbound webhook
// verifies the callback with the same secret (apps/api routes/webhooks.ts).
const sign = (secret: string, body: string): string =>
  "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

export class N8nNodeExecutor implements INodeExecutor {
  constructor(
    private readonly secret: string,
    private readonly fetchFn: typeof fetch = globalThis.fetch,
  ) {}

  async execute(input: NodeExecutionInput): Promise<Result<NodeExecutionOutput>> {
    const body = JSON.stringify({
      instruction: input.instruction,
      fields: input.fields,
      correlationId: input.correlationId,
      nodeId: input.nodeId,
      sessionId: input.sessionId,
      flowId: input.flowId,
      flowSlug: input.flowSlug,
      sessionTitle: input.sessionTitle,
      userId: input.userId,
      userRole: input.userRole,
    });

    try {
      const response = await this.fetchFn(input.webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-N8n-Signature": sign(this.secret, body),
        },
        body,
      });

      if (!response.ok) {
        return err(
          domainError("INFRA_FAILURE", `n8n webhook returned ${response.status}.`),
        );
      }

      // The real result arrives later via the inbound callback webhook.
      return ok({ status: "pending", data: {} });
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to reach the n8n webhook.", cause));
    }
  }
}
