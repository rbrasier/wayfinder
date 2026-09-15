import { describe, expect, it } from "vitest";
import {
  isProviderSelectable,
  providerSelectionBlockedReason,
  storedProviderWarning,
} from "./embeddings-provider-state";

const both = [
  { provider: "local" as const, available: true, unavailableReason: null },
  { provider: "openai" as const, available: true, unavailableReason: null },
];

const hostedOnly = [
  { provider: "local" as const, available: false, unavailableReason: "No local runtime here." },
  { provider: "openai" as const, available: true, unavailableReason: null },
];

describe("isProviderSelectable", () => {
  it("allows a provider the deployment can load", () => {
    expect(isProviderSelectable(hostedOnly, "openai")).toBe(true);
  });

  it("blocks a provider the deployment cannot load", () => {
    expect(isProviderSelectable(hostedOnly, "local")).toBe(false);
  });

  it("allows everything before the options have loaded, so the control is not dead on first paint", () => {
    expect(isProviderSelectable(undefined, "local")).toBe(true);
  });
});

describe("providerSelectionBlockedReason", () => {
  it("returns the deployment's own reason for the blocked provider", () => {
    expect(providerSelectionBlockedReason(hostedOnly, "local")).toBe("No local runtime here.");
  });

  it("returns null when the selection is allowed", () => {
    expect(providerSelectionBlockedReason(hostedOnly, "openai")).toBeNull();
    expect(providerSelectionBlockedReason(both, "local")).toBeNull();
  });

  it("returns null when the options have not loaded", () => {
    expect(providerSelectionBlockedReason(undefined, "local")).toBeNull();
  });
});

describe("storedProviderWarning", () => {
  it("warns when the saved provider is one this deployment can no longer load", () => {
    expect(storedProviderWarning(hostedOnly, "local")).toBe("No local runtime here.");
  });

  it("stays quiet when the saved provider is loadable", () => {
    expect(storedProviderWarning(hostedOnly, "openai")).toBeNull();
    expect(storedProviderWarning(both, "local")).toBeNull();
  });

  it("stays quiet for a provider the deployment does not know about", () => {
    expect(storedProviderWarning(hostedOnly, "cohere")).toBeNull();
  });
});
