import { ScriptedLanguageModel } from "@wayfinder/adapters";

const globalForScriptedLlm = globalThis as typeof globalThis & {
  _wayfinder_scripted_llm: ScriptedLanguageModel | undefined;
};

/**
 * The scripted stand-in for the AI provider, or null when this is a real
 * deployment.
 *
 * The E2E suite's AI mock is a `page.route` intercept, so it only sees requests
 * the browser makes. Every turn, branch choice and document-gate judgement is
 * made here on the server, out of its reach — which is why the specs asserting
 * on those were parked behind env vars CI never sets. Under TEST_AUTH_BYPASS
 * the provider is replaced by a stand-in that /api/test/ai-script drives per
 * session.
 *
 * On globalThis for the same reason the container is: Next.js reloads modules
 * in dev, and the route and the container have to hold the same instance or a
 * registered script is written to one object and read from another.
 *
 * USE_REAL_AI wins over the stub, so the manual real-AI workflow run still
 * exercises the provider — and the flag now means on the server what the e2e
 * README has always claimed it means.
 */
export const getScriptedLanguageModel = (): ScriptedLanguageModel | null => {
  if (process.env.TEST_AUTH_BYPASS !== "true") return null;
  if (process.env.USE_REAL_AI === "true") return null;
  globalForScriptedLlm._wayfinder_scripted_llm ??= new ScriptedLanguageModel();
  return globalForScriptedLlm._wayfinder_scripted_llm;
};
