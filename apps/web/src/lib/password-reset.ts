// Where the emailed reset link lands. Better Auth verifies its own token first
// and redirects here with `?token=` for a good link or `?error=INVALID_TOKEN`
// for a stale one, so both the sender and the page have to agree on this path.
export const PASSWORD_RESET_PATH = "/reset-password";

export const PASSWORD_RESET_TOKEN_PARAM = "token";
export const PASSWORD_RESET_ERROR_PARAM = "error";
