import {
  ORGANISATIONS_ENABLED_SETTING_KEY,
  parseOrganisationsEnabled,
  type OrganisationResolution,
} from "@wayfinder/domain";
import { TRPCError } from "@trpc/server";
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

  // Whether the organisations feature is switched on (ADR-038). Read by the admin
  // nav, group association control, and the org name setting.
  isEnabled: authenticatedProcedure.query(async ({ ctx }) => {
    const result = await ctx.container.repos.systemSettings.get(ORGANISATIONS_ENABLED_SETTING_KEY);
    if (result.error) throw toTrpcError(result.error);
    return parseOrganisationsEnabled(result.data?.value);
  }),

  setEnabled: adminProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.repos.systemSettings.set(
        ORGANISATIONS_ENABLED_SETTING_KEY,
        input.enabled ? "true" : "false",
      );
      if (result.error) throw toTrpcError(result.error);
      return { enabled: input.enabled };
    }),

  // The caller's own organisation (or null). Backs the flow visibility control's
  // "Publish to my organisation" option. Returns null while the feature is off.
  mine: authenticatedProcedure.query(async ({ ctx }) => {
    const enabledResult = await ctx.container.repos.systemSettings.get(
      ORGANISATIONS_ENABLED_SETTING_KEY,
    );
    if (enabledResult.error) throw toTrpcError(enabledResult.error);
    if (!parseOrganisationsEnabled(enabledResult.data?.value)) return null;

    const userResult = await ctx.container.repos.users.findById(ctx.userId);
    if (userResult.error) throw toTrpcError(userResult.error);
    const organisationId = userResult.data?.organisationId ?? null;
    if (!organisationId) return null;
    const organisationResult = await ctx.container.repos.organisations.findById(organisationId);
    if (organisationResult.error) throw toTrpcError(organisationResult.error);
    return organisationResult.data;
  }),

  create: adminProcedure
    .input(z.object({ name: z.string().min(1), emailDomain: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.createOrganisation.execute({
        name: input.name,
        emailDomain: input.emailDomain ?? null,
      });
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  // Creates an organisation and puts the calling admin in it. The first-run
  // wizard needs both halves together: choosing a multi-organisation deployment
  // is meaningless until at least one organisation exists and the admin belongs
  // to it (ADR-041 §3). Taking the user from ctx keeps the client from having to
  // know its own id.
  createForSelf: adminProcedure
    .input(z.object({ name: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      // adminProcedure proves the caller is an admin but does not narrow userId,
      // which this mutation needs to assign membership.
      const userId = ctx.userId;
      if (!userId) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Authentication required." });
      }

      const created = await ctx.container.useCases.createOrganisation.execute({
        name: input.name,
        emailDomain: null,
      });
      if (created.error) throw toTrpcError(created.error);

      const assigned = await ctx.container.useCases.assignUserOrganisation.execute({
        userId,
        organisationId: created.data.id,
      });
      if (assigned.error) throw toTrpcError(assigned.error);

      return created.data;
    }),

  update: adminProcedure
    .input(
      z.object({
        organisationId: z.string().uuid(),
        name: z.string().min(1).optional(),
        emailDomain: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.updateOrganisation.execute(input.organisationId, {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.emailDomain !== undefined ? { emailDomain: input.emailDomain } : {}),
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

  // Whether the caller may pick their own organisation, and the choices open to
  // them. Unlike `signInState` this answers for a user who already has one, so
  // the Organisation card in user settings can offer a change. Self-selection is
  // only on when the configured strategy leaves the choice to the user — the
  // same rule submitNomination enforces when the change is submitted.
  nominationOptions: authenticatedProcedure.query(async ({ ctx }) => {
    const enabledResult = await ctx.container.repos.systemSettings.get(
      ORGANISATIONS_ENABLED_SETTING_KEY,
    );
    if (enabledResult.error) throw toTrpcError(enabledResult.error);
    if (!parseOrganisationsEnabled(enabledResult.data?.value)) {
      return { canSelfSelect: false as const };
    }

    const configResult = await ctx.container.useCases.getOrganisationResolution.execute();
    if (configResult.error) throw toTrpcError(configResult.error);
    const config = configResult.data;

    const mode =
      config.strategy === "self_nomination"
        ? config.selfNomination?.mode ?? "create_or_join"
        : config.strategy === "email_domain" && config.emailDomain?.onUnmatched === "nominate"
          ? ("create_or_join" as const)
          : null;
    if (mode === null) return { canSelfSelect: false as const };

    const organisationsResult = await ctx.container.useCases.listOrganisations.execute();
    if (organisationsResult.error) throw toTrpcError(organisationsResult.error);

    return {
      canSelfSelect: true as const,
      mode,
      joinable: organisationsResult.data.map((organisation) => ({
        id: organisation.id,
        name: organisation.name,
      })),
    };
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
