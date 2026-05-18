import cors from "cors";
import express, { type Express } from "express";
import type { Container } from "./container.js";
import { errorHandler } from "./middleware/error-handler.js";
import { buildErrorsRouter } from "./routes/errors.js";
import { buildHealthRouter } from "./routes/health.js";
import { buildUsersRouter } from "./routes/users.js";

export const buildApp = (container: Container): Express => {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  app.use("/health", buildHealthRouter(container));
  app.use("/v1/users", buildUsersRouter(container));
  app.use("/v1/errors", buildErrorsRouter(container));

  app.use(errorHandler(container));
  return app;
};
