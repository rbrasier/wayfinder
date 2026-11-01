/**
 * helpers/timeouts.ts
 *
 * CI serves a production build (.github/workflows/e2e.yml), where every route
 * is compiled before the suite starts. A local run against `next dev` compiles
 * each route on its first request instead, and a single page compile has taken
 * over eight seconds. The spec that is first to reach a route pays that compile
 * on top of a server render.
 *
 * Which spec pays the cost moves with the order specs run in, so these live in
 * one place instead of being rediscovered per spec.
 */

/** A single navigation that may compile the route it lands on. */
export const NAV_TIMEOUT = 45_000;

/** A whole test that makes several cold navigations and a mutation. */
export const COLD_ROUTE_BUDGET = 120_000;

/**
 * `load` waits on every subresource and has timed out at 30s under CI load.
 * Each step after a navigation is a retrying assertion, so a parsed document is
 * a sufficient starting point — but anything that *clicks* must first wait for a
 * client-rendered element, or it races hydration and the click is swallowed.
 */
export const untilDom = { waitUntil: 'domcontentloaded' } as const;
