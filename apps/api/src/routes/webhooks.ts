import { createHmac, timingSafeEqual } from "crypto";
import { Router, type Request, type Response } from "express";
import type { Env } from "../env.js";

const verifySignature = (
  secret: string,
  rawBody: Buffer,
  signature: string,
): boolean => {
  const expected = createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  const expectedBuf = Buffer.from(`sha256=${expected}`, "utf8");
  const receivedBuf = Buffer.from(signature, "utf8");
  if (expectedBuf.length !== receivedBuf.length) return false;
  return timingSafeEqual(expectedBuf, receivedBuf);
};

export const buildWebhooksRouter = (env: Env) => {
  const router = Router();

  router.post(
    "/n8n/:sessionId",
    (req: Request, res: Response): void => {
      const signature = req.headers["x-n8n-signature"];

      if (!env.N8N_WEBHOOK_SECRET) {
        res.status(401).json({ error: "Webhook secret not configured." });
        return;
      }

      if (!signature || typeof signature !== "string") {
        res.status(401).json({ error: "Missing X-N8n-Signature header." });
        return;
      }

      const rawBody: Buffer = (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body));
      const valid = verifySignature(env.N8N_WEBHOOK_SECRET, rawBody, signature);

      if (!valid) {
        res.status(401).json({ error: "Invalid signature." });
        return;
      }

      res.status(501).json({ error: "n8n integration not enabled at MVP." });
    },
  );

  return router;
};
