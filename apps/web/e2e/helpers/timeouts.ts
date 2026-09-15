/**
 * helpers/timeouts.ts
 *
 * CI serves the app with `next dev` (.github/workflows/e2e.yml), so every route
 * is compiled on its first request. A spec that is the first to reach a route
 * pays that compile on top of a server render, and the app log has shown single
 * page compiles over eight seconds. The first attempt pays it and the retry
 * finds the route warm — which is what "flaky" has meant here, rather than
 * anything wrong with the feature under test.
 *
 * Which spec pays the cost moves whenever the suite is resharded, so these live
 * in one place instead of being rediscovered per spec.
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
