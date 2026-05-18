import type { ErrorRequestHandler } from "express";
import type { Container } from "../container.js";

export const errorHandler =
  (container: Container): ErrorRequestHandler =>
  (err, req, res, _next) => {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack ?? null : null;

    void container.services.errorLogger.log({
      level: "error",
      message,
      stack,
      page: req.originalUrl,
      metadata: { method: req.method },
    });

    res.status(500).json({ error: { code: "INTERNAL_ERROR", message } });
  };
