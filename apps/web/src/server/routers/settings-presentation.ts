import { z } from "zod";
import {
  ABOUT_LINKS_SETTING_KEY,
  ABOUT_LINK_ICONS,
  CHAT_DISCLAIMER_CONFIG_SETTING_KEY,
  CHAT_DISCLAIMER_MODAL_MODES,
  SITE_BANNER_CONFIG_SETTING_KEY,
  SITE_BANNER_MAX_TEXT_SIZE_PT,
  SITE_BANNER_MIN_TEXT_SIZE_PT,
  normaliseAboutLinkUrl,
  normaliseSiteBannerLinkUrl,
} from "@rbrasier/domain";
import { adminProcedure, authenticatedProcedure, publicProcedure } from "../trpc";
import { toTrpcError } from "../trpc-errors";

// The admin-authored copy that renders around the product: the site banner, the
// About links, and the two chat disclaimers. All three are the same shape of
// thing — one JSON row an operator edits without a redeploy (ADR-041) — so they
// share a module and keep the main settings router under the size limit.

const hexColourSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Use a six-digit hex colour, e.g. #dc2626");

// Mirrors normaliseSiteBannerLinkUrl: the value becomes an href, so only
// http(s) and site-relative paths are accepted. An admin gets a validation
// error here rather than the silent fallback the read path applies.
const siteBannerLinkUrlSchema = z.string().refine(
  (value) => value.length === 0 || normaliseSiteBannerLinkUrl(value) === value.trim(),
  "Enter a full https:// or http:// URL, or a path starting with /",
);

export const siteBannerConfigInputSchema = z.object({
  enabled: z.boolean(),
  text: z.string().max(300),
  textSizePt: z.number().int().min(SITE_BANNER_MIN_TEXT_SIZE_PT).max(SITE_BANNER_MAX_TEXT_SIZE_PT),
  textColour: hexColourSchema,
  backgroundColour: hexColourSchema,
  linkUrl: siteBannerLinkUrlSchema,
  linkLabel: z.string().max(60),
});

// One row per configured About entry. The URL is validated the same way the
// read path normalises it, so an admin sees a rejection rather than a link that
// silently disappears from the modal.
export const aboutLinksInputSchema = z.object({
  links: z
    .array(
      z.object({
        label: z.string().trim().min(1, "Give the link some text").max(60),
        url: z
          .string()
          .trim()
          .refine(
            (value) => normaliseAboutLinkUrl(value) === value.trim() && value.trim().length > 0,
            "Enter a full https:// or http:// URL, a mailto: address, or a path starting with /",
          ),
        icon: z.enum(ABOUT_LINK_ICONS),
        showInHelpMenu: z.boolean(),
      }),
    )
    .max(12),
});

// Both strings reach the DOM as text nodes, so length is the only constraint —
// the modal is a warning, not a document, and an unbounded body would push the
// action button off the screen.
export const chatDisclaimerConfigInputSchema = z.object({
  composerText: z.string().max(300),
  modalMode: z.enum(CHAT_DISCLAIMER_MODAL_MODES),
  modalText: z.string().max(1000),
});

export const presentationSettingsProcedures = {
  // Public: the login and register pages need the banner too, and a site
  // warning carries no secret material.
  getSiteBanner: publicProcedure.query(async ({ ctx }) => {
    return ctx.container.runtimeConfig.getSiteBannerConfig();
  }),

  setSiteBanner: adminProcedure
    .input(siteBannerConfigInputSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.repos.systemSettings.set(
        SITE_BANNER_CONFIG_SETTING_KEY,
        JSON.stringify(input),
      );
      if (result.error) throw toTrpcError(result.error);
      ctx.container.runtimeConfig.invalidateSiteBanner();
      return { ok: true };
    }),

  // Authenticated rather than admin: the disclaimers render for every user in a
  // chat. Unlike the site banner there is no signed-out surface that needs them,
  // so the read stays behind sign-in.
  getChatDisclaimer: authenticatedProcedure.query(async ({ ctx }) => {
    return ctx.container.runtimeConfig.getChatDisclaimerConfig();
  }),

  setChatDisclaimer: adminProcedure
    .input(chatDisclaimerConfigInputSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.repos.systemSettings.set(
        CHAT_DISCLAIMER_CONFIG_SETTING_KEY,
        JSON.stringify(input),
      );
      if (result.error) throw toTrpcError(result.error);
      ctx.container.runtimeConfig.invalidateChatDisclaimer();
      return { ok: true };
    }),

  // Authenticated rather than admin: every signed-in user sees these on the
  // About modal and in the help menu, and they carry no secret material.
  getAboutLinks: publicProcedure.query(async ({ ctx }) => {
    return ctx.container.runtimeConfig.getAboutLinksConfig();
  }),

  setAboutLinks: adminProcedure.input(aboutLinksInputSchema).mutation(async ({ ctx, input }) => {
    const result = await ctx.container.repos.systemSettings.set(
      ABOUT_LINKS_SETTING_KEY,
      JSON.stringify(input),
    );
    if (result.error) throw toTrpcError(result.error);
    ctx.container.runtimeConfig.invalidateAboutLinks();
    return { ok: true };
  }),
};
