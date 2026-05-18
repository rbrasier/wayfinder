import { sendMessageInputSchema, type SampleResponse } from "@rbrasier/shared";
import { TRPCError } from "@trpc/server";
import { publicProcedure, router } from "../trpc";

/**
 * `message.send` is implemented as an async-generator mutation. tRPC v11
 * streams each yielded chunk to the client over an SSE-style transport
 * (`httpBatchStreamLink`). The client iterates partial objects as they
 * arrive — `useChat` is *not* used here because the response is a
 * structured object, not free-form text. See `/sample` page for the
 * consumer side.
 */
export const messageRouter = router({
  send: publicProcedure.input(sendMessageInputSchema).mutation(async function* ({ ctx, input }) {
    const result = await ctx.container.useCases.sendMessage.execute({
      prompt: input.prompt,
      userId: ctx.userId,
      conversationId: input.conversationId,
    });
    if (result.error) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error.message });
    }

    yield { type: "meta" as const, conversationId: result.data.conversationId };

    let last: Partial<SampleResponse> = {};
    for await (const partial of result.data.partialObjectStream) {
      last = partial;
      yield { type: "partial" as const, partial };
    }

    const final = await result.data.object;
    yield { type: "final" as const, object: final };
    return last;
  }),
});
