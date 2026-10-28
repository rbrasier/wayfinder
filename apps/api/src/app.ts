import cors from "cors";
import express, { type Express } from "express";
import type { Container } from "./container.js";
import { errorHandler } from "./middleware/error-handler.js";
import { buildHealthRouter } from "./routes/health.js";
import { buildWebhooksRouter } from "./routes/webhooks.js";

export const buildApp = (container: Container): Express => {
  const app = express();
  app.use(cors());

  app.use(
    express.json({
      limit: "1mb",
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
      },
    }),
  );

  app.use("/health", buildHealthRouter(container));
  app.use("/v1/webhooks", buildWebhooksRouter(container));

  app.use(errorHandler(container));
  return app;
};
