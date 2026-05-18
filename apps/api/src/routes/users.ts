import { Router } from "express";
import {
  createUserInputSchema,
  deleteUserInputSchema,
  listUsersInputSchema,
  updateUserInputSchema,
  type CreateUserInput,
  type DeleteUserInput,
  type ListUsersInput,
  type UpdateUserInput,
} from "@rbrasier/shared";
import type { Container } from "../container.js";
import { validate } from "../middleware/validate.js";

export const buildUsersRouter = (container: Container): Router => {
  const r = Router();
  const { useCases } = container;

  r.get("/", validate(listUsersInputSchema, "query"), async (req, res) => {
    const input = req.validated as ListUsersInput;
    const result = await useCases.listUsers.execute(input);
    if (result.error) {
      res.status(500).json({ error: result.error });
      return;
    }
    res.json({ data: result.data });
  });

  r.post("/", validate(createUserInputSchema), async (req, res) => {
    const input = req.validated as CreateUserInput;
    const result = await useCases.createUser.execute(input);
    if (result.error) {
      const status = result.error.code === "ALREADY_EXISTS" ? 409 : 500;
      res.status(status).json({ error: result.error });
      return;
    }
    res.status(201).json({ data: result.data });
  });

  r.patch("/:id", validate(updateUserInputSchema), async (req, res) => {
    const { id, ...patch } = req.validated as UpdateUserInput;
    const result = await useCases.updateUser.execute(id, patch);
    if (result.error) {
      const status = result.error.code === "NOT_FOUND" ? 404 : 500;
      res.status(status).json({ error: result.error });
      return;
    }
    res.json({ data: result.data });
  });

  r.delete("/:id", validate(deleteUserInputSchema, "params"), async (req, res) => {
    const { id } = req.validated as DeleteUserInput;
    const result = await useCases.deleteUser.execute(id);
    if (result.error) {
      const status = result.error.code === "NOT_FOUND" ? 404 : 500;
      res.status(status).json({ error: result.error });
      return;
    }
    res.status(204).end();
  });

  return r;
};
