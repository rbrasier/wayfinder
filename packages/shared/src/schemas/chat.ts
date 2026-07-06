import { z } from "zod";

// Shape of the chat stream POST body. `role`/`content` are kept permissive
// (the client is the AI SDK's useChat, which may attach extra fields that
// z.object strips) — the point is to validate that `messages` is an array of
// well-typed turns rather than trusting an unchecked cast at the route.
export const streamTurnMessageSchema = z.object({
  role: z.string(),
  content: z.string(),
});

export const streamTurnRequestSchema = z.object({
  messages: z.array(streamTurnMessageSchema).optional(),
});

export type StreamTurnRequest = z.infer<typeof streamTurnRequestSchema>;
