// Install-wide limits for unattended automation (ADR-063 §6, ADR-065 §4). Not
// sensitive, so stored in plaintext and editable from Admin → Settings.
export interface AutomationConfig {
  // Private-network hosts an Event Watch may call despite the SSRF guard.
  watchAllowedHosts: string[];
  // Domains an Email step may send fixed addresses to. Empty means any domain.
  emailAllowedDomains: string[];
}

export const AUTOMATION_CONFIG_SETTING_KEY = "automation_config";

export const DEFAULT_AUTOMATION_CONFIG: AutomationConfig = {
  watchAllowedHosts: [],
  emailAllowedDomains: [],
};

const normaliseList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
};

// Tolerant parse: a malformed row reads as "no allowances", which is the safe
// direction for both lists.
export const parseAutomationConfig = (raw: string): AutomationConfig => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_AUTOMATION_CONFIG;
    const source = parsed as Record<string, unknown>;
    return {
      watchAllowedHosts: normaliseList(source.watchAllowedHosts),
      emailAllowedDomains: normaliseList(source.emailAllowedDomains),
    };
  } catch {
    return DEFAULT_AUTOMATION_CONFIG;
  }
};

// A host name or IP literal: labels of letters, digits and hyphens joined by
// dots. Wildcards are refused because an allowance must name what it allows.
const HOST_PATTERN = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;

export const validateAutomationConfig = (config: AutomationConfig): string[] => [
  ...config.watchAllowedHosts
    .filter((host) => !HOST_PATTERN.test(host))
    .map((host) => `${host} is not a valid host name.`),
  ...config.emailAllowedDomains
    .filter((domain) => !HOST_PATTERN.test(domain))
    .map((domain) => `${domain} is not a valid email domain.`),
];
