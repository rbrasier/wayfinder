import { z } from "zod";

export const createUserInputSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(120).nullable().optional(),
  isAdmin: z.boolean().optional(),
});

export const updateUserInputSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email().optional(),
  name: z.string().min(1).max(120).nullable().optional(),
  isAdmin: z.boolean().optional(),
});

export const deleteUserInputSchema = z.object({
  id: z.string().uuid(),
});

export const listUsersInputSchema = z.object({
  limit: z.number().int().min(1).max(200).optional(),
  offset: z.number().int().min(0).optional(),
});

export type CreateUserInput = z.infer<typeof createUserInputSchema>;
export type UpdateUserInput = z.infer<typeof updateUserInputSchema>;
export type DeleteUserInput = z.infer<typeof deleteUserInputSchema>;
export type ListUsersInput = z.infer<typeof listUsersInputSchema>;
