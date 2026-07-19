import type { OrganisationResolution } from "@rbrasier/domain";
import { z } from "zod";
import { adminProcedure, authenticatedProcedure, router } from "../trpc";
import { toTrpcError } from "../trpc-errors";

const resolutionSchema: z.ZodType<OrganisationResolution> = z.discriminatedUnion("strategy", [
  z.object({ strategy: z.literal("admin") }),
  z.object({ strategy: z.literal("sso_claim"), ssoClaim: z.object({ claimName: z.string().min(1) }) }),
  z.object({
    strategy: z.literal("email_domain"),
    emailDomain: z.object({
      domainToOrg: z.array(
        z.object({ domain: z.string().min(1), organisationId: z.string().uuid() }),
      ),
      onUnmatched: z.enum(["unaffiliated", "nominate"]),
    }),
  }),
  z.object({
    strategy: z.literal("self_nomination"),
    selfNomination: z.object({
      mode: z.enum(["create_or_join", "join_existing"]),
      allowlist: z.array(z.string().min(1)).optional(),
    }),
  }),
]);

export const organisationRouter = router({
  // Every organisation, for the admin CRUD screen.
  list: adminProcedure.query(async ({ ctx }) => {
    const result = await ctx.container.useCases.listOrganisations.execute();
    if (result.error) throw toTrpcError(result.error);
    return result.data;
  }),

  // The caller's own organisation (or null). Backs the flow visibility control's
  // "Publish to my organisation" option.
  mine: authenticatedProcedure.query(async ({ ctx }) => {
    const userResult = await ctx.container.repos.users.findById(ctx.userId);
    if (userResult.error) throw toTrpcError(userResult.error);
    const organisationId = userResult.data?.organisationId ?? null;
    if (!organisationId) return null;
    const organisationResult = await ctx.container.repos.organisations.findById(organisationId);
    if (organisationResult.error) throw toTrpcError(organisationResult.error);
    return organisationResult.data;
  }),

  create: adminProcedure
    .input(z.object({ name: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.createOrganisation.execute({ name: input.name });
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  update: adminProcedure
    .input(z.object({ organisationId: z.string().uuid(), name: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.updateOrganisation.execute(input.organisationId, {
        name: input.name,
      });
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  delete: adminProcedure
    .input(z.object({ organisationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.deleteOrganisation.execute(input.organisationId);
      if (result.error) throw toTrpcError(result.error);
      return { ok: true };
    }),

  assignUser: adminProcedure
    .input(
      z.object({
        userId: z.string().uuid(),
        organisationId: z.string().uuid().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.assignUserOrganisation.execute({
        userId: input.userId,
        organisationId: input.organisationId,
      });
      if (result.error) throw toTrpcError(result.error);
      return { ok: true };
    }),

  getResolution: adminProcedure.query(async ({ ctx }) => {
    const result = await ctx.container.useCases.getOrganisationResolution.execute();
    if (result.error) throw toTrpcError(result.error);
    return result.data;
  }),

  setResolution: adminProcedure
    .input(resolutionSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.setOrganisationResolution.execute(input);
      if (result.error) throw toTrpcError(result.error);
      ctx.container.runtimeConfig.invalidateOrganisationResolution();
      return result.data;
    }),

  // Runs membership resolution for the caller on sign-in (ADR-038 §4). Called by
  // the first-login gate: `email_domain` auto-assigns here; strategies that need
  // a prompt return status "nominate" plus the joinable organisations and mode
  // the nomination dialog renders.
  signInState: authenticatedProcedure.query(async ({ ctx }) => {
    const outcome = await ctx.container.useCases.resolveOrganisationOnSignIn.execute(ctx.userId);
    if (outcome.error) throw toTrpcError(outcome.error);
    if (outcome.data.status !== "nominate") return { status: outcome.data.status };

    const configResult = await ctx.container.useCases.getOrganisationResolution.execute();
    if (configResult.error) throw toTrpcError(configResult.error);
    const config = configResult.data;
    const mode =
      config.strategy === "self_nomination" ? config.selfNomination?.mode ?? "create_or_join" : "create_or_join";

    const organisationsResult = await ctx.container.useCases.listOrganisations.execute();
    if (organisationsResult.error) throw toTrpcError(organisationsResult.error);
    const joinable = organisationsResult.data.map((organisation) => ({
      id: organisation.id,
      name: organisation.name,
    }));

    return { status: "nominate" as const, mode, joinable };
  }),

  // First-sign-in nomination (ADR-038 §4, self_nomination): the user creates or
  // joins an organisation, bounded by the configured mode/allowlist.
  submitNomination: authenticatedProcedure
    .input(
      z.object({
        joinOrganisationId: z.string().uuid().optional(),
        createName: z.string().min(1).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.submitOrganisationNomination.execute({
        userId: ctx.userId,
        joinOrganisationId: input.joinOrganisationId,
        createName: input.createName,
      });
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),
});
