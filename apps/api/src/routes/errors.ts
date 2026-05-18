import { Router } from "express";
import {
  listErrorsInputSchema,
  logErrorInputSchema,
  updateErrorStatusInputSchema,
  type ListErrorsInput,
  type LogErrorInput,
  type UpdateErrorStatusInput,
} from "@rbrasier/shared";
import type { Container } from "../container.js";
import { validate } from "../middleware/validate.js";

export const buildErrorsRouter = (container: Container): Router => {
  const r = Router();
  const { useCases } = container;

  r.post("/", validate(logErrorInputSchema), async (req, res) => {
    const input = req.validated as LogErrorInput;
    const result = await useCases.logError.execute(input);
    if (result.error) {
      res.status(500).json({ error: result.error });
      return;
    }
    res.status(201).json({ data: { ok: true } });
  });

  r.get("/grouped", validate(listErrorsInputSchema, "query"), async (req, res) => {
    const filter = req.validated as ListErrorsInput;
    const result = await useCases.listErrors.listGrouped(filter);
    if (result.error) {
      res.status(500).json({ error: result.error });
      return;
    }
    res.json({ data: result.data });
  });

  r.patch("/status", validate(updateErrorStatusInputSchema), async (req, res) => {
    const input = req.validated as UpdateErrorStatusInput;
    if (input.id) {
      const result = await useCases.updateErrorStatus.byId(input.id, input.status);
      if (result.error) {
        res.status(500).json({ error: result.error });
        return;
      }
      res.json({ data: result.data });
      return;
    }
    if (!input.message) {
      res
        .status(400)
        .json({ error: { code: "VALIDATION_FAILED", message: "id or message required" } });
      return;
    }
    const result = await useCases.updateErrorStatus.byGroup(
      input.message,
      input.page ?? null,
      input.status,
    );
    if (result.error) {
      res.status(500).json({ error: result.error });
      return;
    }
    res.json({ data: { updated: result.data } });
  });

  return r;
};
