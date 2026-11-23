import { z } from "zod";
import {
  SIGNATURE_METHODS,
  parseSignatureConfig,
  type BuiltInEngineStatus,
  type EngineChoice,
  type SignatureMethod,
} from "@wayfinder/domain";
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

// An External choice may arrive with a blank URL; the domain's validation turns
// that into a message the admin can act on, rather than a schema error.
const engineChoice = z.discriminatedUnion("source", [
  z.object({ source: z.literal("built-in") }),
  z.object({ source: z.literal("external"), url: z.string().trim().max(500) }),
]);

export const signatureConfigInputSchema = z.object({
  method: z.enum(SIGNATURE_METHODS as [SignatureMethod, ...SignatureMethod[]]),
  pdfConverter: engineChoice,
  signatureEngine: engineChoice,
  tsaUrl: optionalUrl,
  csc: z
    .object({
      baseUrl: z.string().trim().min(1).max(500),
      clientId: z.string().trim().min(1).max(200),
      clientSecret: z.string().max(500),
    })
    .nullable(),
});

// Whether a flow author's "Convert to PDF on signing" switch has a converter to
// use: an external one always counts; the built-in one only on an image that
// carries LibreOffice (ADR-069 §3).
export const pdfConverterAvailable = (choice: EngineChoice, builtInStatus: BuiltInEngineStatus): boolean =>
  choice.source === "external" || builtInStatus !== "unavailable";

export const signatureSettingsProcedures = {
  getSignature: technicalAdminProcedure.query(async ({ ctx }) => {
    const result = await ctx.container.useCases.getSignatureConfig.execute();
    if (result.error) throw toTrpcError(result.error);
    return { ...result.data, builtInStatus: ctx.container.services.builtInEngines.status() };
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
    const builtInStatus = ctx.container.services.builtInEngines.status().pdfConverter;
    return { method: config.method, pdfConverterConfigured: pdfConverterAvailable(config.pdfConverter, builtInStatus) };
  }),
};
