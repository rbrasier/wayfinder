import { z } from "zod";

export const errorLevelSchema = z.enum(["debug", "info", "warn", "error", "fatal"]);
export const errorStatusSchema = z.enum(["active", "dismissed", "resolved"]);

export const logErrorInputSchema = z.object({
  level: errorLevelSchema.default("error"),
  message: z.string().min(1).max(2000),
  stack: z.string().nullable().optional(),
  page: z.string().nullable().optional(),
  metadata: z.record(z.unknown()).nullable().optional(),
});

export const listErrorsInputSchema = z.object({
  status: errorStatusSchema.optional(),
  page: z.string().optional(),
  level: errorLevelSchema.optional(),
  limit: z.number().int().min(1).max(500).optional(),
  offset: z.number().int().min(0).optional(),
});

export const updateErrorStatusInputSchema = z.object({
  id: z.string().uuid().optional(),
  message: z.string().optional(),
  page: z.string().nullable().optional(),
  status: errorStatusSchema,
});

export const sendMessageInputSchema = z.object({
  prompt: z.string().min(1).max(4000),
  conversationId: z.string().uuid().optional(),
});

export type LogErrorInput = z.infer<typeof logErrorInputSchema>;
export type ListErrorsInput = z.infer<typeof listErrorsInputSchema>;
export type UpdateErrorStatusInput = z.infer<typeof updateErrorStatusInputSchema>;
export type SendMessageInput = z.infer<typeof sendMessageInputSchema>;
