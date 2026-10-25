import { verifyHmacSignature } from "@wayfinder/adapters";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { Container } from "../container.js";

const callbackSchema = z.object({
  correlationId: z.string().optional(),
  nodeId: z.string().min(1),
  status: z.enum(["completed", "pending_approval", "failed"]),
  data: z.record(z.unknown()).default({}),
  message: z.string().optional(),
});

export const buildWebhooksRouter = (container: Container): Router => {
  const router = Router();
  const { env, useCases } = container;

  router.post(
    "/n8n/:sessionId",
    async (req: Request, res: Response): Promise<void> => {
      const signature = req.headers["x-n8n-signature"];

      if (!env.N8N_WEBHOOK_SECRET) {
        res.status(401).json({ error: "Webhook secret not configured." });
        return;
      }

      if (!signature || typeof signature !== "string") {
        res.status(401).json({ error: "Missing X-N8n-Signature header." });
        return;
      }

      const rawBody: Buffer =
        (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body));
      if (!verifyHmacSignature(env.N8N_WEBHOOK_SECRET, rawBody, signature)) {
        res.status(401).json({ error: "Invalid signature." });
        return;
      }

      const parsed = callbackSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Malformed callback body." });
        return;
      }

      const result = await useCases.applyAutoNodeResult.execute({
        sessionId: req.params.sessionId ?? "",
        correlationId: parsed.data.correlationId,
        nodeId: parsed.data.nodeId,
        status: parsed.data.status,
        data: parsed.data.data,
        message: parsed.data.message,
      });

      if (result.error) {
        res.status(500).json({ error: result.error });
        return;
      }

      // A stale or duplicate callback is acknowledged (idempotent) but not acted on.
      if (!result.data.applied) {
        res.status(200).json({ data: { ignored: true } });
        return;
      }

      res.status(200).json({ data: { applied: true, advanced: result.data.advanced } });
    },
  );

  return router;
};
