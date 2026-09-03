// Mirrors MINIMUM_PASSWORD_LENGTH in @rbrasier/domain. Duplicated rather than
// imported because this module is bundled into the browser, and the domain
// package is not part of the client build.
export const MINIMUM_PASSWORD_LENGTH = 8;

/**
 * Client-side check shared by the self-service change-password form and the
 * administrator's reset form, so the two cannot drift into disagreeing about
 * what a valid password is.
 *
 * Returns the message to show, or null when the pair is acceptable. Length is
 * reported before a mismatch: a user who typed something too short in both
 * boxes is better told the real problem than sent to fix a mismatch that isn't
 * the blocker.
 *
 * Advisory only — the server enforces the same floor, since nothing stops a
 * caller from skipping this form entirely.
 */
export const validatePasswordPair = (
  password: string,
  confirmation: string,
): string | null => {
  if (password.length < MINIMUM_PASSWORD_LENGTH) {
    return `New password must be at least ${MINIMUM_PASSWORD_LENGTH} characters`;
  }
  if (password !== confirmation) {
    return "New passwords do not match";
  }
  return null;
};
