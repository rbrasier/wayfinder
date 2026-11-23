import { serverEnv } from "./env";

// Where the signing provider sends the approver back (ADR-067 §4). Built from
// the public origin, which is also what has to be registered with the provider.
export const signingCallbackUrl = (): string =>
  `${serverEnv().BETTER_AUTH_URL.replace(/\/+$/, "")}/api/signing/csc/callback`;
