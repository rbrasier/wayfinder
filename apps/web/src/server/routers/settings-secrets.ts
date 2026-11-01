/**
 * Masking for stored credentials on their way back to an admin client.
 *
 * Every settings card that holds a secret — AI keys, the SMTP and M365
 * passwords, the Entra client secret — reports only whether one is present.
 * Shared from here so no card can accidentally return the value itself
 * (ADR-025 §1).
 */
export const apiKeyState = (value: string | null): "set" | "unset" =>
  value && value.length > 0 ? "set" : "unset";
