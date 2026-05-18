import type { NextFunction, Request, Response } from "express";
import type { ZodSchema, ZodTypeDef } from "zod";

type Source = "body" | "query" | "params";

export const validate =
  <T>(schema: ZodSchema<T, ZodTypeDef, unknown>, source: Source = "body") =>
  (req: Request, res: Response, next: NextFunction): void => {
    const parsed = schema.safeParse(req[source]);
    if (!parsed.success) {
      res.status(400).json({
        error: { code: "VALIDATION_FAILED", issues: parsed.error.flatten() },
      });
      return;
    }
    req.validated = parsed.data;
    next();
  };
