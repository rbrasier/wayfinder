import { Router } from "express";
import type { Container } from "../container.js";

export const buildHealthRouter = (container: Container) => {
  const router = Router();

  router.get("/", async (_req, res) => {
    const result = await container.useCases.getSystemHealth.execute();
    if (result.error) {
      res.status(500).json({ ok: false, error: result.error.message });
      return;
    }
    res.json(result.data);
  });

  return router;
};
