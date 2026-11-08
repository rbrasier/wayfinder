import { z } from "zod";
import { SIGNATURE_METHODS, parseSignatureConfig, type SignatureMethod } from "@wayfinder/domain";
import { authenticatedProcedure, technicalAdminProcedure } from "../trpc";
import { toTrpcError } from "../trpc-errors";

// Install-wide document signature settings (ADR-067). Kept in its own module so
// the main settings router stays under the size limit.

const optionalUrl = z
  .string()
  .max(500)
  .nullable()
  .transform((value) => {
    const trimmed = value?.trim() ?? "";
    return trimmed.length > 0 ? trimmed : null;
  });

export const signatureConfigInputSchema = z.object({
  method: z.enum(SIGNATURE_METHODS as [SignatureMethod, ...SignatureMethod[]]),
  gotenbergUrl: optionalUrl,
  dssUrl: optionalUrl,
  tsaUrl: optionalUrl,
  csc: z
    .object({
      baseUrl: z.string().trim().min(1).max(500),
      clientId: z.string().trim().min(1).max(200),
      clientSecret: z.string().max(500),
    })
    .nullable(),
});

export const signatureSettingsProcedures = {
  getSignature: technicalAdminProcedure.query(async ({ ctx }) => {
    const result = await ctx.container.useCases.getSignatureConfig.execute();
    if (result.error) throw toTrpcError(result.error);
    return result.data;
  }),

  // Runs the probes against the form's values without saving them.
  testSignature: technicalAdminProcedure.input(signatureConfigInputSchema).mutation(async ({ ctx, input }) => {
    // A blank secret means "the stored one", exactly as saving treats it.
    const current = await ctx.container.runtimeConfig.getSignatureConfig();
    const candidate = parseSignatureConfig(
      JSON.stringify({
        ...input,
        csc: input.csc
          ? { ...input.csc, clientSecret: input.csc.clientSecret || current.csc?.clientSecret || "" }
          : null,
      }),
    );
    return ctx.container.useCases.testSignatureConfig.execute(candidate);
  }),

  setSignature: technicalAdminProcedure.input(signatureConfigInputSchema).mutation(async ({ ctx, input }) => {
    const result = await ctx.container.useCases.saveSignatureConfig.execute(input, ctx.userId);
    if (result.error) throw toTrpcError(result.error);
    ctx.container.runtimeConfig.invalidateSignature();
    return { ok: true };
  }),

  // What a flow author's approval step editor needs: whether the PDF toggle is
  // forced on, and whether a converter exists for it to use. No URLs.
  getSignatureCapabilities: authenticatedProcedure.query(async ({ ctx }) => {
    const config = await ctx.container.runtimeConfig.getSignatureConfig();
    return { method: config.method, pdfConverterConfigured: config.gotenbergUrl !== null };
  }),
};
