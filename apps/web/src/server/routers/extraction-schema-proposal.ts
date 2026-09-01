import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { toTrpcError } from "../trpc-errors";
import { canEditFlow } from "./flow";
import {
  authorProcedure,
  fieldDraftSchema,
  inputConfigSchema,
  outputConfigSchema,
  flowNameOf,
  sampleDocumentSchema,
  toSampleDocuments,
} from "./extraction-shared";

// The proposal travels with every request because it is thread-local state the
// client holds — there is no repository to load it from, and adding one would
// mean the design had been misread (ADR-052 §1).
const proposalSchema = z.object({
  status: z.enum(["draft", "confirmed"]),
  revisions: z
    .array(
      z.object({
        fields: z.array(fieldDraftSchema),
        outputInstruction: z.string(),
        request: z.string(),
        note: z.string(),
      }),
    )
    .min(1),
});

// The intent may be blank: an author who hands over a sample output document has
// already said what they need to capture. `ProposeSchema` refuses the one case
// that leaves the proposer nothing to read — no intent and no documents either.
const proposalContextSchema = z.object({
  flowId: z.string().uuid(),
  intent: z.string(),
  documents: z.array(sampleDocumentSchema),
});

// The AI schema-proposal procedures (ADR-052), split out of `extraction.ts` to
// keep that file under the source-size ratchet — the same split `settings.ts`
// makes. Spread into `extractionRouter`, so they are `extraction.proposeSchema`
// and friends to every caller.
export const schemaProposalProcedures = {
  // The AI drafts a field set from the author's stated intent and the sample
  // documents. Author-gated and re-checked through the shared flow-edit guard:
  // the proposer reads no document content the caller could not already read.
  proposeSchema: authorProcedure
    .input(proposalContextSchema)
    .mutation(async ({ ctx, input }) => {
      if (!(await canEditFlow(ctx.container, input.flowId, ctx.userId, ctx.isAdmin))) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You cannot edit this flow." });
      }
      const result = await ctx.container.useCases.proposeSchema.execute({
        flowName: await flowNameOf(ctx.container, input.flowId),
        intent: input.intent,
        documents: toSampleDocuments(input.documents),
        userId: ctx.userId,
        flowId: input.flowId,
      });
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  // One refinement turn. The proposal comes back from the client and returns
  // amended; nothing about it is stored between calls.
  refineSchema: authorProcedure
    .input(
      proposalContextSchema.extend({
        proposal: proposalSchema,
        instruction: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!(await canEditFlow(ctx.container, input.flowId, ctx.userId, ctx.isAdmin))) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You cannot edit this flow." });
      }
      const result = await ctx.container.useCases.refineSchemaProposal.execute({
        flowName: await flowNameOf(ctx.container, input.flowId),
        intent: input.intent,
        documents: toSampleDocuments(input.documents),
        proposal: input.proposal,
        instruction: input.instruction,
        userId: ctx.userId,
        flowId: input.flowId,
      });
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  // The single moment a proposal crosses into authoring config. It goes through
  // the ordinary schema save, so a proposed field and a hand-typed field are the
  // same object with the same validation.
  confirmSchema: authorProcedure
    .input(
      z.object({
        flowId: z.string().uuid(),
        proposal: proposalSchema,
        input: inputConfigSchema,
        output: outputConfigSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!(await canEditFlow(ctx.container, input.flowId, ctx.userId, ctx.isAdmin))) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You cannot edit this flow." });
      }
      const result = await ctx.container.useCases.confirmSchemaProposal.execute({
        flowId: input.flowId,
        proposal: input.proposal,
        input: input.input,
        output: input.output,
      });
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),
};
