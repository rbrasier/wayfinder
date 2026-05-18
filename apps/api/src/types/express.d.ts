// Module augmentation: validated payloads attached by `validate()` middleware.
import type {} from "express";

declare global {
  namespace Express {
    interface Request {
      validated?: unknown;
    }
  }
}

export {};
